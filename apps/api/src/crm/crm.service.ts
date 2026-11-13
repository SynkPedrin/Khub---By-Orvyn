import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { moduloLiberado, modulosDaRota } from '../auth/modulos';
import { DomainEventsService } from '../events/domain-events.service';
import { AvatarContatoService } from './messaging/avatar-contato.service';
import { ABERTO, escolherFunil, receitaMensal, resumirFunil, type NegocioRef } from './funil';
import { orderByDaOrdem, whereDoFiltro, type FiltroContatos, type OrdemContatos } from './contatos-filtro';
import { idsPorTelefone } from './contatos-sql';
import { camposDe, filtroCamposContato, validarCamposNaTransacao } from './custom-fields.service';
import { limparObsPerda, resolverMotivoPerda } from './lost-reasons.service';
import { totaisDoFunil, whereDosNegocios, type FiltroNegocios } from './pipeline-filtro';

/** Teto de negócios por quadro (Q2.1): acima disso a resposta avisa `truncado` e a tela pede filtro. */
export const LIMITE_QUADRO = 2000;

const num = (d: Prisma.Decimal | number | null | undefined): number => (d == null ? 0 : Number(d));
const brl = (v: number): string => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export interface SearchResult {
  tipo: 'contato' | 'negocio' | 'conversa';
  id: string;
  titulo: string;
  subtitulo: string;
  url: string;
}

export interface ContactRow {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  companyId: string | null;
  tag: string;
  valor: number;
  ultimoContatoAt: Date | null;
  /** Q2.2: colunas configuráveis da lista de Leads. */
  tags: string[];
  ownerId: string | null;
  optedOutAt: Date | null;
  origem: string | null;
  createdAt: Date | null;
  etapa: { dealId: string; stageId: string; nome: string; cor: string } | null;
}
export interface ContactPage {
  items: ContactRow[];
  nextCursor: string | null;
}

export interface UpdateContactInput {
  nome?: string;
  email?: string;
  telefone?: string;
  empresa?: string;
  tag?: string;
  tags?: string[];
  valorEstimado?: number;
  companyId?: string;
  /** "Não perturbe" (Q2.2): true marca agora, false desmarca. */
  naoPerturbe?: boolean;
  /** Substitui o jsonb inteiro, sem validar (uso interno: agentes, perfil, leads). */
  camposCustom?: Record<string, unknown>;
  /**
   * PATCH validado pelas definições (Q2.3, API pública): mescla com o que já
   * está gravado, `null`/"" limpa, chave desconhecida ou tipo errado → 400.
   */
  camposCustomPatch?: Record<string, unknown>;
}
export interface UpdateDealInput {
  titulo?: string;
  valor?: number;
  origem?: string;
  status?: string;
  stageId?: string;
  contactId?: string;
  /** PATCH de campos personalizados do negócio, validado e mesclado (Q2.3). */
  camposCustom?: Record<string, unknown>;
  /** Motivo de perda (Q2.1): vale ao marcar/manter como perdido; `null` limpa. */
  motivoPerdaId?: string | null;
  motivoPerdaObs?: string | null;
  /** identityId do responsável (Q2.1); `null` deixa sem dono. Precisa ser membro do tenant. */
  ownerId?: string | null;
}
export interface UpdateDealOpts {
  /**
   * Exige motivo ao marcar como perdido quando o tenant tem motivos ativos.
   * Só a rota HTTP do usuário liga isto: perda registrada pelo sistema
   * (proposta recusada, automação) não tem quem escolha o motivo.
   */
  exigirMotivoPerda?: boolean;
}

/** Tags do contato: sem espaço sobrando, sem vazia, sem repetida (case-insensitive). */
export function limparTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const tag = t.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (tag && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Cursor opaco (base64url do id da última linha). Opaco de propósito: o cliente
 * não monta cursor à mão nem depende do formato — só devolve o que recebeu.
 */
function encodeCursor(id: string): string {
  return Buffer.from(`c1:${id}`).toString('base64url');
}
function decodeCursor(cursor?: string): string | null {
  if (!cursor) return null;
  const bruto = Buffer.from(cursor, 'base64url').toString();
  const id = bruto.startsWith('c1:') ? bruto.slice(3) : '';
  if (!UUID_RE.test(id)) throw new BadRequestException('cursor inválido');
  return id;
}

export interface CreateContactInput {
  nome: string;
  email?: string;
  telefone?: string;
  empresa?: string;
  tag?: string;
  valorEstimado?: number;
  /** De onde veio (usado no gatilho "Contato criado"). */
  origem?: string;
  /**
   * Campos personalizados do formulário (Q2.3). Quando vem, é validado por
   * inteiro, inclusive obrigatórios; quando não vem (captura de lead, import,
   * Nyro), o contato nasce sem eles: obrigatório é regra de formulário.
   */
  camposCustom?: Record<string, unknown>;
}
export interface CreateDealInput {
  titulo: string;
  contactId?: string;
  stageId: string;
  valor?: number;
  origem?: string;
  /** Campos personalizados do negócio (Q2.3), mesma regra do contato. */
  camposCustom?: Record<string, unknown>;
}

@Injectable()
export class CrmService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
    private readonly avatares: AvatarContatoService,
  ) {}

  /** Funis, etapas e negócios do tenant no formato das regras de `funil.ts`. */
  private async baseFunil(tx: Prisma.TransactionClient) {
    const [funis, etapas, deals] = await Promise.all([
      tx.pipeline.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, nome: true } }),
      tx.stage.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, pipelineId: true, nome: true, cor: true, ordem: true } }),
      tx.deal.findMany({ include: { contact: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const negocios: NegocioRef[] = deals.map((d) => ({ id: d.id, pipelineId: d.pipelineId, stageId: d.stageId, status: d.status, valor: num(d.valor), atualizadoEm: d.updatedAt }));
    return { funis, etapas, deals, negocios };
  }

  async overview(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [{ funis, etapas, negocios }, contactsCount, atividades, contatosRecentes] = await Promise.all([
        this.baseFunil(tx),
        tx.contact.count(),
        tx.activity.findMany({ orderBy: { createdAt: 'desc' }, take: 6 }),
        tx.contact.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
      ]);
      const funil = escolherFunil(funis, negocios);
      const r = funil ? resumirFunil(funil.id, etapas, negocios) : null;

      return {
        kpis: {
          contatos: contactsCount,
          // Só ABERTOS do funil principal (antes: todos os negócios, inclusive ganhos e perdidos).
          negocios: r?.abertos ?? 0,
          valorFunil: r?.valorAberto ?? 0,
          ganho: r?.valorGanho ?? 0,
          conversao: r?.conversao ?? 0,
          conversaoBase: r?.conversaoBase ?? null,
          // Base da conversão honesta na tela: com poucos fechados, "Poucos dados".
          ganhos: r?.ganhos ?? 0,
          perdidos: r?.perdidos ?? 0,
        },
        funilNome: funil?.nome ?? null,
        funil: r?.etapas ?? [],
        // Receita fechada (todos os funis) por mês — base do gráfico de crescimento.
        receitaMensal: receitaMensal(negocios, new Date()),
        atividades: atividades.map((a) => ({ actor: a.actor, acao: a.acao, tone: a.tone, createdAt: a.createdAt.toISOString() })),
        contatosRecentes: contatosRecentes.map((c) => ({ id: c.id, nome: c.nome, tag: c.tag, valor: num(c.valorEstimado) })),
      };
    });
  }

  /**
   * Lista contatos com **paginação por cursor** (D1) — nunca OFFSET, que pula ou
   * repete linha quando algo é inserido no meio da navegação.
   *
   * O cursor referencia a ÚLTIMA linha da página (por id) e o Prisma resolve a
   * comparação keyset no banco, com a precisão nativa da coluna. Detalhe que já
   * quebrou aqui: `timestamptz(6)` guarda microssegundos e o `Date` do JS só
   * chega a milissegundos — comparar timestamp serializado em JS descartava
   * todas as linhas de um mesmo lote de importação (que compartilham
   * `created_at` até o microssegundo).
   */
  async listContacts(tenantId: string, opts: { q?: string; cursor?: string; limit?: number; filtro?: FiltroContatos; ordem?: OrdemContatos } = {}): Promise<ContactPage> {
    if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) throw new BadRequestException('limite inválido');
    const take = Math.min(opts.limit ?? 25, 100);
    const cursorId = decodeCursor(opts.cursor);
    // `q` solto (contrato antigo) e o filtro completo (Q2.2) são o mesmo campo
    const filtro: FiltroContatos = { ...(opts.filtro ?? {}), ...(opts.q?.trim() ? { q: opts.q.trim() } : {}) };

    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = whereDoFiltro(filtro, await idsPorTelefone(tx, filtro.q), await filtroCamposContato(tx, filtro.cf));
      const rows = await tx.contact.findMany({
        where,
        orderBy: orderByDaOrdem(opts.ordem ?? 'recentes'),
        take: take + 1, // +1 sonda: existe próxima página?
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        include: {
          company: { select: { id: true, nome: true } },
          // etapa = negócio ABERTO mais recente do contato (coluna "Etapa")
          deals: { where: { status: ABERTO }, orderBy: { updatedAt: 'desc' }, take: 1, select: { id: true, stage: { select: { id: true, nome: true, cor: true } } } },
        },
      });

      // Cursor apontando para linha removida devolve vazio SEM erro — seria lido
      // como "acabou a lista". Distingue-se dos dois casos aqui.
      if (cursorId && rows.length === 0) {
        const ancora = await tx.contact.findUnique({ where: { id: cursorId }, select: { id: true } });
        if (!ancora) throw new BadRequestException('cursor expirado: o registro de referência não existe mais — recarregue a lista');
      }

      const temMais = rows.length > take;
      const pagina = temMais ? rows.slice(0, take) : rows;
      const ultimo = pagina[pagina.length - 1];
      return {
        items: pagina.map((c) => {
          const negocio = c.deals?.[0];
          const custom = c.camposCustom && typeof c.camposCustom === 'object' && !Array.isArray(c.camposCustom) ? (c.camposCustom as Record<string, unknown>) : {};
          return {
            id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.company?.nome ?? c.empresa,
            companyId: c.companyId, tag: c.tag, valor: num(c.valorEstimado), ultimoContatoAt: c.ultimoContatoAt,
            tags: c.tags ?? [], ownerId: c.ownerId ?? null, optedOutAt: c.optedOutAt ?? null,
            origem: c.origem ?? (typeof custom.lead_origem === 'string' ? custom.lead_origem : null),
            createdAt: c.createdAt ?? null,
            // Foto durável (db/066) e fonte do lead (Meta Ads, Google Ads, WhatsApp direto…).
            fotoUrl: c.fotoUrl ?? null,
            fonte: c.atribuicao && typeof c.atribuicao === 'object' && !Array.isArray(c.atribuicao) ? ((c.atribuicao as Record<string, unknown>).fonte as string | undefined) ?? null : null,
            etapa: negocio?.stage ? { dealId: negocio.id, stageId: negocio.stage.id, nome: negocio.stage.nome, cor: negocio.stage.cor } : null,
          };
        }),
        nextCursor: temMais && ultimo ? encodeCursor(ultimo.id) : null,
      };
    });
  }

  /**
   * Perfil 360 (D1): o contato + empresa + negócios + conversas + tarefas +
   * notas + timeline, numa transação só (uma ida ao banco por aba seria N+1
   * na tela que mais abre no dia).
   */
  async getContact(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({
        where: { id },
        include: { company: true },
      });
      if (!c) throw new NotFoundException('contato inexistente');

      const [deals, conversas, tarefas, notas, timeline] = await Promise.all([
        tx.deal.findMany({ where: { contactId: id }, orderBy: { updatedAt: 'desc' }, include: { stage: { select: { nome: true, cor: true } } } }),
        tx.conversation.findMany({ where: { contactId: id }, orderBy: { updatedAt: 'desc' }, select: { id: true, canal: true, ultimaPrevia: true, ultimaHora: true, naoLidas: true } }),
        tx.task.findMany({ where: { contactId: id }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] }),
        tx.note.findMany({ where: { contactId: id }, orderBy: { createdAt: 'desc' } }),
        tx.activity.findMany({ where: { contactId: id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      ]);

      return {
        id: c.id,
        nome: c.nome,
        fotoUrl: c.fotoUrl ?? null,
        email: c.email,
        telefone: c.telefone,
        empresa: c.empresa,
        tag: c.tag,
        tags: c.tags,
        valor: num(c.valorEstimado),
        optedOutAt: c.optedOutAt,
        ownerId: c.ownerId,
        camposCustom: c.camposCustom,
        ultimoContatoAt: c.ultimoContatoAt,
        createdAt: c.createdAt,
        company: c.company ? { id: c.company.id, nome: c.company.nome, dominio: c.company.dominio, segmento: c.company.segmento } : null,
        negocios: deals.map((d) => ({ id: d.id, titulo: d.titulo, valor: num(d.valor), status: d.status, stage: d.stage?.nome ?? '', cor: d.stage?.cor ?? '#8b5cf6', origem: d.origem })),
        conversas,
        tarefas: tarefas.map((t) => ({ id: t.id, titulo: t.titulo, status: t.status, prioridade: t.prioridade, dueAt: t.dueAt })),
        notas: notas.map((n) => ({ id: n.id, corpo: n.corpo, autor: n.authorNome, createdAt: n.createdAt })),
        timeline: timeline.map((a) => ({ id: a.id, actor: a.actor, acao: a.acao, tone: a.tone, createdAt: a.createdAt })),
      };
    });
  }

  async updateContact(tenantId: string, id: string, input: UpdateContactInput) {
    const r = await this.atualizarContato(tenantId, id, input);
    // Uma tag NOVA é gatilho de automação. Só as adicionadas: emitir na remoção
    // faria o fluxo disparar ao arrumar a tag errada.
    for (const tag of r.tagsAdicionadas) {
      this.eventos.publicar(tenantId, 'contact.tagged', { id, tag });
    }
    return { ok: true };
  }

  private async atualizarContato(tenantId: string, id: string, input: UpdateContactInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.contact.findUnique({ where: { id }, select: { id: true, nome: true, tags: true, camposCustom: true, optedOutAt: true } });
      if (!atual) throw new NotFoundException('contato inexistente');
      if (input.companyId) {
        const empresa = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
        if (!empresa) throw new NotFoundException('empresa inexistente');
      }
      const camposValidados = input.camposCustomPatch
        ? await validarCamposNaTransacao(tx, 'contact', input.camposCustomPatch, { atuais: camposDe(atual.camposCustom), exigirObrigatorios: true })
        : undefined;
      await tx.contact.update({
        where: { id },
        data: {
          nome: input.nome ?? undefined,
          email: input.email === undefined ? undefined : input.email || null,
          telefone: input.telefone === undefined ? undefined : input.telefone || null,
          empresa: input.empresa === undefined ? undefined : input.empresa || null,
          tag: input.tag ?? undefined,
          tags: input.tags === undefined ? undefined : limparTags(input.tags),
          valorEstimado: input.valorEstimado ?? undefined,
          companyId: input.companyId === undefined ? undefined : input.companyId || null,
          // não regrava a data de quem já estava marcado (vale como prova de quando pediu)
          optedOutAt: input.naoPerturbe === undefined ? undefined : input.naoPerturbe ? (atual.optedOutAt ?? new Date()) : null,
          camposCustom: ((camposValidados ?? input.camposCustom) as Prisma.InputJsonValue) ?? undefined,
          updatedAt: new Date(),
        },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `atualizou o contato "${input.nome ?? atual.nome}"`, tone: 'neutral', contactId: id } });
      const antes = new Set((atual.tags ?? []).map((t) => t.toLowerCase()));
      const tagsAdicionadas = limparTags(input.tags ?? []).filter((t) => !antes.has(t.toLowerCase()));
      // tag nova digitada no perfil entra no catálogo (Configurações › Tags)
      for (const tag of tagsAdicionadas) {
        await tx.$executeRaw`INSERT INTO crm_tags (tenant_id, name) VALUES (${tenantId}::uuid, ${tag}) ON CONFLICT (tenant_id, lower(name)) DO NOTHING`;
      }
      return { ok: true, tagsAdicionadas };
    });
  }

  async deleteContact(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({ where: { id }, select: { nome: true } });
      if (!c) throw new NotFoundException('contato inexistente');
      // deals/conversas ficam órfãos por SET NULL (histórico não some com o contato);
      // tarefas e notas do contato caem junto (CASCADE) — são dele, não do funil.
      await tx.contact.delete({ where: { id } });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `excluiu o contato "${c.nome}"`, tone: 'warn' } });
      return { ok: true };
    });
  }

  /**
   * Registra base legal/consentimento (RegrasNegocio §5 — LGPD). Ação própria,
   * não escondida dentro de `updateContact`: é dado de compliance, merece
   * auditoria explícita e um formato validado (ver ConsentimentoDto).
   */
  async registrarConsentimento(tenantId: string, id: string, input: { baseLegal: string; origem?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({ where: { id }, select: { id: true } });
      if (!c) throw new NotFoundException('contato inexistente');
      const consentimento = { baseLegal: input.baseLegal, origem: input.origem ?? null, consentidoEm: new Date().toISOString() };
      await tx.contact.update({ where: { id }, data: { consentimento: consentimento as Prisma.InputJsonValue, updatedAt: new Date() } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', 'sistema', 'contato.consentimento_registrado', 'contact', ${id}::uuid, ${JSON.stringify(consentimento)}::jsonb)`;
      return { ok: true, consentimento };
    });
  }

  /**
   * Exportação completa do contato (LGPD — direito de acesso/portabilidade,
   * RegrasNegocio §5: "exportação... nativas"). Inclui o CONTEÚDO das
   * mensagens (não só metadados, diferente do perfil 360 da UI) — é dado
   * pessoal trocado com o titular, parte do que ele tem direito de receber.
   */
  async exportarDadosContato(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({ where: { id }, include: { company: true } });
      if (!c) throw new NotFoundException('contato inexistente');

      const [deals, conversas, tarefas, notas, atividades] = await Promise.all([
        tx.deal.findMany({ where: { contactId: id }, orderBy: { createdAt: 'asc' } }),
        tx.conversation.findMany({ where: { contactId: id }, include: { messages: { orderBy: { createdAt: 'asc' } } } }),
        tx.task.findMany({ where: { contactId: id }, orderBy: { createdAt: 'asc' } }),
        tx.note.findMany({ where: { contactId: id }, orderBy: { createdAt: 'asc' } }),
        tx.activity.findMany({ where: { contactId: id }, orderBy: { createdAt: 'asc' } }),
      ]);

      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
        VALUES (${tenantId}::uuid, 'humano', 'sistema', 'contato.exportado', 'contact', ${id}::uuid)`;

      return {
        geradoEm: new Date().toISOString(),
        titular: {
          id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, empresa: c.empresa,
          cargo: c.cargo, localizacao: c.localizacao, site: c.site, linkedin: c.linkedin,
          origem: c.origem, tags: c.tags, camposCustom: c.camposCustom,
          consentimento: c.consentimento, criadoEm: c.createdAt,
          empresaVinculada: c.company ? { nome: c.company.nome, dominio: c.company.dominio } : null,
        },
        negocios: deals.map((d) => ({ id: d.id, titulo: d.titulo, valor: num(d.valor), status: d.status, criadoEm: d.createdAt })),
        conversas: conversas.map((cv) => ({
          id: cv.id, canal: cv.canal,
          mensagens: cv.messages.map((m) => ({ autor: m.autorTipo, corpo: m.corpo, enviadaEm: m.createdAt })),
        })),
        tarefas: tarefas.map((t) => ({ titulo: t.titulo, status: t.status, criadaEm: t.createdAt })),
        notas: notas.map((n) => ({ corpo: n.corpo, criadaEm: n.createdAt })),
        atividades: atividades.map((a) => ({ acao: a.acao, quando: a.createdAt })),
      };
    });
  }

  async getDeal(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.deal.findUnique({
        where: { id },
        include: { stage: { select: { id: true, nome: true, cor: true } }, contact: { select: { id: true, nome: true, email: true, telefone: true } }, motivoPerda: { select: { id: true, nome: true } } },
      });
      if (!d) throw new NotFoundException('negócio inexistente');
      const [tarefas, notas] = await Promise.all([
        tx.task.findMany({ where: { dealId: id }, orderBy: [{ status: 'asc' }, { dueAt: 'asc' }] }),
        tx.note.findMany({ where: { dealId: id }, orderBy: { createdAt: 'desc' } }),
      ]);
      return {
        id: d.id, titulo: d.titulo, valor: num(d.valor), origem: d.origem, status: d.status,
        stage: d.stage, contato: d.contact, createdAt: d.createdAt, updatedAt: d.updatedAt,
        camposCustom: camposDe(d.camposCustom),
        ownerId: d.ownerId, motivoPerda: d.motivoPerda, motivoPerdaObs: d.motivoPerdaObs,
        tarefas: tarefas.map((t) => ({ id: t.id, titulo: t.titulo, status: t.status, prioridade: t.prioridade, dueAt: t.dueAt })),
        notas: notas.map((n) => ({ id: n.id, corpo: n.corpo, autor: n.authorNome, createdAt: n.createdAt })),
      };
    });
  }

  async updateDeal(tenantId: string, id: string, input: UpdateDealInput, opts: UpdateDealOpts = {}) {
    const r = await this.atualizarDeal(tenantId, id, input, opts);
    this.eventos.publicar(tenantId, 'deal.updated', { id });
    // Mudança de status (ganho/perdido) é gatilho de pós-venda/reativação.
    if (r.statusMudou) this.eventos.publicar(tenantId, 'deal.status_changed', { id, status: r.status, contactId: r.contactId });
    return { ok: r.ok };
  }

  private async atualizarDeal(tenantId: string, id: string, input: UpdateDealInput, opts: UpdateDealOpts = {}) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.deal.findUnique({ where: { id }, select: { id: true, titulo: true, status: true, contactId: true, camposCustom: true } });
      if (!atual) throw new NotFoundException('negócio inexistente');
      const perda = await this.dadosDePerda(tx, tenantId, atual.status, input, opts);
      if (input.ownerId) {
        const m = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId: input.ownerId, tenantId } }, select: { id: true } });
        if (!m) throw new BadRequestException('responsável não é membro desta operação');
      }
      const camposCustom = input.camposCustom
        ? await validarCamposNaTransacao(tx, 'deal', input.camposCustom, { atuais: camposDe(atual.camposCustom), exigirObrigatorios: true })
        : undefined;
      if (input.stageId) {
        const stage = await tx.stage.findUnique({ where: { id: input.stageId }, select: { id: true } });
        if (!stage) throw new NotFoundException('stage inexistente');
      }
      if (input.contactId) {
        const contato = await tx.contact.findUnique({ where: { id: input.contactId }, select: { id: true } });
        if (!contato) throw new NotFoundException('contato inexistente');
      }
      await tx.deal.update({
        where: { id },
        data: {
          titulo: input.titulo ?? undefined,
          valor: input.valor ?? undefined,
          origem: input.origem === undefined ? undefined : input.origem || null,
          status: input.status ?? undefined,
          stageId: input.stageId ?? undefined,
          contactId: input.contactId === undefined ? undefined : input.contactId || null,
          camposCustom: (camposCustom as Prisma.InputJsonValue | undefined) ?? undefined,
          ...perda.data,
          ownerId: input.ownerId === undefined ? undefined : input.ownerId,
          updatedAt: new Date(),
        },
      });
      const titulo = input.titulo ?? atual.titulo;
      await tx.activity.create({
        data: perda.motivoNome !== undefined
          ? { tenantId, actor: 'Você', acao: `marcou "${titulo}" como perdido${perda.motivoNome ? ` (${perda.motivoNome})` : ''}`, tone: 'warn', dealId: id }
          : { tenantId, actor: 'Você', acao: `atualizou o negócio "${titulo}"`, tone: 'neutral', dealId: id },
      });
      const statusMudou = input.status !== undefined && input.status !== atual.status;
      const contactId = input.contactId === undefined ? atual.contactId : input.contactId || null;
      return { ok: true, statusMudou, status: input.status ?? atual.status, contactId };
    });
  }

  /**
   * Regra do motivo de perda (Q2.1) no PATCH do negócio:
   *  - virar `perdido`: motivo validado (obrigatório se `exigirMotivoPerda` e há motivos ativos);
   *  - sair de `perdido`: motivo e observação são limpos;
   *  - continuar `perdido`: dá para trocar o motivo/observação;
   *  - motivo em negócio que não está/fica perdido: 400 (não grava dado sem sentido).
   * `motivoNome` definido = o negócio acabou de ser marcado como perdido (atividade).
   */
  private async dadosDePerda(tx: Prisma.TransactionClient, tenantId: string, statusAtual: string, input: UpdateDealInput, opts: UpdateDealOpts) {
    const statusFinal = input.status ?? statusAtual;
    const obs = limparObsPerda(input.motivoPerdaObs);
    const mexeuNoMotivo = input.motivoPerdaId !== undefined || obs !== undefined;
    if (statusFinal !== 'perdido') {
      if (mexeuNoMotivo && (input.motivoPerdaId || obs)) throw new BadRequestException('motivo de perda só vale para negócio perdido');
      return statusAtual === 'perdido' ? { data: { motivoPerdaId: null, motivoPerdaObs: null } } : { data: {} };
    }
    const virouPerdido = statusAtual !== 'perdido';
    if (!virouPerdido && !mexeuNoMotivo) return { data: {} };
    // trocar o motivo de um já perdido segue a mesma regra de obrigatoriedade
    const motivoPerdaId = virouPerdido || input.motivoPerdaId !== undefined
      ? await resolverMotivoPerda(tx, tenantId, input.motivoPerdaId, !!opts.exigirMotivoPerda)
      : undefined;
    const motivoNome = virouPerdido
      ? (motivoPerdaId ? (await tx.lostReason.findUnique({ where: { id: motivoPerdaId }, select: { nome: true } }))?.nome ?? null : null)
      : undefined;
    return { data: { ...(motivoPerdaId !== undefined ? { motivoPerdaId } : {}), ...(obs !== undefined ? { motivoPerdaObs: obs } : {}) }, motivoNome };
  }

  async deleteDeal(tenantId: string, id: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.deal.findUnique({ where: { id }, select: { titulo: true } });
      if (!d) throw new NotFoundException('negócio inexistente');
      await tx.deal.delete({ where: { id } });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `excluiu o negócio "${d.titulo}"`, tone: 'warn' } });
      return { ok: true };
    });
    this.eventos.publicar(tenantId, 'deal.deleted', { id });
    return r;
  }

  async createContact(tenantId: string, input: CreateContactInput) {
    const c = await this.prisma.withTenant(tenantId, async (tx) => {
      const camposCustom = input.camposCustom
        ? await validarCamposNaTransacao(tx, 'contact', input.camposCustom, { exigirObrigatorios: true })
        : undefined;
      const novo = await tx.contact.create({
        data: {
          tenantId,
          nome: input.nome,
          ...(camposCustom ? { camposCustom: camposCustom as Prisma.InputJsonValue } : {}),
          email: input.email ?? null,
          telefone: input.telefone ?? null,
          empresa: input.empresa ?? null,
          tag: input.tag ?? 'Lead',
          valorEstimado: input.valorEstimado ?? 0,
          // BUG-029: a origem informada no cadastro vai para a coluna — é dela que
          // o outbox monta o `contact.created` que o gatilho filtra.
          origem: input.origem?.trim() || null,
          ultimoContatoAt: new Date(),
        },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `adicionou o contato ${novo.nome}`, tone: 'neutral', contactId: novo.id } });
      return novo;
    });

    // Contato novo é gatilho de automação (e atualiza a lista das outras abas).
    // Vale para QUALQUER origem: cadastro manual, import, lead de anúncio.
    this.eventos.publicar(tenantId, 'contact.created', { id: c.id, nome: c.nome, origem: input.origem ?? 'Manual' });
    return { id: c.id };
  }

  /**
   * Quadro de UM funil (o pedido ou o principal). Padrão: só negócios ABERTOS
   * (ganhos/perdidos saem do quadro; etapas de outros funis não se misturam).
   * Q2.1: aceita o filtro do pipeline (busca, dono, origem, tag do contato,
   * faixa de valor, status, criado em) e devolve `totais` sobre o filtrado,
   * `opcoes` (origens/tags do funil para os seletores) e `truncado` acima de
   * LIMITE_QUADRO. `pipelines` alimenta o seletor de funil.
   */
  async pipeline(tenantId: string, pipelineId?: string, filtro: FiltroNegocios = {}) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [funis, etapas, abertos] = await Promise.all([
        tx.pipeline.findMany({ orderBy: { createdAt: 'asc' }, select: { id: true, nome: true } }),
        tx.stage.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, pipelineId: true, nome: true, cor: true, ordem: true } }),
        tx.deal.groupBy({ by: ['pipelineId'], where: { status: ABERTO }, _count: { _all: true } }),
      ]);
      const abertosPorFunil = new Map(abertos.map((a) => [a.pipelineId, a._count._all]));
      // mesma regra de `escolherFunil` (o pedido; senão o com mais abertos; empate = mais antigo), sem carregar os negócios
      const qtd = (id: string) => abertosPorFunil.get(id) ?? 0;
      const funil = funis.find((f) => f.id === pipelineId) ?? (funis.length ? funis.reduce((m, f) => (qtd(f.id) > qtd(m.id) ? f : m), funis[0]) : null);
      const base = {
        pipelineId: funil?.id ?? null,
        pipelines: funis.map((f) => ({ id: f.id, nome: f.nome, abertos: abertosPorFunil.get(f.id) ?? 0 })),
      };
      if (!funil) return { ...base, stages: [], totais: totaisDoFunil([]), opcoes: { origens: [], tags: [] }, truncado: false };

      const [deals, origens, tagsContato] = await Promise.all([
        tx.deal.findMany({
          where: whereDosNegocios(funil.id, filtro),
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: LIMITE_QUADRO + 1,
          select: {
            id: true, titulo: true, valor: true, origem: true, status: true, stageId: true, ownerId: true, createdAt: true, contactId: true,
            contact: { select: { nome: true, ultimoContatoAt: true } },
            motivoPerda: { select: { nome: true } },
          },
        }),
        tx.deal.findMany({ where: { pipelineId: funil.id, origem: { not: null } }, distinct: ['origem'], select: { origem: true }, orderBy: { origem: 'asc' }, take: 100 }),
        tx.$queryRaw<{ tag: string }[]>`
          SELECT DISTINCT t AS tag FROM deals d JOIN contacts c ON c.id = d.contact_id,
            LATERAL unnest(array_append(c.tags, c.tag)) t
          WHERE d.pipeline_id = ${funil.id}::uuid AND t IS NOT NULL AND btrim(t) <> ''
          ORDER BY 1 LIMIT 200`,
      ]);
      const truncado = deals.length > LIMITE_QUADRO;
      const linhas = deals.slice(0, LIMITE_QUADRO).map((d) => ({
        id: d.id, titulo: d.titulo, contato: d.contact?.nome ?? '-', contactId: d.contactId, valor: num(d.valor), origem: d.origem ?? '',
        status: d.status, stageId: d.stageId, ownerId: d.ownerId, createdAt: d.createdAt,
        ultimoContatoAt: d.contact?.ultimoContatoAt ?? null, motivoPerda: d.motivoPerda?.nome ?? null,
      }));
      return {
        ...base,
        stages: etapas
          .filter((e) => e.pipelineId === funil.id)
          .map((s) => ({ id: s.id, nome: s.nome, cor: s.cor, deals: linhas.filter((d) => d.stageId === s.id) })),
        totais: totaisDoFunil(linhas),
        opcoes: { origens: origens.map((o) => o.origem!).filter(Boolean), tags: tagsContato.map((t) => t.tag) },
        truncado,
      };
    });
  }


  async createDeal(tenantId: string, input: CreateDealInput) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const stage = await tx.stage.findUnique({ where: { id: input.stageId } });
      if (!stage) throw new NotFoundException('stage inexistente');
      if (input.contactId && !await tx.contact.findFirst({ where: { id: input.contactId, tenantId }, select: { id: true } })) throw new NotFoundException('contato inexistente');
      const camposCustom = input.camposCustom
        ? await validarCamposNaTransacao(tx, 'deal', input.camposCustom, { exigirObrigatorios: true })
        : undefined;
      const d = await tx.deal.create({
        data: {
          tenantId, titulo: input.titulo, contactId: input.contactId ?? null,
          pipelineId: stage.pipelineId, stageId: stage.id, valor: input.valor ?? 0, origem: input.origem ?? null,
          ...(camposCustom ? { camposCustom: camposCustom as Prisma.InputJsonValue } : {}),
        },
      });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `criou o negócio "${d.titulo}"`, tone: 'neutral', dealId: d.id, contactId: input.contactId ?? null } });
      return { id: d.id, stageId: stage.id };
    });
    // publicado DEPOIS do commit: quem receber o evento e for ao banco tem que achar
    this.eventos.publicar(tenantId, 'deal.created', r);
    return { id: r.id };
  }

  /** Cria um funil (pipeline) com etapas. Base da "Nyro configuradora". */
  async createPipeline(tenantId: string, input: { nome: string; tipo?: string; etapas: string[] }) {
    const CORES = ['#9B4DE0', '#7B2FBE', '#5B1E9E', '#B7791F', '#0E9F6E', '#2563EB', '#DB2777', '#EA580C'];
    const etapas = (input.etapas.length ? input.etapas : ['Novo', 'Em andamento', 'Fechado']).slice(0, 12);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const pl = await tx.pipeline.create({ data: { tenantId, nome: input.nome, tipo: input.tipo ?? 'vendas' } });
      const criadas: { id: string; nome: string }[] = [];
      for (let i = 0; i < etapas.length; i++) {
        const s = await tx.stage.create({ data: { tenantId, pipelineId: pl.id, nome: etapas[i], ordem: i, cor: CORES[i % CORES.length] } });
        criadas.push({ id: s.id, nome: s.nome });
      }
      await tx.activity.create({ data: { tenantId, actor: 'Nyro', acao: `criou o funil "${input.nome}" com ${etapas.length} etapas`, tone: 'green' } });
      return { id: pl.id, nome: pl.nome, etapas: criadas };
    });
  }

  /** Adiciona uma etapa ao fim de um funil existente. */
  async createStage(tenantId: string, input: { pipelineId: string; nome: string; cor?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const pl = await tx.pipeline.findUnique({ where: { id: input.pipelineId }, select: { id: true } });
      if (!pl) throw new NotFoundException('funil inexistente');
      const max = await tx.stage.aggregate({ where: { pipelineId: input.pipelineId }, _max: { ordem: true } });
      const s = await tx.stage.create({ data: { tenantId, pipelineId: input.pipelineId, nome: input.nome, ordem: (max._max.ordem ?? -1) + 1, cor: input.cor ?? '#7B2FBE' } });
      return { id: s.id, nome: s.nome };
    });
  }

  async moveDeal(tenantId: string, dealId: string, stageId: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const stage = await tx.stage.findUnique({ where: { id: stageId } });
      if (!stage) throw new NotFoundException('stage inexistente');
      const antes = await tx.deal.findUnique({ where: { id: dealId }, select: { stageId: true } });
      const res = await tx.deal.updateMany({ where: { id: dealId }, data: { stageId, pipelineId: stage.pipelineId, updatedAt: new Date() } });
      if (res.count === 0) throw new NotFoundException('negócio inexistente');
      const d = await tx.deal.findUnique({ where: { id: dealId } });
      await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `moveu "${d?.titulo}" para ${stage.nome}`, tone: 'neutral', dealId } });
      return { stageAnterior: antes?.stageId ?? null };
    });
    this.eventos.publicar(tenantId, 'deal.moved', { id: dealId, stageId, stageAnterior: r.stageAnterior });
    return { ok: true };
  }

  /**
   * Busca global do CRM (S0-4): contatos, negócios e conversas em uma chamada.
   * Tudo dentro de withTenant — a RLS garante que só o tenant da sessão aparece.
   */
  async search(tenantId: string, q: string, limitPorTipo = 5, modulos?: readonly string[] | null): Promise<SearchResult[]> {
    const termo = q.trim();
    if (termo.length < 2) return [];
    const take = Math.min(Math.max(limitPorTipo, 1), 20);
    const like = { contains: termo, mode: 'insensitive' as const };
    // Mesmo critério das rotas de leitura (auth/modulos.ts): sem o módulo, nem consulta.
    const ve = (rota: string) => moduloLiberado(modulos, modulosDaRota('crm', rota, 'GET'));

    return this.prisma.withTenant(tenantId, async (tx) => {
      const [contatos, negocios, conversas] = await Promise.all([
        !ve('contacts') ? [] : tx.contact.findMany({
          where: { OR: [{ nome: like }, { email: like }, { telefone: like }, { empresa: like }, { tag: like }] },
          orderBy: { ultimoContatoAt: 'desc' },
          take,
          select: { id: true, nome: true, email: true, telefone: true, empresa: true, tag: true },
        }),
        !ve('deals') ? [] : tx.deal.findMany({
          where: { OR: [{ titulo: like }, { origem: like }, { contact: { nome: like } }] },
          orderBy: { updatedAt: 'desc' },
          take,
          select: { id: true, titulo: true, valor: true, status: true, stage: { select: { nome: true } }, contact: { select: { nome: true } } },
        }),
        !ve('conversations') ? [] : tx.conversation.findMany({
          where: { OR: [{ nome: like }, { ultimaPrevia: like }, { messages: { some: { corpo: like } } }] },
          orderBy: { updatedAt: 'desc' },
          take,
          select: { id: true, nome: true, canal: true, ultimaPrevia: true },
        }),
      ]);

      return [
        ...contatos.map((c): SearchResult => ({
          tipo: 'contato',
          id: c.id,
          titulo: c.nome,
          subtitulo: [c.empresa, c.email ?? c.telefone].filter(Boolean).join(' · ') || c.tag,
          url: `/contatos?id=${c.id}`,
        })),
        ...negocios.map((d): SearchResult => ({
          tipo: 'negocio',
          id: d.id,
          titulo: d.titulo,
          subtitulo: [d.contact?.nome, d.stage?.nome, brl(num(d.valor))].filter(Boolean).join(' · '),
          url: `/pipeline?deal=${d.id}`,
        })),
        ...conversas.map((c): SearchResult => ({
          tipo: 'conversa',
          id: c.id,
          titulo: c.nome,
          subtitulo: [c.canal, c.ultimaPrevia].filter(Boolean).join(' · ').slice(0, 90),
          url: `/inbox?c=${c.id}`,
        })),
      ];
    });
  }

  /**
   * Lista LEVE de conversas (sem mensagens). Antes vinham todas as conversas
   * com TODAS as mensagens a cada sincronização: com 405 conversas e 6.572
   * mensagens (cliente real) a tela recarregava megabytes a cada evento.
   * As mensagens de uma conversa saem de `mensagensDaConversa`.
   */
  async listConversations(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.conversation.findMany({
        orderBy: { updatedAt: 'desc' },
        include: { contact: { select: { id: true, telefone: true, email: true, fotoUrl: true } } },
      });
      return rows.map((c) => ({
        id: c.id, nome: c.nome, canal: c.canal, ultimaPrevia: c.ultimaPrevia, naoLidas: c.naoLidas, ultimaHora: c.ultimaHora,
        atendimento: c.atendimento, agentId: c.agentId, assigneeId: c.assigneeId, handoffMotivo: c.handoffMotivo,
        atualizadaEm: c.updatedAt.toISOString(),
        contato: c.contact ? { id: c.contact.id, telefone: c.contact.telefone, email: c.contact.email, fotoUrl: c.contact.fotoUrl } : null,
        mensagens: [] as { id: string; de: string; texto: string; hora: string | null; status: string; agentId: string | null }[],
      }));
    });
  }

  /** As `limite` mensagens mais recentes de UMA conversa, em ordem cronológica. */
  async mensagensDaConversa(tenantId: string, id: string, limite = 300) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const conv = await tx.conversation.findFirst({ where: { id }, select: { id: true, contact: { select: { id: true, fotoEm: true } } } });
      if (!conv) throw new NotFoundException('conversa não encontrada');
      const [total, recentes] = await Promise.all([
        tx.message.count({ where: { conversationId: id } }),
        tx.message.findMany({ where: { conversationId: id }, orderBy: { createdAt: 'desc' }, take: limite }),
      ]);
      // Origem da mensagem (migration 036): nome do workflow/atendente, não só o id
      // — o Inbox não tem como resolver isso sozinho (workflow/user são tenant-scoped).
      const workflowIds = [...new Set(recentes.map((m) => m.workflowId).filter((v): v is string => !!v))];
      const identityIds = [...new Set(recentes.map((m) => m.enviadoPorId).filter((v): v is string => !!v))];
      const [workflows, usuarios] = await Promise.all([
        workflowIds.length ? tx.workflow.findMany({ where: { id: { in: workflowIds } }, select: { id: true, nome: true } }) : Promise.resolve([]),
        identityIds.length ? tx.user.findMany({ where: { identityId: { in: identityIds } }, select: { identityId: true, nome: true } }) : Promise.resolve([]),
      ]);
      const nomeWorkflow = new Map(workflows.map((w) => [w.id, w.nome]));
      const nomeUsuario = new Map(usuarios.map((u) => [u.identityId, u.nome]));
      // Foto de perfil: abrir a conversa agenda a revalidação se a URL assinada
      // venceu (background — a resposta nunca espera a Stevo).
      this.avatares.revalidarSeVencido(tenantId, conv.contact);
      return {
        id, total,
        mensagens: recentes.reverse().map((m) => ({
          id: m.id, de: m.autorTipo, texto: m.corpo, hora: m.hora, status: m.deliveryStatus, agentId: m.agentId, criadaEm: m.createdAt.toISOString(),
          workflowId: m.workflowId, workflowNome: m.workflowId ? nomeWorkflow.get(m.workflowId) ?? null : null,
          enviadoPorId: m.enviadoPorId, enviadoPorNome: m.enviadoPorId ? nomeUsuario.get(m.enviadoPorId) ?? null : null,
        })),
      };
    });
  }

  /** Abrir a conversa zera as não lidas (antes o contador nunca baixava). */
  async marcarConversaLida(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const r = await tx.conversation.updateMany({ where: { id, naoLidas: { gt: 0 } }, data: { naoLidas: 0 } });
      return { ok: true, atualizada: r.count > 0 };
    });
  }

}

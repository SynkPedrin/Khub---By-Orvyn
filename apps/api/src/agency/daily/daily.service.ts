import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AgencyService } from '../agency.service';
import { fusoPadrao } from '../../common/hora';
import {
  AtualizarChecklistSchema,
  AtualizarEventoSchema,
  AtualizarTarefaSchema,
  ChecklistSchema,
  ComentarioSchema,
  CriarEventoSchema,
  CriarTarefaSchema,
  TIPOS_CONTEUDO,
  ehConteudo,
  inicioDoDia,
  lerFiltros,
  transicao,
  validar,
  type FiltrosTarefa,
} from './daily.catalogo';

/** Quem está agindo: membro da agência + o que ele enxerga. Resolvido SEMPRE pela identidade da sessão. */
interface Ator {
  agencyId: string;
  memberId: string;
  role: string;
  /** Subcontas visíveis (id → nome). */
  clientes: Map<string, string>;
}

const LIMITE_LISTA = 500;
const SELECT_TAREFA = {
  id: true,
  numero: true,
  titulo: true,
  tipo: true,
  status: true,
  prioridade: true,
  inicioEm: true,
  prazoEm: true,
  posicao: true,
  concluidaEm: true,
  arquivadaEm: true,
  clientAccountId: true,
  responsavelId: true,
  parentId: true,
  plataformas: true,
  legenda: true,
  exigeLegenda: true,
  publicarEm: true,
  aprovacao: true,
  publicadoEm: true,
  createdAt: true,
  parent: { select: { id: true, titulo: true } },
  checklist: { select: { feito: true } },
  _count: { select: { subtarefas: { where: { arquivadaEm: null } }, comentarios: true } },
} satisfies Prisma.AgencyTaskSelect;
type LinhaTarefa = Prisma.AgencyTaskGetPayload<{ select: typeof SELECT_TAREFA }>;

/**
 * Daily da agência (ADR-0050): tarefas, Studio e calendário da EQUIPE da
 * agência, acima das subcontas. Regras de acesso:
 * - a agência vem da identidade (nunca de id vindo do cliente);
 * - tarefa/evento sem cliente = interno, visível para toda a equipe;
 * - com cliente, só para quem enxerga aquela subconta (mesma regra de Clientes);
 * - visualizador só lê.
 */
@Injectable()
export class AgencyDailyService {
  /** Nome de exibição por membro (vem do `users` do tenant padrão da pessoa). Cache curto: muda raramente. */
  private nomes = new Map<string, { em: number; mapa: Map<string, { nome: string; email: string }> }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly agency: AgencyService,
  ) {}

  // ───────────────────────────── acesso ─────────────────────────────

  private async ator(identityId: string): Promise<Ator> {
    const e = await this.agency.escopo(identityId);
    if (!e) throw new ForbiddenException('identidade não pertence a nenhuma agência');
    return {
      agencyId: e.membro.agencyId,
      memberId: e.membro.id,
      role: e.membro.role,
      clientes: new Map(e.clientes.map((c) => [c.id, c.displayName])),
    };
  }

  private exigeEscrita(a: Ator): void {
    if (a.role === 'viewer') throw new ForbiddenException('visualizador não pode alterar o Daily');
  }

  /** Recorte de visibilidade: da agência e (interno OU subconta visível). */
  private escopoTarefa(a: Ator): Prisma.AgencyTaskWhereInput {
    return { agencyId: a.agencyId, OR: [{ clientAccountId: null }, { clientAccountId: { in: [...a.clientes.keys()] } }] };
  }

  private async tarefaVisivel(a: Ator, id: string) {
    const t = await this.prisma.agencyTask.findFirst({ where: { AND: [{ id }, this.escopoTarefa(a)] } });
    if (!t) throw new NotFoundException('tarefa não encontrada');
    return t;
  }

  private validarCliente(a: Ator, clientId: string | null | undefined): void {
    if (clientId && !a.clientes.has(clientId)) throw new ForbiddenException('cliente inválido para esta agência');
  }

  private async validarMembros(a: Ator, ids: (string | null | undefined)[]): Promise<void> {
    const lista = [...new Set(ids.filter((x): x is string => !!x))];
    if (!lista.length) return;
    const n = await this.prisma.agencyMember.count({ where: { agencyId: a.agencyId, id: { in: lista } } });
    if (n !== lista.length) throw new BadRequestException({ message: 'responsável ou participante não é da equipe', code: 'daily_invalido' });
  }

  private async nomesDosMembros(agencyId: string): Promise<Map<string, { nome: string; email: string }>> {
    const c = this.nomes.get(agencyId);
    if (c && Date.now() - c.em < 60_000) return c.mapa;
    const membros = await this.prisma.agencyMember.findMany({ where: { agencyId }, select: { id: true, identityId: true } });
    const identidades = await this.prisma.identity.findMany({ where: { id: { in: membros.map((m) => m.identityId) } }, select: { id: true, email: true } });
    const email = new Map(identidades.map((i) => [i.id, i.email]));
    const vinculos = await this.prisma.membership.findMany({
      where: { identityId: { in: membros.map((m) => m.identityId) } },
      orderBy: [{ isDefault: 'desc' }],
      select: { identityId: true, tenantId: true },
    });
    const mapa = new Map<string, { nome: string; email: string }>();
    for (const m of membros) {
      const mail = email.get(m.identityId) ?? '';
      let nome = '';
      const tenant = vinculos.find((v) => v.identityId === m.identityId)?.tenantId;
      if (tenant) {
        const u = await this.prisma
          .withTenant(tenant, (tx) => tx.user.findFirst({ where: { identityId: m.identityId }, select: { nome: true } }))
          .catch(() => null);
        nome = u?.nome?.trim() ?? '';
      }
      mapa.set(m.id, { nome: nome || nomeDoEmail(mail), email: mail });
    }
    this.nomes.set(agencyId, { em: Date.now(), mapa });
    return mapa;
  }

  // ───────────────────────────── base ─────────────────────────────

  /** Tudo que as telas do Daily precisam para montar filtros e seletores. */
  async base(identityId: string) {
    const a = await this.ator(identityId);
    const nomes = await this.nomesDosMembros(a.agencyId);
    const membros = await this.prisma.agencyMember.findMany({ where: { agencyId: a.agencyId }, orderBy: { createdAt: 'asc' }, select: { id: true, role: true } });
    return {
      eu: a.memberId,
      role: a.role,
      podeEditar: a.role !== 'viewer',
      fuso: fusoPadrao(),
      membros: membros.map((m) => ({ id: m.id, role: m.role, ...(nomes.get(m.id) ?? { nome: 'Membro', email: '' }) })),
      clientes: [...a.clientes].map(([id, nome]) => ({ id, nome })),
    };
  }

  // ───────────────────────────── tarefas ─────────────────────────────

  async listar(identityId: string, query: Record<string, unknown>, studio = false) {
    const a = await this.ator(identityId);
    const f = lerFiltros(query, studio);
    const linhas = await this.prisma.agencyTask.findMany({
      where: { AND: [this.escopoTarefa(a), ...this.whereFiltros(a, f)] },
      orderBy: [{ posicao: 'asc' }, { prazoEm: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      take: LIMITE_LISTA,
      select: SELECT_TAREFA,
    });
    const nomes = await this.nomesDosMembros(a.agencyId);
    return linhas.map((t) => this.resumo(a, nomes, t));
  }

  private whereFiltros(a: Ator, f: FiltrosTarefa): Prisma.AgencyTaskWhereInput[] {
    const and: Prisma.AgencyTaskWhereInput[] = [];
    and.push(f.arquivadas ? { arquivadaEm: { not: null } } : { arquivadaEm: null });
    // "Todas" mostra só tarefas principais (subtarefas aparecem dentro delas); "Minhas" inclui subtarefas atribuídas.
    if (f.escopo === 'minhas') and.push({ responsavelId: a.memberId });
    else if (!f.responsavel || f.studio) and.push({ parentId: null });
    if (f.studio) and.push({ tipo: { in: [...TIPOS_CONTEUDO] }, parentId: null });
    if (f.clientId === 'interno') and.push({ clientAccountId: null });
    else if (f.clientId) and.push({ clientAccountId: f.clientId });
    if (f.escopo === 'todas' && f.responsavel) {
      and.push({ responsavelId: f.responsavel === 'eu' ? a.memberId : f.responsavel === 'nenhum' ? null : f.responsavel });
    }
    if (f.status.length) and.push({ status: { in: f.status } });
    if (f.tipo.length) and.push({ tipo: { in: f.tipo } });
    if (f.prioridade.length) and.push({ prioridade: { in: f.prioridade } });
    if (f.aprovacao.length) and.push({ aprovacao: { in: f.aprovacao } });
    if (f.plataforma.length) and.push({ plataformas: { hasSome: f.plataforma } });
    if (f.prazo) {
      const fuso = fusoPadrao();
      const hoje = inicioDoDia(fuso);
      const amanha = inicioDoDia(fuso, new Date(), 1);
      if (f.prazo === 'sem') and.push({ prazoEm: null });
      else if (f.prazo === 'atrasadas') and.push({ prazoEm: { lt: hoje }, status: { not: 'concluida' } });
      else if (f.prazo === 'hoje') and.push({ prazoEm: { gte: hoje, lt: amanha } });
      else and.push({ prazoEm: { gte: hoje, lt: inicioDoDia(fuso, new Date(), 7) } });
    }
    if (f.q) {
      const ids = [...a.clientes].filter(([, nome]) => nome.toLowerCase().includes(f.q!.toLowerCase())).map(([id]) => id);
      const numero = /^#?\d{1,12}$/.test(f.q) ? BigInt(f.q.replace('#', '')) : null;
      and.push({
        OR: [
          { titulo: { contains: f.q, mode: 'insensitive' } },
          { legenda: { contains: f.q, mode: 'insensitive' } },
          ...(ids.length ? [{ clientAccountId: { in: ids } }] : []),
          ...(numero !== null ? [{ numero }] : []),
        ],
      });
    }
    return and;
  }

  private resumo(a: Ator, nomes: Map<string, { nome: string; email: string }>, t: LinhaTarefa) {
    const cliente = t.clientAccountId ? { id: t.clientAccountId, nome: a.clientes.get(t.clientAccountId) ?? 'Cliente' } : null;
    const resp = t.responsavelId ? nomes.get(t.responsavelId) : undefined;
    return {
      id: t.id,
      numero: Number(t.numero),
      titulo: t.titulo,
      tipo: t.tipo,
      status: t.status,
      prioridade: t.prioridade,
      inicioEm: t.inicioEm,
      prazoEm: t.prazoEm,
      posicao: t.posicao,
      concluidaEm: t.concluidaEm,
      arquivada: !!t.arquivadaEm,
      cliente,
      responsavel: t.responsavelId ? { id: t.responsavelId, nome: resp?.nome ?? 'Ex-membro' } : null,
      parent: t.parent,
      subtarefas: t._count.subtarefas,
      comentarios: t._count.comentarios,
      checklist: { feitos: t.checklist.filter((c) => c.feito).length, total: t.checklist.length },
      conteudo: ehConteudo(t.tipo)
        ? {
            aprovacao: t.aprovacao ?? 'em_producao',
            plataformas: t.plataformas,
            publicarEm: t.publicarEm,
            publicadoEm: t.publicadoEm,
            exigeLegenda: t.exigeLegenda,
            temLegenda: !!t.legenda?.trim(),
          }
        : null,
      createdAt: t.createdAt,
    };
  }

  async detalhe(identityId: string, id: string) {
    const a = await this.ator(identityId);
    await this.tarefaVisivel(a, id);
    const t = await this.prisma.agencyTask.findUniqueOrThrow({
      where: { id },
      select: {
        ...SELECT_TAREFA,
        descricao: true,
        objetivo: true,
        hashtags: true,
        cta: true,
        criadorId: true,
        updatedAt: true,
        checklist: { orderBy: [{ posicao: 'asc' }, { createdAt: 'asc' }], select: { id: true, texto: true, feito: true } },
        comentarios: { orderBy: { createdAt: 'asc' }, select: { id: true, autorId: true, corpo: true, createdAt: true } },
        subtarefas: { where: { arquivadaEm: null }, orderBy: [{ posicao: 'asc' }, { createdAt: 'asc' }], select: SELECT_TAREFA },
      },
    });
    const nomes = await this.nomesDosMembros(a.agencyId);
    return {
      ...this.resumo(a, nomes, { ...t, checklist: t.checklist }),
      descricao: t.descricao,
      legenda: t.legenda,
      objetivo: t.objetivo,
      hashtags: t.hashtags,
      cta: t.cta,
      exigeLegenda: t.exigeLegenda,
      plataformas: t.plataformas,
      publicarEm: t.publicarEm,
      aprovacao: t.aprovacao,
      criador: t.criadorId ? { id: t.criadorId, nome: nomes.get(t.criadorId)?.nome ?? 'Ex-membro' } : null,
      updatedAt: t.updatedAt,
      itens: t.checklist,
      // Subtarefas de cliente não visível ficam de fora (mesmo recorte da lista).
      filhas: t.subtarefas.filter((s) => !s.clientAccountId || a.clientes.has(s.clientAccountId)).map((s) => this.resumo(a, nomes, s)),
      conversa: t.comentarios.map((c) => ({
        id: c.id,
        corpo: c.corpo,
        createdAt: c.createdAt,
        autor: c.autorId ? { id: c.autorId, nome: nomes.get(c.autorId)?.nome ?? 'Ex-membro' } : null,
        meu: c.autorId === a.memberId,
      })),
    };
  }

  async criar(identityId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const input = validar(CriarTarefaSchema, bruto);
    let clientId = input.clientId;
    if (input.parentId) {
      const pai = await this.tarefaVisivel(a, input.parentId);
      if (pai.parentId) throw new BadRequestException({ message: 'subtarefa não pode ter subtarefa', code: 'daily_invalido' });
      if (clientId === undefined) clientId = pai.clientAccountId;
    }
    this.validarCliente(a, clientId);
    await this.validarMembros(a, [input.responsavelId]);
    const tipo = input.tipo ?? 'outro';
    const status = input.status ?? 'a_fazer';
    // Entra no fim da coluna.
    const ultima = await this.prisma.agencyTask.findFirst({
      where: { agencyId: a.agencyId, status, arquivadaEm: null },
      orderBy: { posicao: 'desc' },
      select: { posicao: true },
    });
    const aprovacao = ehConteudo(tipo) ? (input.aprovacao ?? 'em_producao') : null;
    const criada = await this.prisma.agencyTask.create({
      data: {
        agencyId: a.agencyId,
        criadorId: a.memberId,
        titulo: input.titulo,
        descricao: input.descricao ?? null,
        tipo,
        status,
        prioridade: input.prioridade ?? 'normal',
        clientAccountId: clientId ?? null,
        responsavelId: input.responsavelId ?? null,
        parentId: input.parentId ?? null,
        inicioEm: input.inicioEm ?? null,
        prazoEm: input.prazoEm ?? null,
        posicao: (ultima?.posicao ?? 0) + 1024,
        concluidaEm: status === 'concluida' ? new Date() : null,
        plataformas: input.plataformas ?? [],
        objetivo: input.objetivo ?? null,
        legenda: input.legenda ?? null,
        hashtags: input.hashtags ?? null,
        cta: input.cta ?? null,
        exigeLegenda: input.exigeLegenda ?? true,
        publicarEm: input.publicarEm ?? null,
        aprovacao,
        publicadoEm: aprovacao === 'publicado' ? new Date() : null,
      },
      select: { id: true },
    });
    return this.detalhe(identityId, criada.id);
  }

  async atualizar(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const atual = await this.tarefaVisivel(a, id);
    const input = validar(AtualizarTarefaSchema, bruto);
    if (input.clientId !== undefined) this.validarCliente(a, input.clientId);
    await this.validarMembros(a, [input.responsavelId]);
    const efeitos = transicao(atual, { status: input.status, tipo: input.tipo, aprovacao: input.aprovacao });
    const { clientId, arquivada, ...resto } = input;
    await this.prisma.agencyTask.update({
      where: { id },
      data: {
        ...resto,
        ...efeitos,
        ...(clientId !== undefined ? { clientAccountId: clientId } : {}),
        ...(arquivada !== undefined ? { arquivadaEm: arquivada ? (atual.arquivadaEm ?? new Date()) : null } : {}),
      },
    });
    return this.detalhe(identityId, id);
  }

  /** Exclusão definitiva: só quem criou ou owner/admin (o normal é arquivar). */
  async excluir(identityId: string, id: string) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const t = await this.tarefaVisivel(a, id);
    if (t.criadorId !== a.memberId && !['owner', 'admin'].includes(a.role)) {
      throw new ForbiddenException('só quem criou a tarefa ou um admin pode excluir; arquive em vez disso');
    }
    await this.prisma.agencyTask.delete({ where: { id } });
    return { ok: true };
  }

  // ───────────────────────────── checklist e comentários ─────────────────────────────

  async adicionarItem(identityId: string, taskId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    await this.tarefaVisivel(a, taskId);
    const { texto } = validar(ChecklistSchema, bruto);
    const n = await this.prisma.agencyTaskChecklist.count({ where: { taskId } });
    if (n >= 100) throw new BadRequestException({ message: 'limite de 100 itens por checklist', code: 'daily_invalido' });
    return this.prisma.agencyTaskChecklist.create({ data: { taskId, texto, posicao: n }, select: { id: true, texto: true, feito: true } });
  }

  private async itemVisivel(a: Ator, itemId: string) {
    const item = await this.prisma.agencyTaskChecklist.findUnique({ where: { id: itemId }, select: { id: true, taskId: true } });
    if (!item) throw new NotFoundException('item não encontrado');
    await this.tarefaVisivel(a, item.taskId);
    return item;
  }

  async atualizarItem(identityId: string, itemId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    await this.itemVisivel(a, itemId);
    const input = validar(AtualizarChecklistSchema, bruto);
    return this.prisma.agencyTaskChecklist.update({ where: { id: itemId }, data: input, select: { id: true, texto: true, feito: true } });
  }

  async removerItem(identityId: string, itemId: string) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    await this.itemVisivel(a, itemId);
    await this.prisma.agencyTaskChecklist.delete({ where: { id: itemId } });
    return { ok: true };
  }

  async comentar(identityId: string, taskId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    await this.tarefaVisivel(a, taskId);
    const { corpo } = validar(ComentarioSchema, bruto);
    const c = await this.prisma.agencyTaskComentario.create({ data: { taskId, autorId: a.memberId, corpo } });
    const nomes = await this.nomesDosMembros(a.agencyId);
    return { id: c.id, corpo: c.corpo, createdAt: c.createdAt, autor: { id: a.memberId, nome: nomes.get(a.memberId)?.nome ?? 'Você' }, meu: true };
  }

  async removerComentario(identityId: string, comentarioId: string) {
    const a = await this.ator(identityId);
    const c = await this.prisma.agencyTaskComentario.findUnique({ where: { id: comentarioId } });
    if (!c) throw new NotFoundException('comentário não encontrado');
    await this.tarefaVisivel(a, c.taskId);
    if (c.autorId !== a.memberId && !['owner', 'admin'].includes(a.role)) throw new ForbiddenException('só o autor ou um admin remove o comentário');
    await this.prisma.agencyTaskComentario.delete({ where: { id: comentarioId } });
    return { ok: true };
  }

  // ───────────────────────────── calendário ─────────────────────────────

  private escopoEvento(a: Ator): Prisma.AgencyEventWhereInput {
    return { agencyId: a.agencyId, OR: [{ clientAccountId: null }, { clientAccountId: { in: [...a.clientes.keys()] } }] };
  }

  /**
   * Itens do calendário no intervalo: eventos, prazos de tarefas e datas de
   * publicação do Studio. Janela máxima de 62 dias (mês + folgas).
   */
  async calendario(identityId: string, query: Record<string, unknown>) {
    const a = await this.ator(identityId);
    const de = new Date(String(query.de ?? ''));
    const ate = new Date(String(query.ate ?? ''));
    if (Number.isNaN(de.getTime()) || Number.isNaN(ate.getTime()) || ate <= de) {
      throw new BadRequestException({ message: 'intervalo inválido (use de/ate em ISO)', code: 'daily_invalido' });
    }
    if (ate.getTime() - de.getTime() > 62 * 86_400_000) throw new BadRequestException({ message: 'intervalo máximo de 62 dias', code: 'daily_invalido' });
    const cliente = typeof query.cliente === 'string' && query.cliente ? query.cliente : undefined;
    const filtroCliente = cliente === 'interno' ? { clientAccountId: null } : cliente ? { clientAccountId: cliente } : {};
    const soMeus = query.meus === '1';

    const [eventos, prazos, publicacoes, nomes] = await Promise.all([
      this.prisma.agencyEvent.findMany({
        where: {
          AND: [
            this.escopoEvento(a),
            filtroCliente,
            // Evento que começa antes da janela e termina dentro dela também aparece.
            { OR: [{ inicioEm: { gte: de, lt: ate } }, { inicioEm: { lt: de }, fimEm: { gte: de } }] },
            ...(soMeus ? [{ OR: [{ criadorId: a.memberId }, { participantes: { some: { memberId: a.memberId } } }] }] : []),
          ],
        },
        orderBy: { inicioEm: 'asc' },
        include: { participantes: { select: { memberId: true } } },
        take: 1000,
      }),
      this.prisma.agencyTask.findMany({
        where: { AND: [this.escopoTarefa(a), filtroCliente, { arquivadaEm: null, prazoEm: { gte: de, lt: ate } }, ...(soMeus ? [{ responsavelId: a.memberId }] : [])] },
        orderBy: { prazoEm: 'asc' },
        select: { id: true, numero: true, titulo: true, tipo: true, status: true, prioridade: true, prazoEm: true, clientAccountId: true, responsavelId: true },
        take: 1000,
      }),
      this.prisma.agencyTask.findMany({
        where: {
          AND: [
            this.escopoTarefa(a),
            filtroCliente,
            { arquivadaEm: null, tipo: { in: [...TIPOS_CONTEUDO] }, publicarEm: { gte: de, lt: ate } },
            ...(soMeus ? [{ responsavelId: a.memberId }] : []),
          ],
        },
        orderBy: { publicarEm: 'asc' },
        select: { id: true, numero: true, titulo: true, tipo: true, aprovacao: true, publicarEm: true, publicadoEm: true, clientAccountId: true, responsavelId: true },
        take: 1000,
      }),
      this.nomesDosMembros(a.agencyId),
    ]);

    const cli = (id: string | null) => (id ? { id, nome: a.clientes.get(id) ?? 'Cliente' } : null);
    const pessoa = (id: string | null) => (id ? { id, nome: nomes.get(id)?.nome ?? 'Ex-membro' } : null);
    return {
      itens: [
        ...eventos.map((e) => ({
          chave: `evento:${e.id}`,
          origem: 'evento' as const,
          id: e.id,
          titulo: e.titulo,
          inicio: e.inicioEm,
          fim: e.fimEm,
          diaInteiro: e.diaInteiro,
          local: e.local,
          notas: e.notas,
          cliente: cli(e.clientAccountId),
          participantes: e.participantes.map((p) => pessoa(p.memberId)!),
          criador: pessoa(e.criadorId),
        })),
        ...prazos.map((t) => ({
          chave: `prazo:${t.id}`,
          origem: 'prazo' as const,
          id: t.id,
          numero: Number(t.numero),
          titulo: t.titulo,
          inicio: t.prazoEm!,
          tipo: t.tipo,
          status: t.status,
          prioridade: t.prioridade,
          concluida: t.status === 'concluida',
          cliente: cli(t.clientAccountId),
          responsavel: pessoa(t.responsavelId),
        })),
        ...publicacoes.map((t) => ({
          chave: `publicacao:${t.id}`,
          origem: 'publicacao' as const,
          id: t.id,
          numero: Number(t.numero),
          titulo: t.titulo,
          inicio: t.publicarEm!,
          tipo: t.tipo,
          aprovacao: t.aprovacao ?? 'em_producao',
          concluida: !!t.publicadoEm,
          cliente: cli(t.clientAccountId),
          responsavel: pessoa(t.responsavelId),
        })),
      ],
    };
  }

  private async eventoVisivel(a: Ator, id: string) {
    const e = await this.prisma.agencyEvent.findFirst({ where: { AND: [{ id }, this.escopoEvento(a)] } });
    if (!e) throw new NotFoundException('evento não encontrado');
    return e;
  }

  async criarEvento(identityId: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const input = validar(CriarEventoSchema, bruto);
    this.validarCliente(a, input.clientId);
    await this.validarMembros(a, input.participantes ?? []);
    const e = await this.prisma.agencyEvent.create({
      data: {
        agencyId: a.agencyId,
        criadorId: a.memberId,
        titulo: input.titulo,
        inicioEm: input.inicioEm,
        fimEm: input.fimEm ?? null,
        diaInteiro: input.diaInteiro ?? false,
        local: input.local ?? null,
        notas: input.notas ?? null,
        clientAccountId: input.clientId ?? null,
        participantes: { create: (input.participantes ?? []).map((memberId) => ({ memberId })) },
      },
    });
    return { id: e.id };
  }

  async atualizarEvento(identityId: string, id: string, bruto: unknown) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    const atual = await this.eventoVisivel(a, id);
    const input = validar(AtualizarEventoSchema, bruto);
    if (input.clientId !== undefined) this.validarCliente(a, input.clientId);
    if (input.participantes) await this.validarMembros(a, input.participantes);
    const inicio = input.inicioEm ?? atual.inicioEm;
    const fim = input.fimEm !== undefined ? input.fimEm : atual.fimEm;
    if (fim && fim < inicio) throw new BadRequestException({ message: 'o fim precisa ser depois do início', code: 'daily_invalido' });
    const { clientId, participantes, ...resto } = input;
    await this.prisma.$transaction(async (tx) => {
      await tx.agencyEvent.update({
        where: { id },
        data: { ...resto, ...(clientId !== undefined ? { clientAccountId: clientId } : {}) },
      });
      if (participantes) {
        await tx.agencyEventParticipante.deleteMany({ where: { eventId: id } });
        if (participantes.length) await tx.agencyEventParticipante.createMany({ data: participantes.map((memberId) => ({ eventId: id, memberId })) });
      }
    });
    return { ok: true };
  }

  async removerEvento(identityId: string, id: string) {
    const a = await this.ator(identityId);
    this.exigeEscrita(a);
    await this.eventoVisivel(a, id);
    await this.prisma.agencyEvent.delete({ where: { id } });
    return { ok: true };
  }
}

/** "maria.souza@x.com" → "Maria Souza" (fallback quando a pessoa não tem nome cadastrado). */
export function nomeDoEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const nome = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(' ');
  return nome || 'Membro';
}

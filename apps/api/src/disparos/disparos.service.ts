import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Broadcast, type BroadcastRecipient } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService, ConfigRequiredException } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { NotificationsService } from '../common/notifications.service';
import { MessagesService } from '../crm/messaging/messages.service';
import { htmlDeTexto, interpolarContato, VARIAVEIS_CONTATO } from '../common/variaveis-contato';
import { JANELA_PADRAO, dentroDaJanela, inicioDoDiaLocal, janelaSchema, proximaAbertura, proximoDiaLocal, type JanelaEnvio } from './janela';
import { destinoDoContato, elegibilidade, parseSegmento, segmentoSchema, whereDoSegmento, type Canal, type Segmento } from './segmento';

/** Teto de audiência por disparo (o congelamento roda numa transação só). */
export const LIMITE_AUDIENCIA = 20_000;
/** Janela em que uma resposta do contato conta como "respondeu" ao disparo. */
export const JANELA_RESPOSTA_MS = 72 * 3_600_000;
/** Quanto tempo um worker segura o disparo enquanto manda um lote. */
const LEASE_MS = 5 * 60_000;
/** Provedor limitou a taxa: espera antes do próximo lote. */
const ESPERA_RATE_LIMIT_MS = 2 * 60_000;

export const STATUS_DISPARO = ['rascunho', 'aguardando_aprovacao', 'agendado', 'enviando', 'pausado', 'concluido', 'cancelado'] as const;
export type StatusDisparo = (typeof STATUS_DISPARO)[number];
export const STATUS_DESTINATARIO = ['pendente', 'enviado', 'falhou', 'ignorado_optout', 'ignorado_sem_canal', 'respondeu'] as const;
export type StatusDestinatario = (typeof STATUS_DESTINATARIO)[number];

/** Quem age: humano (com papel) ou a Nyro em nome de alguém. */
export interface Ator {
  tipo: 'humano' | 'nyro';
  identityId: string;
  role: string;
}

const base = z.object({
  nome: z.string().trim().min(1).max(120),
  canal: z.enum(['whatsapp', 'email']),
  mensagem: z.string().max(4000),
  assunto: z.string().trim().max(200).nullable(),
  segmento: segmentoSchema,
  agendadoPara: z.string().datetime({ offset: true }).nullable(),
  loteTamanho: z.number().int().min(1).max(500),
  loteIntervaloSeg: z.number().int().min(10).max(86_400),
  janela: janelaSchema,
});
export const criarDisparoSchema = base.partial({ mensagem: true, assunto: true, segmento: true, agendadoPara: true, loteTamanho: true, loteIntervaloSeg: true, janela: true }).strict();
export const atualizarDisparoSchema = base.partial().strict();
export type CriarDisparo = z.infer<typeof criarDisparoSchema>;
export type AtualizarDisparo = z.infer<typeof atualizarDisparoSchema>;

export const audienciaSchema = z.object({ canal: z.enum(['whatsapp', 'email']), segmento: segmentoSchema.default({}) }).strict();
export const previaSchema = z.object({
  canal: z.enum(['whatsapp', 'email']),
  mensagem: z.string().max(4000),
  assunto: z.string().max(200).nullable().optional(),
  contactId: z.string().uuid().optional(),
  segmento: segmentoSchema.optional(),
}).strict();
export const rejeitarSchema = z.object({ motivo: z.string().trim().min(1).max(500) }).strict();

export function validar<S extends z.ZodTypeAny>(schema: S, bruto: unknown): z.infer<S> {
  const r = schema.safeParse(bruto ?? {});
  if (!r.success) throw new BadRequestException(r.error.issues.map((i) => `${i.path.join('.') || 'corpo'}: ${i.message}`).join('; '));
  return r.data;
}

/** Resultado do envio a UM destinatário, já traduzido para o disparo. */
export type DesfechoEnvio =
  | { tipo: 'enviado'; messageId: string | null }
  | { tipo: 'ignorado_optout' }
  | { tipo: 'ignorado_sem_canal' }
  | { tipo: 'falhou'; erro: string }
  /** Nada saiu e vale tentar de novo com a MESMA chave (provedor limitou a taxa). */
  | { tipo: 'adiar' }
  /** Problema do canal, não do contato: pausa o disparo inteiro. */
  | { tipo: 'pausar'; motivo: 'config_required' | 'canal_desconectado' | 'bloqueado_dev'; detalhe?: Record<string, unknown> };

/**
 * Status do `MessagesService.send` → desfecho do destinatário. Puro (testado).
 * `unknown` NUNCA é reenviado: o provedor pode ter aceitado (mesma regra do envio).
 */
export function desfechoWhatsApp(r: { id: string; status: string; erro?: string | null; provider?: string; missing?: string[] }): DesfechoEnvio {
  switch (r.status) {
    case 'sent': return { tipo: 'enviado', messageId: r.id };
    case 'cancelled': return { tipo: 'ignorado_optout' };
    case 'sem_telefone': return { tipo: 'ignorado_sem_canal' };
    case 'pending': return { tipo: 'adiar' };
    case 'config_required': return { tipo: 'pausar', motivo: 'config_required', detalhe: { provider: r.provider ?? 'whatsapp', missing: r.missing ?? [] } };
    case 'canal_desconectado': return { tipo: 'pausar', motivo: 'canal_desconectado' };
    case 'bloqueado_dev': return { tipo: 'pausar', motivo: 'bloqueado_dev', detalhe: { missing: ['STEVO_TEST_NUMBER'] } };
    case 'unknown': return { tipo: 'falhou', erro: 'entrega não confirmada pelo provedor (não reenviado)' };
    default: return { tipo: 'falhou', erro: r.erro ?? `falha no envio (${r.status})` };
  }
}

function inteiroEnv(v: string | undefined, padrao: number, min: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= min ? n : padrao;
}

type Tx = Prisma.TransactionClient;

/**
 * Disparo em massa por segmento (Q4.3). Regras (RegrasNegocio §2 e §5):
 *  - audiência CONGELADA ao aprovar (snapshot em broadcast_recipients);
 *  - opt-out e contato sem telefone/e-mail ficam fora (registrados como ignorados);
 *  - aprovação de owner/admin quando a audiência passa do limite e SEMPRE
 *    quando a Nyro criou (human-in-the-loop em disparo em massa);
 *  - envio em lotes dentro da janela, com limite diário por tenant;
 *  - idempotente por destinatário: reserva (`tentativa_em`) antes de mandar e
 *    chave de idempotência derivada dela. Retry não duplica.
 */
@Injectable()
export class DisparosService {
  private readonly log = new Logger('Disparos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mensagens: MessagesService,
    private readonly mailer: MailerService,
    private readonly notificacoes: NotificationsService,
  ) {}

  // ------------------------------------------------------------ limites

  limites() {
    return {
      aprovacaoAcima: inteiroEnv(this.config.get('DISPAROS_APROVACAO_ACIMA'), 50, 0),
      diario: {
        whatsapp: inteiroEnv(this.config.get('DISPAROS_LIMITE_DIARIO_WHATSAPP'), 300, 1),
        email: inteiroEnv(this.config.get('DISPAROS_LIMITE_DIARIO_EMAIL'), 2000, 1),
      },
    };
  }

  async limitesDoTenant(tenantId: string, fuso = JANELA_PADRAO.fuso, agora = new Date()) {
    const l = this.limites();
    const usados = await this.prisma.withTenant(tenantId, async (tx) => ({
      whatsapp: await this.usadosHoje(tx, 'whatsapp', fuso, agora),
      email: await this.usadosHoje(tx, 'email', fuso, agora),
    }));
    return { ...l, usadosHoje: usados, fuso, canais: { email: { configurado: this.mailer.configured(), missing: this.mailer.missing() } } };
  }

  private async usadosHoje(tx: Tx, canal: Canal, fuso: string, agora: Date): Promise<number> {
    const desde = inicioDoDiaLocal(agora, fuso);
    const rows = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM broadcast_recipients r JOIN broadcasts b ON b.id = r.broadcast_id
      WHERE r.enviado_em >= ${desde} AND b.canal = ${canal}`;
    return Number(rows[0]?.n ?? 0);
  }

  // ------------------------------------------------------------ leitura

  async listar(tenantId: string, status?: string) {
    if (status && !(STATUS_DISPARO as readonly string[]).includes(status)) throw new BadRequestException('status inválido');
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.broadcast.findMany({ where: status ? { status } : undefined, orderBy: { createdAt: 'desc' }, take: 200 }),
    ).then((l) => l.map((b) => this.dto(b)));
  }

  async detalhe(tenantId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await tx.broadcast.findUnique({ where: { id } });
      if (!b) throw new NotFoundException('disparo não encontrado');
      const grupos = await tx.broadcastRecipient.groupBy({ by: ['status'], where: { broadcastId: id }, _count: { _all: true } });
      const porStatus = Object.fromEntries(STATUS_DESTINATARIO.map((s) => [s, 0])) as Record<StatusDestinatario, number>;
      for (const g of grupos) porStatus[g.status as StatusDestinatario] = g._count._all;
      return { ...this.dto(b), porStatus };
    });
  }

  async destinatarios(tenantId: string, id: string, q: { status?: string; busca?: string; cursor?: string; limit?: number }) {
    if (q.status && !(STATUS_DESTINATARIO as readonly string[]).includes(q.status)) throw new BadRequestException('status inválido');
    if (q.cursor && !/^[0-9a-f-]{36}$/i.test(q.cursor)) throw new BadRequestException('cursor inválido');
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.broadcast.findUnique({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('disparo não encontrado');
      const where: Prisma.BroadcastRecipientWhereInput = {
        broadcastId: id,
        ...(q.status ? { status: q.status } : {}),
        ...(q.busca ? { OR: [{ nome: { contains: q.busca, mode: 'insensitive' } }, { destino: { contains: q.busca, mode: 'insensitive' } }] } : {}),
      };
      const rows = await tx.broadcastRecipient.findMany({
        where, orderBy: { id: 'asc' }, take: limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
        select: { id: true, contactId: true, nome: true, destino: true, status: true, erro: true, enviadoEm: true, respondidoEm: true },
      });
      const mais = rows.length > limit;
      const items = mais ? rows.slice(0, limit) : rows;
      return { items, nextCursor: mais ? items[items.length - 1].id : null };
    });
  }

  /** Contagem ao vivo do segmento (passo 2 do assistente). Não grava nada. */
  async audiencia(tenantId: string, identityId: string | null, canal: Canal, segBruto: unknown) {
    const seg = parseSegmento(segBruto);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const where = await whereDoSegmento(tx, seg, identityId);
      const [total, optout] = await Promise.all([tx.contact.count({ where }), tx.contact.count({ where: { AND: [where, { optedOutAt: { not: null } }] } })]);
      const canalOk: Prisma.ContactWhereInput = canal === 'whatsapp' ? { telefone: { not: null } } : { email: { contains: '@' } };
      // amostra + contagem fina (telefone com dígitos suficientes) só nos com canal
      const candidatos = await tx.contact.findMany({ where: { AND: [where, { optedOutAt: null }, canalOk] }, select: { id: true, nome: true, telefone: true, email: true }, take: LIMITE_AUDIENCIA + 1 });
      const validos = candidatos.filter((c) => destinoDoContato(canal, c));
      const elegiveis = validos.length;
      const l = this.limites();
      return {
        total,
        elegiveis,
        optout,
        semCanal: Math.max(total - optout - elegiveis, 0),
        acimaDoTeto: candidatos.length > LIMITE_AUDIENCIA,
        teto: LIMITE_AUDIENCIA,
        exigeAprovacao: elegiveis > l.aprovacaoAcima,
        aprovacaoAcima: l.aprovacaoAcima,
        amostra: validos.slice(0, 5).map((c) => ({ id: c.id, nome: c.nome, destino: destinoDoContato(canal, c) })),
      };
    }, { timeout: 30_000 });
  }

  /** Pré-visualização com um contato real (o do segmento ou o escolhido). */
  async previa(tenantId: string, identityId: string | null, bruto: unknown) {
    const p = validar(previaSchema, bruto);
    return this.prisma.withTenant(tenantId, async (tx) => {
      let contato = p.contactId ? await tx.contact.findUnique({ where: { id: p.contactId } }) : null;
      if (!contato && p.segmento) contato = await tx.contact.findFirst({ where: { AND: [await whereDoSegmento(tx, parseSegmento(p.segmento), identityId), { optedOutAt: null }] }, orderBy: { createdAt: 'desc' } });
      const c = contato ?? { nome: 'Maria Silva', email: 'maria@exemplo.com.br', telefone: '5511999990000', empresa: 'Empresa Exemplo', camposCustom: {} };
      return {
        exemplo: !contato,
        contato: contato ? { id: contato.id, nome: contato.nome } : null,
        texto: interpolarContato(p.mensagem, c),
        assunto: p.canal === 'email' && p.assunto ? interpolarContato(p.assunto, c) : null,
        variaveis: VARIAVEIS_CONTATO,
      };
    });
  }

  // ------------------------------------------------------------ escrita

  async criar(tenantId: string, ator: Ator, bruto: unknown) {
    const d = validar(criarDisparoSchema, bruto);
    const seg = parseSegmento(d.segmento ?? {});
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (seg.viewId) await whereDoSegmento(tx, seg, ator.identityId); // valida acesso à lista salva
      const b = await tx.broadcast.create({
        data: {
          tenantId, nome: d.nome, canal: d.canal, mensagem: d.mensagem ?? '', assunto: d.assunto ?? null,
          segmento: seg as Prisma.InputJsonObject, agendadoPara: d.agendadoPara ? new Date(d.agendadoPara) : null,
          loteTamanho: d.loteTamanho ?? 20, loteIntervaloSeg: d.loteIntervaloSeg ?? 60, janela: (d.janela ?? JANELA_PADRAO) as Prisma.InputJsonObject,
          criadoPor: ator.identityId, criadoPorTipo: ator.tipo,
        },
      });
      await this.auditar(tx, tenantId, ator, 'broadcast.criado', b.id, { canal: b.canal });
      return this.dto(b);
    });
  }

  async atualizar(tenantId: string, ator: Ator, id: string, bruto: unknown) {
    const d = validar(atualizarDisparoSchema, bruto);
    const seg = d.segmento !== undefined ? parseSegmento(d.segmento) : undefined;
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await this.travar(tx, id);
      if (b.status !== 'rascunho') throw new ConflictException('só rascunho pode ser editado');
      if (seg?.viewId) await whereDoSegmento(tx, seg, ator.identityId);
      const novo = await tx.broadcast.update({
        where: { id },
        data: {
          ...(d.nome !== undefined ? { nome: d.nome } : {}),
          ...(d.canal !== undefined ? { canal: d.canal } : {}),
          ...(d.mensagem !== undefined ? { mensagem: d.mensagem } : {}),
          ...(d.assunto !== undefined ? { assunto: d.assunto } : {}),
          ...(seg !== undefined ? { segmento: seg as Prisma.InputJsonObject } : {}),
          ...(d.agendadoPara !== undefined ? { agendadoPara: d.agendadoPara ? new Date(d.agendadoPara) : null } : {}),
          ...(d.loteTamanho !== undefined ? { loteTamanho: d.loteTamanho } : {}),
          ...(d.loteIntervaloSeg !== undefined ? { loteIntervaloSeg: d.loteIntervaloSeg } : {}),
          ...(d.janela !== undefined ? { janela: d.janela as Prisma.InputJsonObject } : {}),
          updatedAt: new Date(),
        },
      });
      return this.dto(novo);
    });
  }

  async remover(tenantId: string, ator: Ator, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await this.travar(tx, id);
      if (b.status !== 'rascunho') throw new ConflictException('só rascunho pode ser excluído; cancele o disparo');
      await tx.broadcast.delete({ where: { id } });
      await this.auditar(tx, tenantId, ator, 'broadcast.excluido', id);
      return { ok: true };
    });
  }

  /**
   * Rascunho → aprovação ou agenda. Exige aprovação quando a Nyro criou ou a
   * audiência elegível passa do limite; senão congela já (quem enviou é o
   * responsável, registrado na auditoria).
   */
  async enviar(tenantId: string, ator: Ator, id: string) {
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      const b = await this.travar(tx, id);
      if (b.status !== 'rascunho') throw new ConflictException('este disparo já foi enviado para aprovação ou agendado');
      this.conferirCompleto(b);
      const audiencia = await this.montarAudiencia(tx, b);
      const elegiveis = audiencia.filter((a) => a.status === 'pendente').length;
      if (!elegiveis) throw new BadRequestException('nenhum contato elegível no segmento (sem opt-out e com canal)');
      const exige = b.criadoPorTipo === 'nyro' || ator.tipo === 'nyro' || elegiveis > this.limites().aprovacaoAcima;
      if (exige) {
        const novo = await tx.broadcast.update({ where: { id }, data: { status: 'aguardando_aprovacao', exigeAprovacao: true, rejeitadoMotivo: null, totalDestinatarios: audiencia.length, updatedAt: new Date() } });
        await this.avisarAprovadores(tx, tenantId, novo, elegiveis);
        await this.auditar(tx, tenantId, ator, 'broadcast.aguardando_aprovacao', id, { elegiveis });
        return this.dto(novo);
      }
      const novo = await this.congelarEAgendar(tx, b, audiencia, null);
      await this.auditar(tx, tenantId, ator, 'broadcast.agendado', id, { elegiveis, aprovacao: 'dispensada' });
      return this.dto(novo);
    }, { timeout: 120_000 });
    return r;
  }

  /** Aprovação humana (owner/admin). Congela a audiência NESTE momento. */
  async aprovar(tenantId: string, ator: Ator, id: string) {
    this.exigirAprovador(ator);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await this.travar(tx, id);
      if (b.status !== 'aguardando_aprovacao') throw new ConflictException('este disparo não está aguardando aprovação');
      const audiencia = await this.montarAudiencia(tx, b);
      if (!audiencia.some((a) => a.status === 'pendente')) throw new BadRequestException('nenhum contato elegível no segmento (sem opt-out e com canal)');
      const novo = await this.congelarEAgendar(tx, b, audiencia, ator.identityId);
      await this.auditar(tx, tenantId, ator, 'broadcast.aprovado', id, { destinatarios: audiencia.length });
      return this.dto(novo);
    }, { timeout: 120_000 });
  }

  async rejeitar(tenantId: string, ator: Ator, id: string, bruto: unknown) {
    this.exigirAprovador(ator);
    const { motivo } = validar(rejeitarSchema, bruto);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await this.travar(tx, id);
      if (b.status !== 'aguardando_aprovacao') throw new ConflictException('este disparo não está aguardando aprovação');
      const novo = await tx.broadcast.update({ where: { id }, data: { status: 'rascunho', rejeitadoMotivo: motivo, updatedAt: new Date() } });
      await this.auditar(tx, tenantId, ator, 'broadcast.rejeitado', id, { motivo });
      return this.dto(novo);
    });
  }

  async pausar(tenantId: string, ator: Ator, id: string) {
    return this.mudar(tenantId, ator, id, ['agendado', 'enviando'], 'broadcast.pausado', () => ({ status: 'pausado', pausaMotivo: 'manual', pausaDetalhe: Prisma.DbNull, leaseUntil: null }));
  }

  async retomar(tenantId: string, ator: Ator, id: string) {
    return this.mudar(tenantId, ator, id, ['pausado'], 'broadcast.retomado', (b) => {
      if (b.canal === 'email' && !this.mailer.configured()) throw new ConfigRequiredException('email', this.mailer.missing());
      return { status: b.iniciadoEm ? 'enviando' : 'agendado', pausaMotivo: null, pausaDetalhe: Prisma.DbNull, proximoLoteEm: new Date(), leaseUntil: null };
    });
  }

  async cancelar(tenantId: string, ator: Ator, id: string) {
    return this.mudar(tenantId, ator, id, ['aguardando_aprovacao', 'agendado', 'enviando', 'pausado'], 'broadcast.cancelado', () => ({ status: 'cancelado', canceladoEm: new Date(), leaseUntil: null, proximoLoteEm: null }));
  }

  private async mudar(tenantId: string, ator: Ator, id: string, de: StatusDisparo[], acao: string, dados: (b: Broadcast) => Prisma.BroadcastUpdateInput) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await this.travar(tx, id);
      if (!(de as string[]).includes(b.status)) throw new ConflictException(`não é possível nesta situação (${b.status})`);
      const novo = await tx.broadcast.update({ where: { id }, data: { ...dados(b), updatedAt: new Date() } });
      await this.auditar(tx, tenantId, ator, acao, id);
      return this.dto(novo);
    });
  }

  // ------------------------------------------------------------ worker

  /** Disparos com lote vencido neste tenant (o worker chama a cada varredura). */
  async pendentesDoTenant(tenantId: string, agora = new Date()): Promise<string[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.broadcast.findMany({
        where: { status: { in: ['agendado', 'enviando'] }, OR: [{ proximoLoteEm: null }, { proximoLoteEm: { lte: agora } }], AND: [{ OR: [{ leaseUntil: null }, { leaseUntil: { lt: agora } }] }] },
        select: { id: true }, orderBy: { proximoLoteEm: 'asc' }, take: 20,
      }),
    );
    return rows.map((r) => r.id);
  }

  /**
   * Manda UM lote. Seguro com vários workers: o lease é tomado por UPDATE
   * condicional (só um ganha) e cada destinatário é reservado antes do envio.
   */
  async processarLote(tenantId: string, id: string, agora = new Date()): Promise<{ resultado: string; enviados?: number }> {
    const b = await this.prisma.withTenant(tenantId, async (tx) => {
      const ate = new Date(agora.getTime() + LEASE_MS);
      const n = await tx.$executeRaw`UPDATE broadcasts SET lease_until = ${ate}
        WHERE id = ${id}::uuid AND status IN ('agendado','enviando')
          AND (proximo_lote_em IS NULL OR proximo_lote_em <= ${agora})
          AND (lease_until IS NULL OR lease_until < ${agora})`;
      return n ? tx.broadcast.findUnique({ where: { id } }) : null;
    });
    if (!b) return { resultado: 'ocupado' };

    const janela = this.janelaDe(b);
    if (!dentroDaJanela(agora, janela)) {
      const abre = proximaAbertura(agora, janela);
      await this.liberar(tenantId, id, abre ? { proximoLoteEm: abre, pausaMotivo: 'fora_da_janela' } : { status: 'pausado', pausaMotivo: 'janela_invalida' });
      return { resultado: abre ? 'fora_da_janela' : 'janela_invalida' };
    }
    if (b.canal === 'email' && !this.mailer.configured()) {
      await this.liberar(tenantId, id, { status: 'pausado', pausaMotivo: 'config_required', pausaDetalhe: { provider: 'email', missing: this.mailer.missing() } });
      return { resultado: 'config_required' };
    }

    const limite = this.limites().diario[b.canal as Canal];
    const usados = await this.prisma.withTenant(tenantId, (tx) => this.usadosHoje(tx, b.canal as Canal, janela.fuso, agora));
    const restante = limite - usados;
    if (restante <= 0) {
      const amanha = proximoDiaLocal(agora, janela.fuso);
      await this.liberar(tenantId, id, { proximoLoteEm: proximaAbertura(amanha, janela) ?? amanha, pausaMotivo: 'limite_diario', pausaDetalhe: { limite, usados } });
      return { resultado: 'limite_diario' };
    }

    const lote = await this.reservarLote(tenantId, id, Math.min(b.loteTamanho, restante), agora);
    if (!lote.length) {
      await this.liberar(tenantId, id, { status: 'concluido', concluidoEm: agora, proximoLoteEm: null, pausaMotivo: null, pausaDetalhe: Prisma.DbNull });
      await this.recalcular(tenantId, id);
      return { resultado: 'concluido' };
    }

    let enviados = 0;
    let fim: Prisma.BroadcastUpdateInput | null = null;
    for (const [i, r] of lote.entries()) {
      const d = await this.enviarUm(tenantId, b, r).catch((e: Error): DesfechoEnvio => ({ tipo: 'falhou', erro: e.message.slice(0, 300) }));
      if (d.tipo === 'pausar' || d.tipo === 'adiar') {
        // Quem nem foi tentado devolve a reserva (senão o e-mail viraria
        // "interrompido" na volta). Pausa: o atual também (chave nova depois).
        // Adiar: o atual MANTÉM a reserva, para repetir com a mesma chave.
        const devolver = lote.slice(d.tipo === 'pausar' ? i : i + 1);
        for (const x of devolver) await this.desfazerReserva(tenantId, x.id);
        fim = d.tipo === 'pausar'
          ? { status: 'pausado', pausaMotivo: d.motivo, pausaDetalhe: (d.detalhe ?? {}) as Prisma.InputJsonObject }
          : { proximoLoteEm: new Date(agora.getTime() + ESPERA_RATE_LIMIT_MS), pausaMotivo: 'limite_do_provedor' };
        break;
      }
      await this.gravarDesfecho(tenantId, r.id, d);
      if (d.tipo === 'enviado') enviados++;
    }

    await this.liberar(tenantId, id, {
      ...(b.iniciadoEm ? {} : { iniciadoEm: agora }),
      ...(b.status === 'agendado' ? { status: 'enviando' } : {}),
      proximoLoteEm: new Date(agora.getTime() + b.loteIntervaloSeg * 1000),
      pausaMotivo: null, pausaDetalhe: Prisma.DbNull,
      ...(fim ?? {}),
    });
    await this.recalcular(tenantId, id);
    return { resultado: fim?.status === 'pausado' ? `pausado:${String(fim.pausaMotivo)}` : 'lote_enviado', enviados };
  }

  /**
   * Reserva os próximos N pendentes (`tentativa_em`) e devolve. E-mail já
   * reservado e não concluído = envio interrompido: não dá para saber se saiu,
   * então vira falha (nunca reenvia). WhatsApp reservado reusa a MESMA chave de
   * idempotência, e o MessagesService devolve o envio anterior.
   */
  private async reservarLote(tenantId: string, id: string, n: number, agora: Date): Promise<BroadcastRecipient[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const b = await tx.broadcast.findUnique({ where: { id }, select: { canal: true } });
      const rows = await tx.$queryRaw<{ id: string; tentativa_em: Date | null }[]>`
        SELECT id, tentativa_em FROM broadcast_recipients
        WHERE broadcast_id = ${id}::uuid AND status = 'pendente'
        ORDER BY created_at, id LIMIT ${n}::int FOR UPDATE SKIP LOCKED`;
      const interrompidos = b?.canal === 'email' ? rows.filter((r) => r.tentativa_em) : [];
      if (interrompidos.length) {
        await tx.broadcastRecipient.updateMany({ where: { id: { in: interrompidos.map((r) => r.id) } }, data: { status: 'falhou', erro: 'envio interrompido: não confirmado, não reenviado' } });
      }
      const novos = rows.filter((r) => !r.tentativa_em).map((r) => r.id);
      if (novos.length) await tx.broadcastRecipient.updateMany({ where: { id: { in: novos }, tentativaEm: null }, data: { tentativaEm: agora } });
      const ids = rows.filter((r) => !interrompidos.includes(r)).map((r) => r.id);
      return ids.length ? tx.broadcastRecipient.findMany({ where: { id: { in: ids } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : [];
    });
  }

  /** Chave estável por reserva: retry da MESMA reserva não duplica. */
  static chaveIdempotencia(r: Pick<BroadcastRecipient, 'id' | 'tentativaEm'>): string {
    return `disparo:${r.id}:${r.tentativaEm?.getTime() ?? 0}`;
  }

  private async enviarUm(tenantId: string, b: Broadcast, r: BroadcastRecipient): Promise<DesfechoEnvio> {
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => {
      const c = await tx.contact.findUnique({ where: { id: r.contactId }, select: { id: true, nome: true, email: true, telefone: true, empresa: true, camposCustom: true, optedOutAt: true } });
      if (!c || c.optedOutAt) return { c, conversationId: null };
      if (b.canal !== 'whatsapp') return { c, conversationId: null };
      const conv = await tx.conversation.findFirst({ where: { contactId: c.id, canal: 'WhatsApp' }, select: { id: true } });
      const conversationId = conv?.id ?? (await tx.conversation.create({ data: { tenantId, contactId: c.id, nome: c.nome, canal: 'WhatsApp' }, select: { id: true } })).id;
      return { c, conversationId };
    });
    const c = ctx.c;
    // Opt-out DEPOIS do congelamento ("parar" no meio do disparo) ainda vale.
    if (!c || c.optedOutAt) return { tipo: 'ignorado_optout' };
    const destino = destinoDoContato(b.canal as Canal, c);
    if (!destino) return { tipo: 'ignorado_sem_canal' };
    const texto = interpolarContato(b.mensagem, c);
    const chave = DisparosService.chaveIdempotencia(r);
    if (b.canal === 'whatsapp') {
      const res = await this.mensagens.send(tenantId, ctx.conversationId!, texto, chave, undefined, { tipo: 'humano' });
      return desfechoWhatsApp(res);
    }
    const assunto = interpolarContato(b.assunto ?? '', c);
    const res = await this.mailer.send({ to: destino, subject: assunto, text: texto, html: htmlDeTexto(texto), idempotencyKey: chave });
    if (res.sent) return { tipo: 'enviado', messageId: null };
    if (res.missing?.length) return { tipo: 'pausar', motivo: 'config_required', detalhe: { provider: 'email', missing: res.missing } };
    return { tipo: 'falhou', erro: res.erro ?? 'falha no envio do e-mail' };
  }

  private async gravarDesfecho(tenantId: string, recipientId: string, d: DesfechoEnvio): Promise<void> {
    const data: Prisma.BroadcastRecipientUpdateManyMutationInput =
      d.tipo === 'enviado' ? { status: 'enviado', messageId: d.messageId, enviadoEm: new Date(), erro: null }
      : d.tipo === 'falhou' ? { status: 'falhou', erro: d.erro.slice(0, 500) }
      : d.tipo === 'ignorado_optout' || d.tipo === 'ignorado_sem_canal' ? { status: d.tipo }
      : {};
    // `status: pendente` no where: nunca rebaixa um destinatário já resolvido.
    await this.prisma.withTenant(tenantId, (tx) => tx.broadcastRecipient.updateMany({ where: { id: recipientId, status: 'pendente' }, data }));
  }

  /** Canal parou (credencial, desconexão): a reserva cai e a próxima tentativa gera chave nova. */
  private async desfazerReserva(tenantId: string, recipientId: string): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) => tx.broadcastRecipient.updateMany({ where: { id: recipientId, status: 'pendente' }, data: { tentativaEm: null } }));
  }

  private async liberar(tenantId: string, id: string, data: Prisma.BroadcastUpdateInput): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) =>
      // não ressuscita um disparo pausado/cancelado pela tela enquanto o lote rodava
      tx.broadcast.updateMany({ where: { id, status: { in: ['agendado', 'enviando'] } }, data: { ...data, leaseUntil: null, updatedAt: new Date() } as Prisma.BroadcastUpdateManyMutationInput }),
    );
    await this.prisma.withTenant(tenantId, (tx) => tx.broadcast.updateMany({ where: { id, status: { notIn: ['agendado', 'enviando'] } }, data: { leaseUntil: null } }));
  }

  /** Totais = contagem real dos destinatários (auto-corrigível). */
  async recalcular(tenantId: string, id: string): Promise<void> {
    await this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`
      UPDATE broadcasts b SET
        total_destinatarios = s.total, total_enviados = s.enviados, total_falhas = s.falhas,
        total_ignorados = s.ignorados, total_respostas = s.respostas
      FROM (
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE status IN ('enviado','respondeu'))::int AS enviados,
          count(*) FILTER (WHERE status = 'falhou')::int AS falhas,
          count(*) FILTER (WHERE status IN ('ignorado_optout','ignorado_sem_canal'))::int AS ignorados,
          count(*) FILTER (WHERE status = 'respondeu')::int AS respostas
        FROM broadcast_recipients WHERE broadcast_id = ${id}::uuid
      ) s
      WHERE b.id = ${id}::uuid`);
  }

  /**
   * Mensagem do contato chegou (evento do outbox): quem recebeu disparo nas
   * últimas 72h vira "respondeu". Idempotente (só promove `enviado`).
   */
  async registrarResposta(tenantId: string, messageId: string): Promise<number> {
    const afetados = await this.prisma.withTenant(tenantId, async (tx) => {
      const msg = await tx.message.findUnique({ where: { id: messageId }, select: { autorTipo: true, createdAt: true, conversation: { select: { contactId: true } } } });
      const contactId = msg?.conversation?.contactId;
      if (!msg || msg.autorTipo !== 'contato' || !contactId) return [];
      const desde = new Date(msg.createdAt.getTime() - JANELA_RESPOSTA_MS);
      return tx.$queryRaw<{ broadcast_id: string }[]>`
        UPDATE broadcast_recipients SET status = 'respondeu', respondido_em = ${msg.createdAt}
        WHERE contact_id = ${contactId}::uuid AND status = 'enviado'
          AND enviado_em >= ${desde} AND enviado_em <= ${msg.createdAt}
        RETURNING broadcast_id`;
    });
    for (const id of new Set(afetados.map((a) => a.broadcast_id))) await this.recalcular(tenantId, id);
    return afetados.length;
  }

  // ------------------------------------------------------------ internos

  private async travar(tx: Tx, id: string): Promise<Broadcast> {
    await tx.$queryRaw`SELECT id FROM broadcasts WHERE id = ${id}::uuid FOR UPDATE`;
    const b = await tx.broadcast.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('disparo não encontrado');
    return b;
  }

  private conferirCompleto(b: Broadcast): void {
    if (!b.mensagem.trim()) throw new BadRequestException('escreva a mensagem antes de enviar');
    if (b.canal === 'email' && !(b.assunto ?? '').trim()) throw new BadRequestException('o e-mail precisa de assunto');
    if (b.canal === 'email' && !this.mailer.configured()) throw new ConfigRequiredException('email', this.mailer.missing());
    if (b.agendadoPara && b.agendadoPara.getTime() < Date.now() - 60_000) throw new BadRequestException('o agendamento está no passado');
    this.janelaDe(b);
  }

  private janelaDe(b: Pick<Broadcast, 'janela'>): JanelaEnvio {
    const r = janelaSchema.safeParse(b.janela);
    if (!r.success) throw new BadRequestException('janela de envio inválida');
    return r.data;
  }

  private exigirAprovador(ator: Ator): void {
    if (ator.tipo !== 'humano' || !['owner', 'admin'].includes(ator.role)) throw new ForbiddenException('só owner ou admin aprova disparo em massa');
  }

  /** Audiência atual do segmento com a classificação de cada contato. */
  async montarAudiencia(tx: Tx, b: Pick<Broadcast, 'canal' | 'segmento' | 'criadoPor'>): Promise<{ contactId: string; nome: string; destino: string | null; status: StatusDestinatario }[]> {
    const seg: Segmento = parseSegmento(b.segmento);
    const where = await whereDoSegmento(tx, seg, b.criadoPor);
    const contatos = await tx.contact.findMany({ where, select: { id: true, nome: true, telefone: true, email: true, optedOutAt: true }, orderBy: { id: 'asc' }, take: LIMITE_AUDIENCIA + 1 });
    if (contatos.length > LIMITE_AUDIENCIA) throw new BadRequestException(`segmento grande demais: no máximo ${LIMITE_AUDIENCIA} contatos por disparo`);
    const canal = b.canal as Canal;
    return contatos.map((c) => {
      const e = elegibilidade(canal, c);
      return { contactId: c.id, nome: c.nome, destino: destinoDoContato(canal, c), status: e === 'elegivel' ? 'pendente' : e };
    });
  }

  private async congelarEAgendar(tx: Tx, b: Broadcast, audiencia: Awaited<ReturnType<DisparosService['montarAudiencia']>>, aprovadoPor: string | null): Promise<Broadcast> {
    for (let i = 0; i < audiencia.length; i += 1000) {
      await tx.broadcastRecipient.createMany({
        data: audiencia.slice(i, i + 1000).map((a) => ({ tenantId: b.tenantId, broadcastId: b.id, contactId: a.contactId, nome: a.nome.slice(0, 200), destino: a.destino, status: a.status })),
        skipDuplicates: true,
      });
    }
    const pendentes = audiencia.filter((a) => a.status === 'pendente').length;
    const agora = new Date();
    return tx.broadcast.update({
      where: { id: b.id },
      data: {
        status: 'agendado',
        aprovadoPor, aprovadoEm: aprovadoPor ? agora : null,
        proximoLoteEm: b.agendadoPara && b.agendadoPara > agora ? b.agendadoPara : agora,
        totalDestinatarios: audiencia.length,
        totalIgnorados: audiencia.length - pendentes,
        updatedAt: agora,
      },
    });
  }

  private async avisarAprovadores(tx: Tx, tenantId: string, b: Broadcast, elegiveis: number): Promise<void> {
    const aprovadores = await tx.membership.findMany({ where: { tenantId, role: { in: ['owner', 'admin'] } }, select: { identityId: true } });
    for (const a of aprovadores) {
      await this.notificacoes.criar(tx, tenantId, {
        identityId: a.identityId, tipo: 'disparo_aprovacao',
        titulo: `Disparo aguardando aprovação: ${b.nome}`.slice(0, 200),
        detalhe: `${elegiveis} contato(s) por ${b.canal === 'whatsapp' ? 'WhatsApp' : 'e-mail'}${b.criadoPorTipo === 'nyro' ? ', preparado pela Nyro' : ''}.`,
        url: `/campanhas/disparos/${b.id}`, entidade: 'broadcast', entidadeId: b.id,
      });
    }
  }

  private async auditar(tx: Tx, tenantId: string, ator: Ator, acao: string, id: string, payload: Record<string, unknown> = {}): Promise<void> {
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${tenantId}::uuid, ${ator.tipo}, ${ator.identityId}, ${acao}, 'broadcast', ${id}, ${JSON.stringify(payload)}::jsonb)`;
  }

  private dto(b: Broadcast) {
    const pendentes = Math.max(b.totalDestinatarios - b.totalEnviados - b.totalFalhas - b.totalIgnorados, 0);
    return {
      id: b.id, nome: b.nome, canal: b.canal, status: b.status, mensagem: b.mensagem, assunto: b.assunto,
      segmento: b.segmento, agendadoPara: b.agendadoPara, loteTamanho: b.loteTamanho, loteIntervaloSeg: b.loteIntervaloSeg,
      janela: b.janela, exigeAprovacao: b.exigeAprovacao, aprovadoPor: b.aprovadoPor, aprovadoEm: b.aprovadoEm,
      rejeitadoMotivo: b.rejeitadoMotivo, criadoPor: b.criadoPor, criadoPorTipo: b.criadoPorTipo,
      pausaMotivo: b.pausaMotivo, pausaDetalhe: b.pausaDetalhe, proximoLoteEm: b.proximoLoteEm,
      iniciadoEm: b.iniciadoEm, concluidoEm: b.concluidoEm, canceladoEm: b.canceladoEm, createdAt: b.createdAt, updatedAt: b.updatedAt,
      totais: { destinatarios: b.totalDestinatarios, enviados: b.totalEnviados, falhas: b.totalFalhas, ignorados: b.totalIgnorados, respostas: b.totalRespostas, pendentes },
    };
  }
}

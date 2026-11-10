import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigRequiredException, ConfigService } from '../config/config.service';
import { ehRespostaAfirmativa } from './confirmacao';

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidadeId?: string, actorType: 'humano' | 'nyro' | 'sistema' = 'humano') {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, ${actorType}, ${actorId}, ${acao}, 'agenda_compromisso', ${entidadeId ?? null})`;
}

const ATIVOS = ['agendado', 'confirmado'];

/** Status do compromisso (migration 054: `nao_compareceu` virou `faltou`). */
export const STATUS_AGENDA = ['agendado', 'confirmado', 'concluido', 'cancelado', 'faltou'] as const;
export type StatusAgenda = (typeof STATUS_AGENDA)[number];

/** Tipo do compromisso: dá a cor na grade e filtra gatilhos de automação. */
export const TIPOS_AGENDA = ['reuniao', 'call', 'demo', 'visita', 'followup', 'outro'] as const;
export type TipoAgenda = (typeof TIPOS_AGENDA)[number];

/** Janela do lembrete D-1: dispara quando faltam até 24h para o início. */
export const JANELA_LEMBRETE_H = 24;
/** Quanto tempo depois do lembrete uma resposta "sim" ainda confirma. */
export const VALIDADE_CONFIRMACAO_H = 48;

export interface CompromissoInput {
  titulo: string;
  inicio: string; // ISO
  fim: string;    // ISO
  contactId?: string | null;
  local?: string | null;
  notas?: string | null;
  tipo?: TipoAgenda;
  /** Membro da equipe dono do horário. Ausente = quem criou (humano) ou agenda geral (IA). */
  responsavelId?: string | null;
}

/** Edição parcial (arrastar, redimensionar, reagendar, editar campos). */
export type CompromissoPatch = Partial<CompromissoInput>;

export interface FiltroAgenda {
  de?: string;
  ate?: string;
  responsavelId?: string;
  status?: StatusAgenda[];
}

/**
 * Agenda: agendamentos do tenant. Booking local e real, com prevenção de choque
 * de horário; a sincronização com o Google Calendar é gated (config_required).
 */
@Injectable()
export class AgendaService {
  private readonly log = new Logger('Agenda');

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  listar(tenantId: string, filtro: FiltroAgenda = {}) {
    const where: Prisma.AgendaCompromissoWhereInput = {};
    const de = filtro.de ? new Date(filtro.de) : undefined;
    const ate = filtro.ate ? new Date(filtro.ate) : undefined;
    if ((de && isNaN(+de)) || (ate && isNaN(+ate))) throw new BadRequestException('intervalo de datas inválido');
    // Sobreposição com a janela (não só "começa dentro"): um evento que começa
    // antes da meia-noite e termina depois aparece nos dois dias.
    if (ate) where.inicio = { lte: ate };
    if (de) where.fim = { gte: de };
    if (filtro.responsavelId) where.responsavelId = filtro.responsavelId;
    if (filtro.status?.length) where.status = { in: filtro.status };
    return this.prisma.withTenant(tenantId, (tx) => tx.agendaCompromisso.findMany({ where, orderBy: { inicio: 'asc' } }));
  }

  /**
   * Choque de horário entre compromissos ATIVOS. Escopo por responsável: dois
   * membros diferentes podem ter reunião no mesmo horário; a agenda geral
   * (sem responsável, ex.: o que a IA marca) bloqueia todo mundo, e quem tem
   * responsável também bloqueia a agenda geral. Conservador de propósito.
   */
  private async choca(tx: Prisma.TransactionClient, inicio: Date, fim: Date, responsavelId: string | null, ignorarId?: string): Promise<boolean> {
    const conflito = await tx.agendaCompromisso.findFirst({
      where: {
        status: { in: ATIVOS },
        inicio: { lt: fim },
        fim: { gt: inicio },
        ...(ignorarId ? { id: { not: ignorarId } } : {}),
        ...(responsavelId ? { OR: [{ responsavelId }, { responsavelId: null }] } : {}),
      },
      select: { id: true },
    });
    return !!conflito;
  }

  /** O responsável precisa ser membro do tenant (identities são globais). */
  private async validarResponsavel(tx: Prisma.TransactionClient, tenantId: string, responsavelId: string | null | undefined): Promise<void> {
    if (!responsavelId) return;
    const m = await tx.membership.findFirst({ where: { tenantId, identityId: responsavelId }, select: { id: true } });
    if (!m) throw new BadRequestException('responsável não é membro desta conta');
  }

  private datas(inicioIso: string, fimIso: string): { inicio: Date; fim: Date } {
    const inicio = new Date(inicioIso); const fim = new Date(fimIso);
    if (isNaN(+inicio) || isNaN(+fim)) throw new BadRequestException('datas inválidas');
    if (fim <= inicio) throw new BadRequestException('o fim deve ser depois do início');
    if (+fim - +inicio > 24 * 3_600_000) throw new BadRequestException('o compromisso pode durar no máximo 24 horas');
    return { inicio, fim };
  }

  /** `actorType: 'nyro'` = agendado por um agente de IA (identityId = id do agente). */
  async criar(tenantId: string, identityId: string, dto: CompromissoInput, actorType: 'humano' | 'nyro' = 'humano') {
    const { inicio, fim } = this.datas(dto.inicio, dto.fim);
    const titulo = dto.titulo.trim();
    if (!titulo) throw new BadRequestException('informe o título');
    // Humano sem responsável explícito = o próprio. IA sem responsável = agenda geral.
    const responsavelId = dto.responsavelId !== undefined ? dto.responsavelId : actorType === 'humano' ? identityId : null;
    return this.prisma.withTenant(tenantId, async (tx) => {
      await this.validarResponsavel(tx, tenantId, responsavelId);
      if (await this.choca(tx, inicio, fim, responsavelId)) throw new ConflictException('já existe um compromisso nesse horário');
      const c = await tx.agendaCompromisso.create({
        data: {
          tenantId, titulo, inicio, fim, contactId: dto.contactId ?? null, local: dto.local ?? null, notas: dto.notas ?? null,
          tipo: dto.tipo ?? 'reuniao', responsavelId, createdBy: actorType === 'humano' ? identityId : null,
        },
      });
      await audit(tx, tenantId, identityId, 'compromisso.criado', c.id, actorType);
      return c;
    });
  }

  /**
   * Edição parcial: arrastar (inicio+fim), redimensionar (fim), reagendar,
   * trocar responsável/tipo/campos. Choque de horário → 409 (a UI desfaz).
   */
  async atualizar(tenantId: string, identityId: string, id: string, patch: CompromissoPatch) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.agendaCompromisso.findFirst({ where: { id } });
      if (!atual) throw new NotFoundException('compromisso inexistente');
      const { inicio, fim } = this.datas(patch.inicio ?? atual.inicio.toISOString(), patch.fim ?? atual.fim.toISOString());
      const responsavelId = patch.responsavelId !== undefined ? patch.responsavelId : atual.responsavelId;
      if (patch.responsavelId !== undefined) await this.validarResponsavel(tx, tenantId, responsavelId);
      const mudouHorario = +inicio !== +atual.inicio || +fim !== +atual.fim || responsavelId !== atual.responsavelId;
      if (mudouHorario && ATIVOS.includes(atual.status) && (await this.choca(tx, inicio, fim, responsavelId, id))) {
        throw new ConflictException('já existe um compromisso nesse horário');
      }
      const titulo = patch.titulo !== undefined ? patch.titulo.trim() : undefined;
      if (titulo === '') throw new BadRequestException('informe o título');
      const c = await tx.agendaCompromisso.update({
        where: { id },
        data: {
          inicio, fim, responsavelId,
          ...(titulo !== undefined ? { titulo } : {}),
          ...(patch.tipo !== undefined ? { tipo: patch.tipo } : {}),
          ...(patch.contactId !== undefined ? { contactId: patch.contactId } : {}),
          ...(patch.local !== undefined ? { local: patch.local } : {}),
          ...(patch.notas !== undefined ? { notas: patch.notas } : {}),
        },
      });
      await audit(tx, tenantId, identityId, +inicio !== +atual.inicio ? 'compromisso.reagendado' : 'compromisso.editado', id);
      return c;
    });
  }

  async atualizarStatus(tenantId: string, identityId: string, id: string, status: string) {
    if (!(STATUS_AGENDA as readonly string[]).includes(status)) throw new BadRequestException('status inválido');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const atual = await tx.agendaCompromisso.findFirst({ where: { id }, select: { id: true, status: true, inicio: true, fim: true, responsavelId: true } });
      if (!atual) throw new NotFoundException('compromisso inexistente');
      // Reativar (cancelado/faltou → agendado/confirmado) não pode atropelar
      // quem ocupou o horário nesse meio-tempo.
      if (ATIVOS.includes(status) && !ATIVOS.includes(atual.status) && (await this.choca(tx, atual.inicio, atual.fim, atual.responsavelId, id))) {
        throw new ConflictException('o horário já foi ocupado por outro compromisso');
      }
      // Timestamps (confirmado_em, faltou_em...) e o evento de outbox saem dos
      // triggers da migration 054, para valer em qualquer caminho de escrita.
      const c = await tx.agendaCompromisso.update({ where: { id }, data: { status } });
      await audit(tx, tenantId, identityId, `compromisso.${status}`, id);
      return c;
    });
  }

  /**
   * Varredura do lembrete D-1 (roda no worker). Marca `lembrete_enviado_em` nos
   * compromissos `agendado` com contato que começam nas próximas 24h; o trigger
   * da 054 publica `appointment.reminder_due` no MESMO commit, e o gatilho
   * `gatilho.lembrete_agendamento` abre o fluxo (template "Lembrete D-1").
   * Idempotente: só pega quem ainda não tem lembrete (reagendar zera).
   * Compromisso marcado há menos de 30 min não recebe lembrete imediato.
   */
  async dispararLembretes(tenantId: string): Promise<number> {
    return this.prisma.withTenant(tenantId, (tx) => tx.$executeRaw`
      UPDATE agenda_compromissos SET lembrete_enviado_em = now()
       WHERE lembrete_enviado_em IS NULL
         AND status = 'agendado'
         AND contact_id IS NOT NULL
         AND inicio > now()
         AND inicio <= now() + make_interval(hours => ${JANELA_LEMBRETE_H})
         AND created_at <= now() - interval '30 minutes'`);
  }

  /**
   * RV-07.1: o contato respondeu "sim/confirmo/ok/👍" a um lembrete → confirma.
   *
   * Escolha (handler da agenda, não nó de fluxo): a decisão é determinística e
   * vale para qualquer fluxo que mandou o lembrete, sem nó novo no motor. Só
   * confirma quando TODAS as travas batem:
   *   1. a mensagem é do contato e é uma afirmativa curta (`ehRespostaAfirmativa`);
   *   2. o contato tem compromisso `agendado`, futuro, com lembrete disparado
   *      há no máximo 48h;
   *   3. NÓS mandamos mensagem nessa conversa depois do lembrete e antes da
   *      resposta (o "sim" responde ao lembrete, não a outra conversa).
   * Se houver mais de um elegível, confirma só o mais próximo.
   */
  async confirmarPorResposta(tenantId: string, messageId: string): Promise<{ confirmado: string | null }> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const msg = await tx.message.findUnique({ where: { id: messageId }, select: { id: true, autorTipo: true, corpo: true, createdAt: true, conversationId: true } });
      if (!msg || msg.autorTipo !== 'contato' || !ehRespostaAfirmativa(msg.corpo)) return { confirmado: null };
      const conv = await tx.conversation.findUnique({ where: { id: msg.conversationId }, select: { contactId: true } });
      if (!conv?.contactId) return { confirmado: null };

      const desde = new Date(+msg.createdAt - VALIDADE_CONFIRMACAO_H * 3_600_000);
      const alvo = await tx.agendaCompromisso.findFirst({
        where: { contactId: conv.contactId, status: 'agendado', inicio: { gt: msg.createdAt }, lembreteEnviadoEm: { gte: desde, lte: msg.createdAt } },
        orderBy: { inicio: 'asc' },
      });
      if (!alvo?.lembreteEnviadoEm) return { confirmado: null };

      const lembreteSaiu = await tx.message.findFirst({
        where: { conversationId: msg.conversationId, autorTipo: { not: 'contato' }, createdAt: { gte: alvo.lembreteEnviadoEm, lt: msg.createdAt } },
        select: { id: true },
      });
      if (!lembreteSaiu) return { confirmado: null };

      await tx.agendaCompromisso.update({ where: { id: alvo.id }, data: { status: 'confirmado' } });
      await audit(tx, tenantId, conv.contactId, 'compromisso.confirmado_por_resposta', alvo.id, 'sistema');
      this.log.log(`compromisso ${alvo.id} confirmado pela resposta ${msg.id} (tenant ${tenantId})`);
      return { confirmado: alvo.id };
    });
  }

  async remover(tenantId: string, identityId: string, id: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const existe = await tx.agendaCompromisso.findFirst({ where: { id }, select: { id: true } });
      if (!existe) throw new NotFoundException('compromisso inexistente');
      await tx.agendaCompromisso.delete({ where: { id } });
      await audit(tx, tenantId, identityId, 'compromisso.removido', id);
      return { ok: true };
    });
  }

  /**
   * Horários livres num dia: gera slots de `das`..`ate` (passo = duração) e remove
   * os que colidem com compromissos ativos. Horário no fuso do servidor (o cliente
   * envia o dia; a exibição é local). Sem depender de API externa.
   */
  async sugerirHorarios(tenantId: string, data: string, duracaoMin = 60, das = 9, ate = 18, responsavelId?: string | null): Promise<{ inicio: string; fim: string }[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new BadRequestException('data deve ser YYYY-MM-DD');
    if (duracaoMin < 5 || duracaoMin > 480) throw new BadRequestException('duração inválida');
    const diaInicio = new Date(`${data}T00:00:00`);
    const diaFim = new Date(`${data}T23:59:59`);
    const ocupados = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agendaCompromisso.findMany({
        where: {
          status: { in: ATIVOS }, inicio: { lte: diaFim }, fim: { gte: diaInicio },
          // mesma regra do choque: o responsável disputa só com a própria agenda e a geral
          ...(responsavelId ? { OR: [{ responsavelId }, { responsavelId: null }] } : {}),
        },
        select: { inicio: true, fim: true },
      }),
    );
    const livres: { inicio: string; fim: string }[] = [];
    const passoMs = duracaoMin * 60_000;
    for (let h = das; h < ate; h += duracaoMin / 60) {
      const ini = new Date(`${data}T${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}:00`);
      const fim = new Date(+ini + passoMs);
      if (fim.getHours() > ate || (fim.getHours() === ate && fim.getMinutes() > 0)) break;
      const colide = ocupados.some((o) => o.inicio < fim && o.fim > ini);
      if (!colide) livres.push({ inicio: ini.toISOString(), fim: fim.toISOString() });
    }
    return livres;
  }

  /**
   * Sincroniza o compromisso com o Google Calendar. Gating em duas camadas:
   *   1. sem GOOGLE_CLIENT_ID/SECRET → 501 config_required com as variáveis;
   *   2. com as variáveis, falta a conexão OAuth da conta com o Google
   *      Calendar → 501 config_required com `missing: ['conexao_google_calendar']`.
   * O módulo integrations ainda não tem o fluxo OAuth do Google Calendar
   * (pendência registrada), então a camada 2 é o estado real: nada é fingido
   * como sincronizado e a UI mostra "Conectar Google Calendar".
   */
  async sincronizarCalendar(tenantId: string, _identityId: string, id: string): Promise<{ googleEventId: string }> {
    this.config.require('google_calendar');
    const existe = await this.prisma.withTenant(tenantId, (tx) => tx.agendaCompromisso.findFirst({ where: { id }, select: { id: true } }));
    if (!existe) throw new NotFoundException('compromisso inexistente');
    throw new ConfigRequiredException('google_calendar', ['conexao_google_calendar']);
  }
}

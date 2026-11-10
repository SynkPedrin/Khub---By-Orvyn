import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { MessagesService } from '../../crm/messaging/messages.service';
import type { BlocoMensagem } from '../engines/message-chunker';

export const FILA_ENTREGAS = 'agent-delivery';
export interface EntregaJob {
  tenantId: string;
  deliveryId: string;
}

/** Tentativas de reenvio para falha RETENTÁVEL do provedor (antes do aceite). */
export const MAX_TENTATIVAS = 4;
const BACKOFF_BASE_MS = 3000;

/** Status do envio que gravam a mensagem no Inbox sem sair para o WhatsApp (ambiente/credencial). */
const REGISTRADO_SEM_ENVIO = new Set(['bloqueado_dev', 'config_required', 'sem_telefone', 'canal_desconectado']);

export type DesfechoEntrega = 'enviado' | 'registrado' | 'reagendado' | 'cancelado' | 'falhou' | 'incerto' | 'ignorado';

/**
 * MESSAGE DELIVERY QUEUE (docs/AI_AGENT_ARCHITECTURE.md §6.2)
 * ===========================================================
 *
 * A verdade é `agent_delivery_queue`; o BullMQ só carrega o id do bloco
 * (jobId determinístico `entrega-<id>` — enfileirar duas vezes não duplica).
 *
 * Garantias:
 *  - **ordem**: o bloco N só sai depois do N-1 ter sido gravado; cada envio
 *    agenda o próximo com o atraso de digitação dele;
 *  - **idempotência**: chave `agentblk:<id>` no MessagesService (que reserva
 *    antes de enviar e nunca reenvia aceite incerto);
 *  - **interrupção**: se o contato escreveu depois que a sequência nasceu, o
 *    resto é cancelado — a nova mensagem gera uma resposta reavaliada com o
 *    contexto completo (o runtime do agente roda para ela);
 *  - **falhas**: retentável → backoff exponencial até MAX_TENTATIVAS;
 *    aceite incerto → `incerto` e a sequência para (não arrisca duplicar nem
 *    inverter a ordem);
 *  - **limites do provedor**: o processor tem `limiter` global e concorrência
 *    limitada (ver delivery.processor.ts).
 */
@Injectable()
export class DeliveryService {
  private readonly log = new Logger('AgentDelivery');

  constructor(
    private readonly prisma: PrismaService,
    private readonly mensagens: MessagesService,
    @InjectQueue(FILA_ENTREGAS) private readonly fila: Queue<EntregaJob>,
  ) {}

  /**
   * Persiste a sequência e agenda o 1º bloco. `chaveBase` torna a operação
   * idempotente (mesmo run reprocessado não duplica a sequência).
   */
  async enfileirar(i: {
    tenantId: string;
    agentId: string | null;
    conversationId: string;
    runId?: string | null;
    followupId?: string | null;
    blocos: BlocoMensagem[];
    chaveBase: string;
  }): Promise<{ sequenciaId: string; blocos: number; duplicado: boolean }> {
    if (!i.blocos.length) return { sequenciaId: '', blocos: 0, duplicado: false };
    const sequenciaId = randomUUID();
    const agora = Date.now();
    let acumulado = 0;
    const linhas = i.blocos.slice(0, 20).map((b, idx, arr) => {
      acumulado += b.atrasoMs;
      return {
        tenantId: i.tenantId,
        agentId: i.agentId,
        conversationId: i.conversationId,
        runId: i.runId ?? null,
        followupId: i.followupId ?? null,
        sequenciaId,
        ordem: idx + 1,
        total: arr.length,
        texto: b.texto.slice(0, 4096),
        atrasoMs: Math.min(120_000, b.atrasoMs),
        agendadoPara: new Date(agora + acumulado),
        idempotencyKey: `${i.chaveBase}:${idx + 1}`,
      };
    });
    const r = await this.prisma.withTenant(i.tenantId, async (tx) => {
      const existente = await tx.agentDelivery.findUnique({ where: { tenantId_idempotencyKey: { tenantId: i.tenantId, idempotencyKey: linhas[0].idempotencyKey } }, select: { sequenciaId: true, id: true, status: true } });
      if (existente) return { duplicado: true, sequenciaId: existente.sequenciaId, primeiro: existente.status === 'pendente' ? existente.id : null };
      await tx.agentDelivery.createMany({ data: linhas });
      const primeiro = await tx.agentDelivery.findFirst({ where: { sequenciaId, ordem: 1 }, select: { id: true } });
      return { duplicado: false, sequenciaId, primeiro: primeiro?.id ?? null };
    });
    if (r.primeiro) await this.agendarJob(i.tenantId, r.primeiro, linhas[0].atrasoMs);
    return { sequenciaId: r.sequenciaId, blocos: linhas.length, duplicado: r.duplicado };
  }

  private async agendarJob(tenantId: string, deliveryId: string, delayMs: number, tentativa = 0) {
    await this.fila.add(
      'entregar',
      { tenantId, deliveryId },
      {
        jobId: tentativa ? `entrega-${deliveryId}-r${tentativa}` : `entrega-${deliveryId}`,
        delay: Math.max(0, delayMs),
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        // Falha de infraestrutura fica no Redis como dead-letter inspecionável.
        removeOnFail: false,
      },
    );
  }

  /** Processa UM bloco (chamado pelo worker). */
  async processar(job: EntregaJob): Promise<DesfechoEntrega> {
    const { tenantId, deliveryId } = job;
    const pre = await this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.agentDelivery.findUnique({ where: { id: deliveryId } });
      if (!d || d.status !== 'pendente') return { d: null as null, motivo: 'bloco não está pendente' };
      const [respondeu, conv, anterior, run] = await Promise.all([
        tx.message.findFirst({ where: { conversationId: d.conversationId, autorTipo: 'contato', createdAt: { gt: d.createdAt } }, select: { id: true } }),
        tx.conversation.findUnique({ where: { id: d.conversationId }, select: { atendimento: true, contact: { select: { optedOutAt: true } } } }),
        d.ordem > 1 ? tx.agentDelivery.findFirst({ where: { sequenciaId: d.sequenciaId, ordem: d.ordem - 1 }, select: { status: true, messageId: true } }) : null,
        d.runId ? tx.agentRun.findUnique({ where: { id: d.runId }, select: { status: true } }) : null,
      ]);
      // A sequência que AVISA a transferência ("vou te passar para a equipe")
      // nasce no mesmo run que transferiu: ela sai mesmo com humano no comando.
      const daTransferencia = run?.status === 'transferido' || run?.status === 'processando';
      let cancelar: string | null = null;
      if (respondeu) cancelar = 'contato respondeu durante a sequência (reavaliado pela nova mensagem)';
      else if (conv?.contact?.optedOutAt) cancelar = 'contato optou por não receber mensagens';
      else if (conv && conv.atendimento !== 'ia' && !d.followupId && !daTransferencia) cancelar = 'humano assumiu a conversa';
      else if (anterior && anterior.status !== 'enviado' && !anterior.messageId) cancelar = `bloco anterior não foi entregue (${anterior.status})`;
      if (cancelar) {
        await tx.agentDelivery.updateMany({ where: { sequenciaId: d.sequenciaId, status: 'pendente' }, data: { status: 'cancelado', motivo: cancelar, updatedAt: new Date() } });
        return { d: null as null, motivo: cancelar };
      }
      // Reserva o bloco (update condicional = um worker só).
      const reservou = await tx.agentDelivery.updateMany({ where: { id: deliveryId, status: 'pendente' }, data: { status: 'enviando', tentativas: { increment: 1 }, updatedAt: new Date() } });
      return reservou.count ? { d, motivo: null } : { d: null as null, motivo: 'bloco já reservado' };
    });
    if (!pre.d) return pre.motivo?.startsWith('bloco') ? 'ignorado' : 'cancelado';
    const d = pre.d;

    let resultado: Awaited<ReturnType<MessagesService['send']>>;
    try {
      // Agente apagado depois de enfileirar: o bloco sai como mensagem do sistema.
      const autor = d.agentId ? { tipo: 'ia' as const, agentId: d.agentId } : { tipo: 'humano' as const };
      resultado = await this.mensagens.send(tenantId, d.conversationId, d.texto, `agentblk:${d.id}`, d.createdAt.toISOString(), autor);
    } catch (e) {
      return this.falhaRetentavel(tenantId, d, (e as Error).message);
    }

    const st = resultado.status;
    if (st === 'sent' || REGISTRADO_SEM_ENVIO.has(st)) {
      const enviado = st === 'sent';
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.agentDelivery.update({
          where: { id: d.id },
          data: { status: enviado ? 'enviado' : 'falhou', messageId: resultado.id, enviadoEm: enviado ? new Date() : null, motivo: enviado ? null : `registrado no Inbox sem envio: ${st}${resultado.missing?.length ? ` (falta ${resultado.missing.join(', ')})` : ''}`, updatedAt: new Date() },
        }),
      );
      await this.agendarProximo(tenantId, d.sequenciaId, d.ordem);
      return enviado ? 'enviado' : 'registrado';
    }
    if (st === 'pending') return this.falhaRetentavel(tenantId, d, resultado.erro ?? 'provedor indisponível');
    if (st === 'cancelled') {
      await this.cancelarSequencia(tenantId, d.sequenciaId, 'envio cancelado: contato respondeu ou saiu', d.id);
      return 'cancelado';
    }
    // unknown / failed: nunca reenviar às cegas — a sequência para.
    const final = st === 'unknown' ? 'incerto' : 'falhou';
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.agentDelivery.update({ where: { id: d.id }, data: { status: final, messageId: resultado.id, motivo: resultado.erro ?? st, updatedAt: new Date() } });
      await tx.agentDelivery.updateMany({ where: { sequenciaId: d.sequenciaId, status: 'pendente' }, data: { status: 'cancelado', motivo: `bloco ${d.ordem} ${final}`, updatedAt: new Date() } });
    });
    return final;
  }

  private async falhaRetentavel(tenantId: string, d: { id: string; sequenciaId: string; tentativas: number; ordem: number }, erro: string): Promise<DesfechoEntrega> {
    const tentativas = d.tentativas + 1;
    if (tentativas >= MAX_TENTATIVAS) {
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.agentDelivery.update({ where: { id: d.id }, data: { status: 'falhou', motivo: `esgotou ${MAX_TENTATIVAS} tentativas: ${erro}`.slice(0, 500), updatedAt: new Date() } });
        await tx.agentDelivery.updateMany({ where: { sequenciaId: d.sequenciaId, status: 'pendente' }, data: { status: 'cancelado', motivo: `bloco ${d.ordem} falhou`, updatedAt: new Date() } });
      });
      return 'falhou';
    }
    const espera = BACKOFF_BASE_MS * 2 ** (tentativas - 1);
    await this.prisma.withTenant(tenantId, (tx) => tx.agentDelivery.update({ where: { id: d.id }, data: { status: 'pendente', motivo: `retentativa ${tentativas}: ${erro}`.slice(0, 500), agendadoPara: new Date(Date.now() + espera), updatedAt: new Date() } }));
    await this.agendarJob(tenantId, d.id, espera, tentativas);
    return 'reagendado';
  }

  private async agendarProximo(tenantId: string, sequenciaId: string, ordem: number) {
    const prox = await this.prisma.withTenant(tenantId, (tx) => tx.agentDelivery.findFirst({ where: { sequenciaId, ordem: ordem + 1, status: 'pendente' }, select: { id: true, atrasoMs: true } }));
    if (!prox) return;
    await this.prisma.withTenant(tenantId, (tx) => tx.agentDelivery.update({ where: { id: prox.id }, data: { agendadoPara: new Date(Date.now() + prox.atrasoMs) } }));
    await this.agendarJob(tenantId, prox.id, prox.atrasoMs);
  }

  async cancelarSequencia(tenantId: string, sequenciaId: string, motivo: string, incluirId?: string) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentDelivery.updateMany({ where: { sequenciaId, OR: [{ status: 'pendente' }, ...(incluirId ? [{ id: incluirId }] : [])] }, data: { status: 'cancelado', motivo, updatedAt: new Date() } }),
    );
  }

  /** Nova mensagem do contato: o que estava pendente nesta conversa deixa de valer. */
  async cancelarPendentes(tenantId: string, conversationId: string, motivo: string): Promise<number> {
    const r = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentDelivery.updateMany({ where: { conversationId, status: 'pendente' }, data: { status: 'cancelado', motivo, updatedAt: new Date() } }),
    );
    return r.count;
  }

  /**
   * Recuperação (varredura do worker): bloco pendente vencido há mais de 2 min
   * sem job no Redis (ex.: Redis reiniciado) volta para a fila. jobId
   * determinístico → se o job ainda existir, nada duplica.
   */
  async reconciliar(tenantId: string): Promise<number> {
    const vencidos = await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentDelivery.findMany({ where: { status: 'pendente', agendadoPara: { lt: new Date(Date.now() - 120_000) } }, take: 100, select: { id: true, ordem: true, sequenciaId: true } }),
    );
    let n = 0;
    for (const v of vencidos) {
      const job = await this.fila.getJob(`entrega-${v.id}`);
      if (job && !['completed', 'failed'].includes(await job.getState())) continue;
      if (job) await job.remove().catch(() => undefined);
      await this.agendarJob(tenantId, v.id, 0);
      n++;
    }
    // "enviando" travado (worker morreu no meio): o MessagesService é
    // idempotente pela chave do bloco, então devolver para pendente é seguro.
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.agentDelivery.updateMany({ where: { status: 'enviando', updatedAt: { lt: new Date(Date.now() - 300_000) } }, data: { status: 'pendente', motivo: 'recuperado após worker interrompido', updatedAt: new Date() } }),
    );
    return n;
  }

  async listar(tenantId: string, filtro: { agentId?: string; conversationId?: string; status?: string; limit?: number }) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.agentDelivery.findMany({
        where: { ...(filtro.agentId ? { agentId: filtro.agentId } : {}), ...(filtro.conversationId ? { conversationId: filtro.conversationId } : {}), ...(filtro.status ? { status: filtro.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { ordem: 'asc' }],
        take: Math.min(filtro.limit ?? 100, 500),
      }),
    );
  }

  async contagemFila() {
    return this.fila.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
  }
}

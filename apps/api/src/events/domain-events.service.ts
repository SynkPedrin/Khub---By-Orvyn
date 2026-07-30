import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { RealtimeEvent, RealtimeEvents } from '@orvyn/types';
import { RealtimeService } from '../realtime/realtime.service';

export const FILA_GATILHOS = 'automation-triggers';

/** Payload do gatilho: só o necessário para achar o workflow e montar o contexto. */
export interface GatilhoJob {
  tenantId: string;
  evento: RealtimeEvent;
  dados: Record<string, unknown>;
  /** Idempotência: mesmo evento entregue 2x não abre 2 execuções. */
  dedupeKey: string;
}

/**
 * Ponto ÚNICO de publicação de evento de domínio (ADR-0012).
 *
 * Um `publicar()` alimenta dois consumidores muito diferentes:
 *  1. **socket** (RealtimeService) — a tela do usuário, agora;
 *  2. **fila de gatilhos** (BullMQ) — as automações, com garantia de entrega.
 *
 * Isto existe para quebrar o ciclo: `automations` precisa do `crm` para agir
 * (criar negócio, mandar mensagem), então o `crm` NÃO pode importar
 * `automations`. Ele publica aqui, e o worker do outro lado consome a fila.
 * Ninguém chama ninguém.
 */
@Injectable()
export class DomainEventsService {
  private readonly log = new Logger('DomainEvents');

  constructor(
    private readonly realtime: RealtimeService,
    @InjectQueue(FILA_GATILHOS) private readonly fila: Queue<GatilhoJob>,
  ) {}

  /**
   * Best-effort nos dois canais: o evento é publicado DEPOIS do commit, então
   * falhar aqui não pode derrubar a operação de negócio que já aconteceu.
   */
  publicar<E extends RealtimeEvent>(tenantId: string, evento: E, dados: RealtimeEvents[E], opts: { dedupeKey?: string; automacao?: boolean } = {}): void {
    this.realtime.publicar(tenantId, evento, dados);
    if (opts.automacao === false) return;

    const dedupeKey = opts.dedupeKey ?? `${evento}:${JSON.stringify(dados)}`;
    void this.fila
      .add(
        'gatilho',
        { tenantId, evento, dados: dados as Record<string, unknown>, dedupeKey },
        {
          // jobId igual = job ignorado pelo BullMQ: a 1ª barreira de idempotência
          // (a 2ª é o unique index de dedupe_key em workflow_runs).
          // O BullMQ recusa ':' no jobId — e a dedupeKey tem vários. Hash resolve
          // e ainda mantém o id curto qualquer que seja o tamanho do payload.
          jobId: `${tenantId}_${createHash('sha1').update(dedupeKey).digest('hex')}`,
          removeOnComplete: 500,
          removeOnFail: 200,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2000 },
        },
      )
      .catch((e: Error) => this.log.warn(`falha ao enfileirar gatilho ${evento}: ${e.message}`));
  }
}

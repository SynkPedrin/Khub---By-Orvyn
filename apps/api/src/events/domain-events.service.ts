import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'node:crypto';
import type { RealtimeEvent, RealtimeEvents } from '@khub/types';
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
    // Durable domain events are inserted by database triggers (migration 022).
    // This method only refreshes connected clients after the commit.
  }
}

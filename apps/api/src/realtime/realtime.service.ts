import { Injectable, Logger } from '@nestjs/common';
import type { RealtimeEvent, RealtimeEvents } from '@khub/types';
import { EventsGateway } from './events.gateway';

/**
 * Superfície pública do tempo real (ADR-0011). Os módulos de negócio dependem
 * DISTO, não do gateway — trocar Socket.IO por outro transporte não toca no CRM.
 *
 * Regra: publicar é **best-effort**. Socket é enfeite em cima do banco; se a
 * emissão falhar, a operação de negócio (que já commitou) não pode cair junto.
 */
@Injectable()
export class RealtimeService {
  private readonly log = new Logger('Realtime');

  constructor(private readonly gateway: EventsGateway) {}

  publicar<E extends RealtimeEvent>(tenantId: string, evento: E, dados: RealtimeEvents[E]): void {
    try {
      this.gateway.emitirParaTenant(tenantId, evento, dados);
    } catch (e) {
      this.log.warn(`falha ao publicar ${evento}: ${(e as Error).message}`);
    }
  }
}

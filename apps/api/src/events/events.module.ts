import { Global, Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { RealtimeModule } from '../realtime/realtime.module';
import { DomainEventsService, FILA_GATILHOS } from './domain-events.service';

/**
 * Barramento de eventos de domínio. Global: qualquer módulo publica sem
 * importar. Depende de `realtime`; **não** conhece `automations` (que só
 * consome a fila) — é assim que o ciclo crm↔automations não existe.
 */
@Global()
@Module({
  imports: [RealtimeModule, BullModule.registerQueue({ name: FILA_GATILHOS })],
  providers: [DomainEventsService],
  exports: [DomainEventsService],
})
export class EventsModule {}

import { isWorker } from '../common/queue-connection';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { FILA_GATILHOS } from '../events/domain-events.service';
import { AutomationsController } from './automations.controller';
import { HooksController } from './hooks.controller';
import { WorkflowsService } from './workflows.service';
import { RunsService, FILA_PASSOS } from './runs.service';
import { ExecutorService } from './executor.service';
import { TriggersService } from './triggers.service';
import { GatilhosProcessor, PassosProcessor } from './automations.processor';

/**
 * Motor de automações (Sprint E).
 *
 * Sentido das dependências: `automations` → `crm` (para agir pelos serviços do
 * CRM, com as mesmas regras e auditoria). O CRM **não** conhece automações: ele
 * só publica evento no barramento, e o worker daqui consome a fila. Sem ciclo.
 */
@Module({
  imports: [
    CrmModule,
    BullModule.registerQueue({ name: FILA_PASSOS }),
    BullModule.registerQueue({ name: FILA_GATILHOS }),
  ],
  controllers: [AutomationsController, HooksController],
  providers: [WorkflowsService, RunsService, ExecutorService, TriggersService, ...(isWorker() ? [PassosProcessor, GatilhosProcessor] : [])],
  exports: [WorkflowsService, RunsService, TriggersService],
})
export class AutomationsModule {}

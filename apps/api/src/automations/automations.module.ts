import { isWorker } from '../common/queue-connection';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { AvaliacoesModule } from '../avaliacoes/avaliacoes.module';
import { FILA_GATILHOS } from '../events/domain-events.service';
import { AutomationsController } from './automations.controller';
import { HooksController } from './hooks.controller';
import { WorkflowsService } from './workflows.service';
import { RunsService, FILA_PASSOS } from './runs.service';
import { ExecutorService } from './executor.service';
import { EditorService } from './editor.service';
import { TriggersService } from './triggers.service';
import { AgendadorService } from './agendador.service';
import { GatilhosProcessor, PassosProcessor } from './automations.processor';
import { NicoMontadorService } from './nico-montador.service';

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
    AvaliacoesModule,
    BullModule.registerQueue({ name: FILA_PASSOS }),
    BullModule.registerQueue({ name: FILA_GATILHOS }),
  ],
  controllers: [AutomationsController, HooksController],
  providers: [WorkflowsService, RunsService, ExecutorService, TriggersService, EditorService, AgendadorService, NicoMontadorService, ...(isWorker() ? [PassosProcessor, GatilhosProcessor] : [])],
  exports: [WorkflowsService, RunsService, TriggersService, AgendadorService],
})
export class AutomationsModule {}

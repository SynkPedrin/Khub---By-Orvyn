import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { RagModule } from '../rag/rag.module';
import { isWorker } from '../common/queue-connection';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';
import { AgentRuntimeService, FILA_AGENTES } from './agent-runtime.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentesProcessor } from './agents.processor';

/**
 * Agent Manager (ADR-0030).
 *
 * Depende de `crm` (mensagens, atendimento, contatos, notas, tarefas) e de
 * `rag` (conhecimento) — nunca o contrário. O CRM não conhece agentes: o
 * outbox enfileira o job e o worker daqui responde.
 */
@Module({
  imports: [CrmModule, RagModule, BullModule.registerQueue({ name: FILA_AGENTES })],
  controllers: [AgentsController],
  providers: [AgentsService, AgentRuntimeService, AgentToolsService, ...(isWorker() ? [AgentesProcessor] : [])],
  exports: [AgentsService],
})
export class AgentsModule {}

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { RagModule } from '../rag/rag.module';
import { AgendaModule } from '../agenda/agenda.module';
import { AutomationsModule } from '../automations/automations.module';
import { AiModule } from '../ai/ai.module';
import { isWorker } from '../common/queue-connection';
import { AgentKnowledgeController, AgentLearningController, AgentOperationsController, AgentsController } from './agents.controller';
import { AgentStudioController } from './agent-studio.controller';
import { AgentStudioService } from './agent-studio.service';
import { AgentsService } from './agents.service';
import { AgentRuntimeService, FILA_AGENTES } from './agent-runtime.service';
import { AgentToolsService } from './agent-tools.service';
import { AgentesProcessor } from './agents.processor';
import { AgentAnalyticsService } from './analytics/agent-analytics.service';
import { DeliveryProcessor } from './delivery/delivery.processor';
import { DeliveryService, FILA_ENTREGAS } from './delivery/delivery.service';
import { EvaluationService, FILA_AVALIACOES } from './evaluation/evaluation.service';
import { FollowupService } from './followup/followup.service';
import { IntelligenceCoreService } from './intelligence/intelligence-core.service';
import { MemoryService } from './intelligence/memory.service';
import { ProfileService } from './intelligence/profile.service';
import { KnowledgeService } from './knowledge/knowledge.service';
import { LearningService } from './learning/learning.service';
import { ProposalsService } from './learning/proposals.service';
import { SimulatorService } from './simulator/simulator.service';
import { VersioningService } from './versioning/versioning.service';
import { AvaliacoesProcessor, FILA_MANUTENCAO_AGENTES, ManutencaoAgentesProcessor, ManutencaoAgentesScheduler } from './workers';

/**
 * KHUB Agent Intelligence Platform (ADR-0030 → docs/AI_AGENT_ARCHITECTURE.md).
 *
 * Depende de `crm` (mensagens, atendimento, contatos, notas, tarefas), `rag`
 * (conhecimento), `agenda` e `automations` (ações) — nunca o contrário. O CRM
 * não conhece agentes: o outbox enfileira o job e o worker daqui responde.
 * Processors só no processo worker; a API só enfileira.
 */
@Module({
  imports: [
    CrmModule,
    RagModule,
    AgendaModule,
    AutomationsModule,
    AiModule,
    BullModule.registerQueue({ name: FILA_AGENTES }),
    BullModule.registerQueue({ name: FILA_ENTREGAS }),
    BullModule.registerQueue({ name: FILA_AVALIACOES }),
    BullModule.registerQueue({ name: FILA_MANUTENCAO_AGENTES }),
  ],
  // AgentsController por último: as rotas `:id` não podem capturar as fixas.
  controllers: [AgentKnowledgeController, AgentOperationsController, AgentLearningController, AgentStudioController, AgentsController],
  providers: [
    AgentsService,
    AgentStudioService,
    AgentRuntimeService,
    AgentToolsService,
    AgentAnalyticsService,
    DeliveryService,
    EvaluationService,
    FollowupService,
    IntelligenceCoreService,
    MemoryService,
    ProfileService,
    KnowledgeService,
    LearningService,
    ProposalsService,
    SimulatorService,
    VersioningService,
    ManutencaoAgentesScheduler,
    ...(isWorker() ? [AgentesProcessor, DeliveryProcessor, AvaliacoesProcessor, ManutencaoAgentesProcessor] : []),
  ],
  exports: [AgentsService],
})
export class AgentsModule {}

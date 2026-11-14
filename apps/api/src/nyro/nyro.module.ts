import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { isWorker } from '../common/queue-connection';
import { CrmModule } from '../crm/crm.module';
import { RagModule } from '../rag/rag.module';
import { AutomationsModule } from '../automations/automations.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { BlueprintModule } from '../blueprints/blueprint.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { NyroController } from './nyro.controller';
import { NyroService } from './nyro.service';
import { ToolExecutorService } from './tool-executor.service';
import { NicoAnalisesService } from './analises.service';
import { FirecrawlService } from './firecrawl.service';
import { NicoInsightsService } from './insights.service';
import { NicoConsultasService } from './consultas.service';
import { FILA_NICO_ROTINAS, NicoRotinasProcessor, NicoRotinasScheduler } from './nico-rotinas.worker';

/**
 * Nyro IA (Sprint F).
 *
 * Depende de `crm`, `rag` e `automations` — e de nenhum deles ao contrário:
 * a Nyro é **consumidora** da superfície pública de todos, como um usuário.
 * É isso que garante o invariante "nunca escreve direto no banco".
 */
@Module({
  imports: [BullModule.registerQueue({ name: FILA_NICO_ROTINAS }), CrmModule, RagModule, AutomationsModule, MarketplaceModule, BlueprintModule, FinanceiroModule],
  controllers: [NyroController],
  providers: [NyroService, ToolExecutorService, NicoAnalisesService, FirecrawlService, NicoInsightsService, NicoConsultasService, NicoRotinasScheduler, ...(isWorker() ? [NicoRotinasProcessor] : [])],
  exports: [NyroService, NicoAnalisesService],

})
export class NyroModule {}

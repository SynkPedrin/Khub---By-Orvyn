import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { RagModule } from '../rag/rag.module';
import { AutomationsModule } from '../automations/automations.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { BlueprintModule } from '../blueprints/blueprint.module';
import { NyroController } from './nyro.controller';
import { NyroService } from './nyro.service';
import { ToolExecutorService } from './tool-executor.service';

/**
 * Nyro IA (Sprint F).
 *
 * Depende de `crm`, `rag` e `automations` — e de nenhum deles ao contrário:
 * a Nyro é **consumidora** da superfície pública de todos, como um usuário.
 * É isso que garante o invariante "nunca escreve direto no banco".
 */
@Module({
  imports: [CrmModule, RagModule, AutomationsModule, MarketplaceModule, BlueprintModule],
  controllers: [NyroController],
  providers: [NyroService, ToolExecutorService],
  exports: [NyroService],
})
export class NyroModule {}

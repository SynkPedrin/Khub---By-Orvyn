import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { MarketplaceModule } from '../marketplace/marketplace.module';
import { BlueprintService } from './blueprint.service';
import { BlueprintController } from './blueprint.controller';

/**
 * Blueprints por nicho (ADR-0022). Depende de `crm` (cria o funil) e
 * `marketplace` (instala as automações). Exporta o serviço para a Nyro usar
 * na tool `aplicar_blueprint`.
 */
@Module({
  imports: [CrmModule, MarketplaceModule],
  controllers: [BlueprintController],
  providers: [BlueprintService],
  exports: [BlueprintService],
})
export class BlueprintModule {}

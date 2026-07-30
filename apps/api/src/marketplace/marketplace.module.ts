import { Module } from '@nestjs/common';
import { AutomationsModule } from '../automations/automations.module';
import { MarketplaceService } from './marketplace.service';
import { MarketplaceController } from './marketplace.controller';

/**
 * Marketplace de automações (ADR-0020). Depende de `automations` para reusar o
 * `WorkflowsService` na instalação — nunca recria o motor.
 */
@Module({
  imports: [AutomationsModule],
  controllers: [MarketplaceController],
  providers: [MarketplaceService],
  exports: [MarketplaceService],
})
export class MarketplaceModule {}

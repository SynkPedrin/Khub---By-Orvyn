import { Module } from '@nestjs/common';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { StripeWebhookController } from './stripe-webhook.controller';
import { FinanceiroModule } from '../financeiro/financeiro.module';

@Module({
  imports: [FinanceiroModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}

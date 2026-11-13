import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsIn } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { BillingService, type Plano } from './billing.service';

class CheckoutDto {
  @IsIn(['starter', 'growth', 'scale']) plano!: Plano;
}

/**
 * Billing da PLATAFORMA (o tenant pagando o KHUB) — distinto de
 * `/v1/financeiro` (o tenant cobrando os clientes dele).
 */
@SkipAudit()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('status')
  status(@TenantId() t: string) {
    return this.billing.status(t);
  }

  @Post('checkout')
  checkout(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.billing.criarCheckout(t, u.email, dto.plano);
  }

  @Post('portal')
  portal(@TenantId() t: string) {
    return this.billing.criarPortal(t);
  }
}

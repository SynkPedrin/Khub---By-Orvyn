import { OperationsModule } from './operations/operations.module';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './common/audit.interceptor';
import { RateLimitGuard } from './common/rate-limit.guard';
import { CorrelationMiddleware } from './common/correlation.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { RagModule } from './rag/rag.module';
import { CrmModule } from './crm/crm.module';
import { AuthModule } from './auth/auth.module';
import { TenantsModule } from './tenants/tenants.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { SettingsModule } from './settings/settings.module';
import { FinanceiroModule } from './financeiro/financeiro.module';
import { BillingModule } from './billing/billing.module';
import { AgendaModule } from './agenda/agenda.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { RealtimeModule } from './realtime/realtime.module';
import { EventsModule } from './events/events.module';
import { AutomationsModule } from './automations/automations.module';
import { MarketplaceModule } from './marketplace/marketplace.module';
import { BlueprintModule } from './blueprints/blueprint.module';
import { NyroModule } from './nyro/nyro.module';
import { ConfigModule } from './config/config.module';
import { CommonModule } from './common/common.module';
import { AiModule } from './ai/ai.module';
import { AgencyModule } from './agency/agency.module';
import { AgentsModule } from './agents/agents.module';
import { DisparosModule } from './disparos/disparos.module';
import { AvaliacoesModule } from './avaliacoes/avaliacoes.module';
import { FormsModule } from './forms/forms.module';
import { BookingModule } from './booking/booking.module';
import { PermissionsGuard } from './auth/permissions.guard';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

@Module({
  imports: [OperationsModule, ConfigModule, CommonModule, AiModule, PrismaModule, AuthModule, TenantsModule, RealtimeModule, EventsModule, RagModule, CrmModule, AutomationsModule, MarketplaceModule, BlueprintModule, NyroModule, IntegrationsModule, SettingsModule, FinanceiroModule, BillingModule, AgendaModule, AnalyticsModule, AgencyModule, AgentsModule, DisparosModule, AvaliacoesModule, FormsModule, BookingModule],
  controllers: [HealthController],
  providers: [
    // Ordem importa: autentica (seta req.user) → rate limit por tenant → auditoria.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}

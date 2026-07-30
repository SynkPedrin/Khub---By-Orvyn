import { Controller, Get, Query } from '@nestjs/common';
import { TenantId } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AnalyticsService } from './analytics.service';

@SkipAudit()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('ai-usage')
  aiUsage(@TenantId() t: string, @Query('dias') dias?: string) {
    return this.analytics.aiUsage(t, dias ? Number(dias) : 30);
  }

  @Get('automacoes')
  automacoes(@TenantId() t: string, @Query('dias') dias?: string) {
    return this.analytics.automacoes(t, dias ? Number(dias) : 30);
  }
}

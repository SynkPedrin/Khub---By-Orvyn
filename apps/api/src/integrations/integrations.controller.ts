import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsString } from 'class-validator';
import { IntegrationsService } from './integrations.service';
import { AdsService } from './ads.service';
import { Public, TenantId } from '../auth/decorators';

class CallbackDto {
  @IsString() code!: string;
  @IsString() state!: string;
}

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  list(@TenantId() tenantId: string) {
    return this.integrations.list(tenantId);
  }

  @Get(':provider/auth-url')
  authUrl(@TenantId() tenantId: string, @Param('provider') provider: string, @Query('capability') capability?: string) {
    return this.integrations.getAuthUrl(tenantId, provider, capability);
  }

  /** Diagnóstico legível da conexão Meta — nunca um erro cru da Graph API. */
  @Get('meta/diagnostics')
  metaDiagnostics(@TenantId() tenantId: string) {
    return this.integrations.diagnosticoMeta(tenantId);
  }

  @Post(':id/sync')
  sync(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.integrations.sync(tenantId, id);
  }

  // Público: chamado server-side pelo front após o redirect do provider.
  @Public()
  @Post(':provider/callback')
  callback(@Param('provider') provider: string, @Body() dto: CallbackDto) {
    return this.integrations.handleCallback(provider, dto.code, dto.state);
  }
}

@Controller('ads')
export class AdsController {
  constructor(private readonly ads: AdsService) {}

  @Get('overview')
  overview(@TenantId() tenantId: string) {
    return this.ads.overview(tenantId);
  }

  @Get('campaigns')
  campaigns(@TenantId() tenantId: string) {
    return this.ads.campaigns(tenantId);
  }

  @Get('creatives')
  creatives(@TenantId() tenantId: string) {
    return this.ads.creatives(tenantId);
  }
}

import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsString } from 'class-validator';
import { IntegrationsService } from './integrations.service';
import { AdsService } from './ads.service';
import { AdsSimulatorService } from './ads-simulator.service';
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

/**
 * Simulador de campanhas (ambiente de teste, sem gastar verba). O corpo é
 * validado por Zod no serviço (payload aninhado com criativos).
 */
@Controller('ads/simulador')
export class AdsSimuladorController {
  constructor(private readonly sim: AdsSimulatorService) {}

  @Post('simular')
  @HttpCode(200)
  simular(@TenantId() tenantId: string, @Body() corpo: unknown) {
    return this.sim.simular(tenantId, corpo);
  }

  @Post('analisar')
  @HttpCode(200)
  analisar(@TenantId() tenantId: string, @Body() corpo: unknown) {
    return this.sim.analisar(tenantId, corpo);
  }

  @Get('simulacoes')
  listarSalvas(@TenantId() tenantId: string) {
    return this.sim.listarSalvas(tenantId);
  }

  @Post('simulacoes')
  salvarSimulacao(@TenantId() tenantId: string, @Body() corpo: unknown) {
    return this.sim.salvarSimulacao(tenantId, corpo);
  }

  @Delete('simulacoes/:id')
  removerSimulacao(@TenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.sim.removerSimulacao(tenantId, id);
  }
}

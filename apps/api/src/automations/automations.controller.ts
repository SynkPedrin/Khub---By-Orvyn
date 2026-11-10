import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { WorkflowsService } from './workflows.service';
import { RunsService } from './runs.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';

class CriarWorkflowDto {
  @IsString() @MinLength(1) @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(500) descricao?: string;
}
class RenomearDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) nome?: string;
  @IsOptional() @IsString() @MaxLength(500) descricao?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(24, { each: true }) tags?: string[];
}
class GrafoDto {
  @IsObject() grafo!: Record<string, unknown>;
}
class StatusDto {
  @IsIn(['ativo', 'pausado']) status!: 'ativo' | 'pausado';
}
class RollbackDto {
  @IsUUID() versionId!: string;
}
class TestarDto {
  @IsUUID() contactId!: string;
}
class ConfigDto {
  @IsOptional() @IsIn(['uma_vez', 'sempre', 'apos_terminar']) reentrada?: 'uma_vez' | 'sempre' | 'apos_terminar';
  @IsOptional() @IsBoolean() pararNoReply?: boolean;
  @IsOptional() @IsBoolean() janelaAtiva?: boolean;
  @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) janelaDias?: number[];
  @IsOptional() @IsInt() @Min(0) @Max(23) janelaInicio?: number;
  @IsOptional() @IsInt() @Min(1) @Max(24) janelaFim?: number;
  @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @IsBoolean() janelaIncluiEquipe?: boolean;
}

/** Automações (Sprint E). Tenant sempre do JWT. */
@Controller('automations')
export class AutomationsController {
  constructor(
    private readonly workflows: WorkflowsService,
    private readonly runs: RunsService,
  ) {}

  /** Paleta do canvas: os 15 nós (ADR-0012). Fonte única = catalogo.ts. */
  @Get('catalogo')
  catalogo() {
    return this.workflows.catalogo();
  }

  @Get('workflows')
  listar(@TenantId() t: string) {
    return this.workflows.listar(t);
  }

  @Get('workflows/:id')
  obter(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.obter(t, id);
  }

  @Post('workflows')
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarWorkflowDto) {
    return this.workflows.criar(t, u.identityId, dto);
  }

  @Patch('workflows/:id')
  renomear(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RenomearDto) {
    return this.workflows.renomear(t, id, dto);
  }

  /** Autosave do canvas — sempre no rascunho, nunca na versão publicada. */
  @Patch('workflows/:id/grafo')
  salvar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GrafoDto) {
    return this.workflows.salvarRascunho(t, id, dto.grafo);
  }

  /** Valida sem publicar (o canvas mostra os problemas antes do clique). */
  @Post('workflows/:id/validar')
  @HttpCode(200)
  async validar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    const w = await this.workflows.obter(t, id);
    const problemas = this.workflows.validar(w.grafo as never);
    return { ok: problemas.length === 0, problemas };
  }

  @Post('workflows/:id/publicar')
  @HttpCode(200)
  publicar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.publicar(t, id, u.identityId);
  }

  @Post('workflows/:id/rollback')
  @HttpCode(200)
  rollback(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RollbackDto) {
    return this.workflows.rollback(t, id, dto.versionId, u.identityId);
  }

  @Patch('workflows/:id/status')
  status(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.workflows.mudarStatus(t, id, dto.status, u.identityId);
  }

  @Delete('workflows/:id')
  remover(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.remover(t, id, u.identityId);
  }

  /** Configurações operacionais (reentrada, parar no reply, janela de envio). */
  @Patch('workflows/:id/config')
  configurar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfigDto) {
    return this.workflows.configurar(t, id, u.identityId, dto);
  }

  /** Gera/troca a URL pública do gatilho de webhook (a antiga para de valer). */
  @Post('workflows/:id/webhook-url')
  @HttpCode(200)
  gerarWebhook(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.gerarWebhook(t, id, u.identityId);
  }

  /**
   * Gera/rotaciona o segredo de assinatura do webhook (W5). Devolvido só aqui;
   * depois disso todo POST precisa de `X-KHUB-Signature: sha256=<hmac>`.
   */
  @Post('workflows/:id/webhook-segredo')
  @HttpCode(200)
  gerarSegredoWebhook(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.gerarSegredoWebhook(t, id, u.identityId);
  }

  /** Desliga a exigência de assinatura do webhook. */
  @Delete('workflows/:id/webhook-segredo')
  removerSegredoWebhook(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workflows.removerSegredoWebhook(t, id, u.identityId);
  }

  /** Executa AGORA com um contato real: as ações acontecem de verdade. */
  @Post('workflows/:id/testar')
  @HttpCode(200)
  testar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestarDto) {
    return this.workflows.testar(t, id, dto.contactId);
  }

  // ------------------------------------------------------------- execuções
  @Get('workflows/:id/runs')
  runsDo(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query('limite') limite?: string) {
    return this.runs.listarRuns(t, id, Number(limite) || 30);
  }

  @Get('runs/:id')
  run(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.detalheRun(t, id);
  }

  @Post('runs/:id/cancelar')
  @HttpCode(200)
  cancelar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.cancelar(t, id);
  }

  @Get('dlq')
  dlq(@TenantId() t: string) {
    return this.runs.listarDlq(t);
  }

  @Post('dlq/:id/reprocessar')
  @HttpCode(200)
  reprocessar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.runs.reprocessar(t, id);
  }
}

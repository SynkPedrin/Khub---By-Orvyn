import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { WorkflowsService } from './workflows.service';
import { RunsService } from './runs.service';
import { EditorService, normalizarDesde } from './editor.service';
import { NicoMontadorService } from './nico-montador.service';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';

class CriarWorkflowDto {
  @IsString() @MinLength(1) @MaxLength(160) nome!: string;
  @IsOptional() @IsString() @MaxLength(500) descricao?: string;
}
class RenomearDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) nome?: string;
  @IsOptional() @IsString() @MaxLength(500) descricao?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) @MaxLength(24, { each: true }) tags?: string[];
  /** Pasta da lista (db/058). `null` tira o fluxo da pasta. */
  @IsOptional() @IsString() @MaxLength(60) pasta?: string | null;
}
class StatsQuery {
  @IsOptional() @IsISO8601() desde?: string;
}
class MetricasQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(90) dias?: number;
}
class RunsContatoQuery {
  @IsUUID() contactId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limite?: number;
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
/** Modo simples: a conversa com a NICO que descreve o fluxo. */
class MensagemNicoDto {
  @IsIn(['usuario', 'nico']) autor!: 'usuario' | 'nico';
  @IsString() @MinLength(1) @MaxLength(3000) texto!: string;
}
class NicoMontarDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MensagemNicoDto) conversa!: MensagemNicoDto[];
  @IsOptional() @IsUUID() workflowId?: string;
}
class NicoTestarDto {
  @IsOptional() @IsUUID() contactId?: string;
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
    private readonly editor: EditorService,
    private readonly nico: NicoMontadorService,
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

  /** Métricas dos cards da lista (Q3.3): ativos agora, concluídos e erros no período. */
  @Get('workflows/metricas')
  metricas(@TenantId() t: string, @Query() q: MetricasQuery) {
    return this.editor.metricas(t, q.dias ?? 30);
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

  /** Duplica o fluxo (rascunho novo, sem webhook nem segredo do original). */
  @Post('workflows/:id/duplicar')
  duplicar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.editor.duplicar(t, u.identityId, id);
  }

  /** Histórico de versões publicadas (número, data, autor, nº de nós, ativa). */
  @Get('workflows/:id/versoes')
  versoes(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.editor.versoes(t, id);
  }

  /** Grafo de uma versão, para ver em modo leitura antes de restaurar. */
  @Get('workflows/:id/versoes/:versionId')
  versao(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Param('versionId', ParseUUIDPipe) versionId: string) {
    return this.editor.versao(t, id, versionId);
  }

  /** Estatística por nó no canvas: concluídos, esperando agora e erros desde `desde` (padrão 7 dias). */
  @Get('workflows/:id/stats')
  stats(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Query() q: StatsQuery) {
    return this.editor.estatisticas(t, id, normalizarDesde(q.desde));
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

  // ------------------------------------------------- modo simples (NICO)
  /** Conversa → automação em RASCUNHO (nunca publica). Pode devolver perguntas. */
  @Post('nico/montar')
  @HttpCode(200)
  nicoMontar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: NicoMontarDto) {
    return this.nico.montar(t, u.identityId, dto.conversa, dto.workflowId);
  }

  /** Teste real com dados reais: execução de teste, mensagens só no número de teste. */
  @Post('nico/workflows/:id/testar')
  @HttpCode(200)
  nicoTestar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NicoTestarDto) {
    return this.nico.testar(t, id, dto.contactId);
  }

  // ------------------------------------------------------------- execuções
  /** Execuções de um contato em todos os fluxos (perfil do contato). */
  @Get('runs')
  runsDoContato(@TenantId() t: string, @Query() q: RunsContatoQuery) {
    return this.editor.runsDoContato(t, q.contactId, q.limite ?? 50);
  }

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
  cancelar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    // "Remover deste fluxo" (Q3.3): auditado e diz se havia o que cancelar.
    return this.editor.cancelarRun(t, id, u.identityId);
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

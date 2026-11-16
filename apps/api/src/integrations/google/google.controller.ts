import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Post, Query } from '@nestjs/common';
import { Equals, IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public, TenantId, type AuthUser } from '../../auth/decorators';
import { SkipAudit } from '../../common/audit.interceptor';
import { GoogleConexaoService } from './google-conexao.service';
import { TagManagerService } from './tag-manager.service';
import { SearchConsoleService } from './search-console.service';
import { MeuNegocioService } from './meu-negocio.service';
import { capacidadeValida } from './google-escopos';

class CallbackDto {
  @IsString() @MinLength(1) @MaxLength(2048) code!: string;
  @IsString() @MinLength(1) @MaxLength(4096) state!: string;
}

/** Toda escrita no Google exige `confirmar: true`: a UI só manda depois do diálogo de confirmação. */
class CriarTagDto {
  @IsString() @MaxLength(200) workspace!: string;
  @IsString() @Matches(/^G-[A-Za-z0-9]+$/) idMedicao!: string;
  @IsOptional() @IsString() @MaxLength(200) nome?: string;
  @IsOptional() @IsString() @Matches(/^\d+$/) acionadorId?: string;
  @IsBoolean() @Equals(true) confirmar!: boolean;
}

class PublicarDto {
  @IsString() @MaxLength(200) workspace!: string;
  @IsOptional() @IsString() @MaxLength(200) nome?: string;
  @IsOptional() @IsString() @MaxLength(2000) notas?: string;
  @IsBoolean() @Equals(true) confirmar!: boolean;
}

class ResponderDto {
  @IsString() @MaxLength(300) avaliacao!: string;
  @IsString() @MinLength(1) @MaxLength(4096) comentario!: string;
  @IsBoolean() @Equals(true) confirmar!: boolean;
}

/**
 * Presença Google da subconta: `/v1/google/*`.
 * Permissões (permissions.guard.ts): leitura = manager+ (`google.read`);
 * conectar, desconectar e qualquer escrita no Google = owner/admin.
 * Escritas são auditadas pelo serviço (payload rico) → @SkipAudit nelas.
 */
@Controller('google')
export class GoogleController {
  constructor(
    private readonly conexao: GoogleConexaoService,
    private readonly gtm: TagManagerService,
    private readonly sc: SearchConsoleService,
    private readonly gbp: MeuNegocioService,
  ) {}

  // ---- conexão --------------------------------------------------------------

  @Get('status')
  status(@TenantId() tenantId: string) {
    return this.conexao.status(tenantId);
  }

  @Get('auth-url')
  authUrl(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Query('capacidade') capacidade?: string) {
    const c = capacidade ?? 'leitura';
    if (!capacidadeValida(c)) throw new BadRequestException('capacidade inválida');
    return this.conexao.urlConexao(tenantId, user.identityId ?? null, c);
  }

  /** Público: o web recebe o redirect do Google e repassa code + state (o state assinado carrega o tenant). */
  @Public()
  @Post('callback')
  @HttpCode(200)
  callback(@Body() dto: CallbackDto) {
    return this.conexao.callback(dto.code, dto.state);
  }

  @SkipAudit()
  @Delete('conexao')
  desconectar(@TenantId() tenantId: string, @CurrentUser() user: AuthUser) {
    return this.conexao.desconectar(tenantId, user.identityId ?? null);
  }

  // ---- Tag Manager ----------------------------------------------------------

  @Get('tag-manager/contas')
  gtmContas(@TenantId() tenantId: string) {
    return this.gtm.contas(tenantId);
  }

  @Get('tag-manager/containers')
  gtmContainers(@TenantId() tenantId: string, @Query('conta') conta?: string) {
    return this.gtm.containers(tenantId, conta);
  }

  @Get('tag-manager/workspaces')
  gtmWorkspaces(@TenantId() tenantId: string, @Query('container') container?: string) {
    return this.gtm.workspaces(tenantId, container);
  }

  @Get('tag-manager/workspace')
  gtmWorkspace(@TenantId() tenantId: string, @Query('workspace') workspace?: string) {
    return this.gtm.workspace(tenantId, workspace);
  }

  @Get('tag-manager/snippet')
  gtmSnippet(@TenantId() tenantId: string, @Query('container') container?: string) {
    return this.gtm.snippet(tenantId, container);
  }

  @SkipAudit()
  @Post('tag-manager/tags')
  gtmCriarTag(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Body() dto: CriarTagDto) {
    return this.gtm.criarGoogleTag(tenantId, user.identityId ?? null, { workspace: dto.workspace, idMedicao: dto.idMedicao, nome: dto.nome, acionadorId: dto.acionadorId });
  }

  @SkipAudit()
  @Post('tag-manager/publicar')
  @HttpCode(200)
  gtmPublicar(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Body() dto: PublicarDto) {
    return this.gtm.publicar(tenantId, user.identityId ?? null, { workspace: dto.workspace, nome: dto.nome, notas: dto.notas });
  }

  // ---- Search Console -------------------------------------------------------

  @Get('search-console/sites')
  scSites(@TenantId() tenantId: string) {
    return this.sc.sites(tenantId);
  }

  @Get('search-console/analise')
  scAnalise(@TenantId() tenantId: string, @Query('site') site?: string) {
    return this.sc.analise(tenantId, site);
  }

  /** GET de propósito: inspecionar é leitura (urlInspection não altera nada no Google). */
  @Get('search-console/inspecao')
  scInspecao(@TenantId() tenantId: string, @Query('site') site?: string, @Query('url') url?: string) {
    return this.sc.inspecionar(tenantId, site, url);
  }

  // ---- Perfil da Empresa (Meu Negócio) --------------------------------------

  @Get('meu-negocio/contas')
  gbpContas(@TenantId() tenantId: string) {
    return this.gbp.contas(tenantId);
  }

  @Get('meu-negocio/locais')
  gbpLocais(@TenantId() tenantId: string, @Query('conta') conta?: string) {
    return this.gbp.locais(tenantId, conta);
  }

  @Get('meu-negocio/avaliacoes')
  gbpAvaliacoes(@TenantId() tenantId: string, @Query('conta') conta?: string, @Query('local') local?: string, @Query('pagina') pagina?: string) {
    return this.gbp.avaliacoes(tenantId, conta, local, pagina);
  }

  @SkipAudit()
  @Post('meu-negocio/avaliacoes/responder')
  @HttpCode(200)
  gbpResponder(@TenantId() tenantId: string, @CurrentUser() user: AuthUser, @Body() dto: ResponderDto) {
    return this.gbp.responder(tenantId, user.identityId ?? null, dto.avaliacao, dto.comentario);
  }

  @Get('meu-negocio/desempenho')
  gbpDesempenho(@TenantId() tenantId: string, @Query('local') local?: string) {
    return this.gbp.desempenho(tenantId, local);
  }
}

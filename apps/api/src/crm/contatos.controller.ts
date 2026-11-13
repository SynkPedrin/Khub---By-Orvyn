import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { hasPermission } from '../auth/permissions.guard';
import { SkipAudit } from '../common/audit.interceptor';
import { ACOES_MASSA, ContatosMassaService, LIMITE_MASSA, type AcaoMassa } from './contatos-massa.service';
import { ContatosMesclaService, MAX_DUPLICADOS_POR_MESCLA } from './contatos-mescla.service';
import { ContatosViewsService } from './contatos-views.service';

class BulkDto {
  @IsOptional() @IsArray() @ArrayMaxSize(LIMITE_MASSA) @IsUUID('all', { each: true }) ids?: string[];
  /** Mesmo contrato do filtro de `GET /crm/contacts` (validado por Zod no serviço). */
  @IsOptional() @IsObject() filtro?: Record<string, unknown>;
  @IsIn(ACOES_MASSA as unknown as string[]) acao!: AcaoMassa;
  @IsOptional() @IsObject() params?: Record<string, unknown>;
}
class MergeDto {
  @IsUUID() principalId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(MAX_DUPLICADOS_POR_MESCLA) @IsUUID('all', { each: true }) duplicadoIds!: string[];
}
class ViewDto {
  @IsOptional() @IsString() @MaxLength(80) nome?: string;
  @IsOptional() @IsObject() filtros?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) colunas?: string[];
  @IsOptional() @IsString() @MaxLength(20) ordem?: string;
  @IsOptional() @IsBoolean() compartilhada?: boolean;
}
class CriarViewDto extends ViewDto {
  @IsString() @MaxLength(80) declare nome: string;
}

/**
 * Lista de Leads/Contatos no modo real (Q2.2): ações em massa, duplicados,
 * mesclagem e listas salvas. Registrado ANTES do CrmController no módulo:
 * `GET contacts/duplicates` tem que casar antes de `GET contacts/:id`.
 * Permissão base: `contacts.write` (PermissionsGuard). Excluir em massa e
 * mesclar apagam registros: exigem o mesmo nível da importação (manager+).
 */
@Controller('crm')
export class ContatosController {
  constructor(
    private readonly massa: ContatosMassaService,
    private readonly mescla: ContatosMesclaService,
    private readonly views: ContatosViewsService,
  ) {}

  /** O serviço grava UMA linha de auditoria com o alcance da operação. */
  @SkipAudit()
  @Post('contacts/bulk')
  @HttpCode(200)
  bulk(@CurrentUser() u: AuthUser, @Body() dto: BulkDto) {
    if (dto.acao === 'excluir') exigir(u, 'contacts.import', 'excluir em massa exige perfil gerente ou superior');
    return this.massa.executar(u.tenantId, u.identityId, { ids: dto.ids, filtro: dto.filtro, acao: dto.acao, params: dto.params });
  }

  @Get('contacts/duplicates')
  duplicados(@TenantId() t: string) {
    return this.mescla.duplicados(t);
  }

  @SkipAudit()
  @Post('contacts/merge')
  @HttpCode(200)
  merge(@CurrentUser() u: AuthUser, @Body() dto: MergeDto) {
    exigir(u, 'contacts.import', 'mesclar contatos exige perfil gerente ou superior');
    return this.mescla.mesclar(u.tenantId, u.identityId, dto.principalId, dto.duplicadoIds);
  }

  // ---------------- Listas salvas ----------------
  @Get('contact-views')
  listarViews(@CurrentUser() u: AuthUser) {
    return this.views.listar(u.tenantId, u.identityId);
  }
  @Post('contact-views')
  criarView(@CurrentUser() u: AuthUser, @Body() dto: CriarViewDto) {
    return this.views.criar(u.tenantId, u.identityId, dto);
  }
  @Patch('contact-views/:id')
  atualizarView(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ViewDto) {
    return this.views.atualizar(u.tenantId, u.identityId, id, dto);
  }
  @Delete('contact-views/:id')
  removerView(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.views.remover(u.tenantId, u.identityId, id);
  }
}

function exigir(u: AuthUser, permissao: string, msg: string) {
  if (!hasPermission(u, permissao)) throw new ForbiddenException(msg);
}

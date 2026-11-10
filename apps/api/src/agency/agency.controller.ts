import { Body, Controller, Delete, Get, Headers, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AgencyService } from './agency.service';

class CriarClienteDto {
  @IsString() @MinLength(2) @MaxLength(120) nome!: string;
  @IsOptional() @IsString() @MaxLength(80) nicho?: string;
}

/**
 * Auditoria própria (não a rede de segurança global): estas rotas são
 * cross-tenant por natureza (agência enxerga vários tenants), então o
 * `AuditInterceptor` — que audita usando o tenant ATUAL da sessão, antes da
 * troca — gravaria no tenant errado. `AgencyService` já grava a linha certa
 * (no tenant do cliente afetado) em `criarCliente`/`ativarCliente`.
 */
@SkipAudit()
@Controller('agency')
export class AgencyController {
  constructor(private readonly agency: AgencyService) {}

  @Get()
  meuContexto(@CurrentUser() user: AuthUser) {
    return this.agency.meuContexto(user.identityId);
  }

  @Get('clients')
  listarClientes(@CurrentUser() user: AuthUser) {
    return this.agency.listarClientes(user.identityId);
  }

  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.agency.overview(user.identityId);
  }

  @Get('members')
  listarMembros(@CurrentUser() user: AuthUser) {
    return this.agency.listarMembros(user.identityId);
  }

  /** Remove o membro da agência e os acessos dele aos clientes (SEC-01). */
  @Delete('members/:id')
  removerMembro(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agency.removerMembro(user.identityId, id);
  }

  @Get('clients/:id')
  detalheCliente(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agency.detalheCliente(user.identityId, id);
  }

  @Post('clients')
  criarCliente(@CurrentUser() user: AuthUser, @Body() dto: CriarClienteDto) {
    return this.agency.criarCliente(user.identityId, dto);
  }

  @Post('clients/:id/activate')
  ativarCliente(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.agency.ativarCliente(user.identityId, id, userAgent);
  }
}

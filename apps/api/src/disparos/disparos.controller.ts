import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { DisparosService, audienciaSchema, validar, type Ator } from './disparos.service';

const humano = (u: AuthUser): Ator => ({ tipo: 'humano', identityId: u.identityId, role: u.role });

/**
 * Disparo em massa (Q4.3). Permissões (PermissionsGuard): leitura = `contacts.read`;
 * escrita = `automations.write` (manager+); aprovar/rejeitar = `organization.manage`
 * (owner/admin) e o serviço confere de novo o papel.
 * A auditoria de negócio é feita no serviço (`audit_logs`, entidade `broadcast`).
 */
@SkipAudit()
@Controller('disparos')
export class DisparosController {
  constructor(private readonly disparos: DisparosService) {}

  @Get()
  listar(@TenantId() t: string, @Query('status') status?: string) {
    return this.disparos.listar(t, status || undefined);
  }

  @Get('limites')
  limites(@TenantId() t: string, @Query('fuso') fuso?: string) {
    return this.disparos.limitesDoTenant(t, fuso && /^[A-Za-z_]+\/[A-Za-z_/-]+$/.test(fuso) ? fuso : undefined);
  }

  @Post('audiencia')
  @HttpCode(200)
  audiencia(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    const d = validar(audienciaSchema, body);
    return this.disparos.audiencia(t, u.identityId, d.canal, d.segmento);
  }

  @Post('previa')
  @HttpCode(200)
  previa(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.disparos.previa(t, u.identityId, body);
  }

  @Post()
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.disparos.criar(t, humano(u), body);
  }

  @Get(':id')
  detalhe(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.detalhe(t, id);
  }

  @Get(':id/destinatarios')
  destinatarios(
    @TenantId() t: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('status') status?: string,
    @Query('q') busca?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.disparos.destinatarios(t, id, { status: status || undefined, busca: busca?.trim().slice(0, 120) || undefined, cursor: cursor || undefined, limit: limit ? Number(limit) || undefined : undefined });
  }

  @Patch(':id')
  atualizar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.disparos.atualizar(t, humano(u), id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  remover(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.remover(t, humano(u), id);
  }

  @Post(':id/enviar')
  @HttpCode(200)
  enviar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.enviar(t, humano(u), id);
  }

  @Post(':id/aprovar')
  @HttpCode(200)
  aprovar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.aprovar(t, humano(u), id);
  }

  @Post(':id/rejeitar')
  @HttpCode(200)
  rejeitar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.disparos.rejeitar(t, humano(u), id, body);
  }

  @Post(':id/pausar')
  @HttpCode(200)
  pausar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.pausar(t, humano(u), id);
  }

  @Post(':id/retomar')
  @HttpCode(200)
  retomar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.retomar(t, humano(u), id);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  cancelar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.disparos.cancelar(t, humano(u), id);
  }
}

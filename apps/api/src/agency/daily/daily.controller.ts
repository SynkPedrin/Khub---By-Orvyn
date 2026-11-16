import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth/decorators';
import { SkipAudit } from '../../common/audit.interceptor';
import { AgencyDailyService } from './daily.service';

/**
 * Daily da agência (ADR-0050): Minhas tarefas, Todas as tarefas, Studio e
 * Calendário. Escopo = agência da identidade logada; o corpo é validado com
 * Zod no service (mesmo padrão de forms/booking).
 *
 * `@SkipAudit`: dado da agência, não de um tenant. O interceptor global
 * gravaria no tenant atual da sessão, que não é o dono deste dado.
 */
@SkipAudit()
@Controller('agency/daily')
export class AgencyDailyController {
  constructor(private readonly daily: AgencyDailyService) {}

  @Get('base')
  base(@CurrentUser() u: AuthUser) {
    return this.daily.base(u.identityId);
  }

  @Get('tarefas')
  listar(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.daily.listar(u.identityId, q);
  }

  @Get('studio')
  studio(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.daily.listar(u.identityId, q, true);
  }

  @Get('tarefas/:id')
  detalhe(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.daily.detalhe(u.identityId, id);
  }

  @Post('tarefas')
  criar(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    return this.daily.criar(u.identityId, body);
  }

  @Patch('tarefas/:id')
  atualizar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.daily.atualizar(u.identityId, id, body);
  }

  @Delete('tarefas/:id')
  excluir(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.daily.excluir(u.identityId, id);
  }

  @Post('tarefas/:id/checklist')
  adicionarItem(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.daily.adicionarItem(u.identityId, id, body);
  }

  @Patch('checklist/:id')
  atualizarItem(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.daily.atualizarItem(u.identityId, id, body);
  }

  @Delete('checklist/:id')
  removerItem(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.daily.removerItem(u.identityId, id);
  }

  @Post('tarefas/:id/comentarios')
  comentar(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.daily.comentar(u.identityId, id, body);
  }

  @Delete('comentarios/:id')
  removerComentario(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.daily.removerComentario(u.identityId, id);
  }

  @Get('calendario')
  calendario(@CurrentUser() u: AuthUser, @Query() q: Record<string, unknown>) {
    return this.daily.calendario(u.identityId, q);
  }

  @Post('eventos')
  criarEvento(@CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    return this.daily.criarEvento(u.identityId, body);
  }

  @Patch('eventos/:id')
  atualizarEvento(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.daily.atualizarEvento(u.identityId, id, body);
  }

  @Delete('eventos/:id')
  removerEvento(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.daily.removerEvento(u.identityId, id);
  }
}

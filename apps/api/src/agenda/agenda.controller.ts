import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AgendaService } from './agenda.service';

class CriarCompromissoDto {
  @IsString() @MaxLength(200) titulo!: string;
  @IsString() inicio!: string;
  @IsString() fim!: string;
  @IsOptional() @IsString() contactId?: string;
  @IsOptional() @IsString() @MaxLength(200) local?: string;
  @IsOptional() @IsString() @MaxLength(1000) notas?: string;
}
class StatusDto {
  @IsIn(['agendado', 'confirmado', 'concluido', 'cancelado', 'nao_compareceu']) status!: string;
}

@SkipAudit()
@Controller('agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('compromissos')
  listar(@TenantId() t: string, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.agenda.listar(t, { de, ate });
  }
  @Get('horarios')
  horarios(
    @TenantId() t: string,
    @Query('data') data: string,
    @Query('duracao') duracao?: string,
    @Query('das') das?: string,
    @Query('ate') ate?: string,
  ) {
    return this.agenda.sugerirHorarios(t, data, duracao ? Number(duracao) : 60, das ? Number(das) : 9, ate ? Number(ate) : 18);
  }
  @Post('compromissos')
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarCompromissoDto) {
    return this.agenda.criar(t, u.identityId, dto);
  }
  @Post('compromissos/:id/status')
  status(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: StatusDto) {
    return this.agenda.atualizarStatus(t, u.identityId, id, dto.status);
  }
  @Post('compromissos/:id/sincronizar')
  sincronizar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.agenda.sincronizarCalendar(t, u.identityId, id);
  }
  @Delete('compromissos/:id')
  @HttpCode(200)
  remover(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.agenda.remover(t, u.identityId, id);
  }
}

import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { IsIn, IsISO8601, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { AgendaService, STATUS_AGENDA, TIPOS_AGENDA, type StatusAgenda, type TipoAgenda } from './agenda.service';

class CriarCompromissoDto {
  @IsString() @MaxLength(200) titulo!: string;
  @IsISO8601() inicio!: string;
  @IsISO8601() fim!: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(200) local?: string;
  @IsOptional() @IsString() @MaxLength(1000) notas?: string;
  @IsOptional() @IsIn([...TIPOS_AGENDA]) tipo?: TipoAgenda;
  /** `null` = agenda geral (sem responsável). Ausente = quem cria. */
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() responsavelId?: string | null;
}
/** PATCH parcial: arrastar/redimensionar mandam só inicio/fim. `null` limpa o campo. */
class AtualizarCompromissoDto {
  @IsOptional() @IsString() @MaxLength(200) titulo?: string;
  @IsOptional() @IsISO8601() inicio?: string;
  @IsOptional() @IsISO8601() fim?: string;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() contactId?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(200) local?: string | null;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsString() @MaxLength(1000) notas?: string | null;
  @IsOptional() @IsIn([...TIPOS_AGENDA]) tipo?: TipoAgenda;
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID() responsavelId?: string | null;
}
class StatusDto {
  @IsIn([...STATUS_AGENDA]) status!: StatusAgenda;
}

/** `?status=agendado,confirmado` → lista validada. */
function statusDaQuery(q?: string): StatusAgenda[] | undefined {
  if (!q) return undefined;
  const lista = q.split(',').map((s) => s.trim()).filter(Boolean);
  const invalido = lista.find((s) => !(STATUS_AGENDA as readonly string[]).includes(s));
  if (invalido) throw new BadRequestException(`status inválido: ${invalido}`);
  return lista as StatusAgenda[];
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@SkipAudit()
@Controller('agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('compromissos')
  listar(
    @TenantId() t: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('responsavelId') responsavelId?: string,
    @Query('status') status?: string,
  ) {
    if (responsavelId && !UUID_RE.test(responsavelId)) throw new BadRequestException('responsavelId inválido');
    return this.agenda.listar(t, { de, ate, responsavelId, status: statusDaQuery(status) });
  }
  @Get('horarios')
  horarios(
    @TenantId() t: string,
    @Query('data') data: string,
    @Query('duracao') duracao?: string,
    @Query('das') das?: string,
    @Query('ate') ate?: string,
    @Query('responsavelId') responsavelId?: string,
  ) {
    if (responsavelId && !UUID_RE.test(responsavelId)) throw new BadRequestException('responsavelId inválido');
    const n = (v: string | undefined, padrao: number) => {
      if (v === undefined) return padrao;
      const x = Number(v);
      if (!Number.isFinite(x)) throw new BadRequestException('parâmetro numérico inválido');
      return x;
    };
    const inicioH = n(das, 9); const fimH = n(ate, 18);
    if (inicioH < 0 || fimH > 24 || fimH <= inicioH) throw new BadRequestException('faixa de horário inválida');
    return this.agenda.sugerirHorarios(t, data, n(duracao, 60), inicioH, fimH, responsavelId ?? null);
  }
  @Post('compromissos')
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() dto: CriarCompromissoDto) {
    return this.agenda.criar(t, u.identityId, dto);
  }
  @Patch('compromissos/:id')
  atualizar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AtualizarCompromissoDto) {
    return this.agenda.atualizar(t, u.identityId, id, dto);
  }
  @Post('compromissos/:id/status')
  status(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StatusDto) {
    return this.agenda.atualizarStatus(t, u.identityId, id, dto.status);
  }
  @Post('compromissos/:id/sincronizar')
  sincronizar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agenda.sincronizarCalendar(t, u.identityId, id);
  }
  @Delete('compromissos/:id')
  @HttpCode(200)
  remover(@TenantId() t: string, @CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.agenda.remover(t, u.identityId, id);
  }
}

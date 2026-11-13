import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { CurrentUser, TenantId, type AuthUser } from '../auth/decorators';
import { BookingService } from './booking.service';

/**
 * Páginas de agendamento (Q4.2), área autenticada. Corpo validado por Zod no
 * serviço (horários por dia e perguntas extras são jsonb aninhados).
 * Permissão (PermissionsGuard): leitura `contacts.read`, escrita `organization.manage`.
 * Exceção CAL-PESSOAL: `minha` é self-service — qualquer membro (`agenda.write`)
 * cria/edita a PRÓPRIA página; o servidor impõe a fila (responsáveis = ele).
 */
@Controller('booking-pages')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  @Get('minha')
  minha(@TenantId() t: string, @CurrentUser() u: AuthUser) {
    return this.booking.minha(t, u.identityId);
  }

  @Put('minha')
  salvarMinha(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    return this.booking.salvarMinha(t, u.identityId, body);
  }

  @Get()
  listar(@TenantId() t: string) {
    return this.booking.listar(t);
  }

  @Post()
  criar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: Record<string, unknown>) {
    return this.booking.criar(t, u.identityId, body);
  }

  @Get(':id')
  obter(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.obter(t, id);
  }

  @Patch(':id')
  atualizar(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: Record<string, unknown>) {
    return this.booking.atualizar(t, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  remover(@TenantId() t: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.remover(t, id);
  }
}

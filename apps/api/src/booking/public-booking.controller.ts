import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../common/rate-limit.guard';
import { ipDoCliente, userAgentDe, type RequisicaoPublica } from '../common/public-request';
import { BookingService } from './booking.service';

const ctx = (req: RequisicaoPublica) => ({ ip: ipDoCliente(req), userAgent: userAgentDe(req) });

/**
 * Agendamento PÚBLICO (Q4.2), sem sessão. Tenant sai do slug ou do hash do
 * token (funções SECURITY DEFINER da db/060). `@SkipRateLimit`: o serviço
 * limita pelo IP real do visitante (o global veria só o proxy do web).
 */
@Public()
@SkipRateLimit()
@Controller('public/booking')
export class PublicBookingController {
  constructor(private readonly booking: BookingService) {}

  @Get(':slug')
  pagina(@Param('slug') slug: string, @Req() req: RequisicaoPublica) {
    return this.booking.publico(slug, ctx(req));
  }

  @Get(':slug/slots')
  slots(@Param('slug') slug: string, @Query('data') data: string, @Req() req: RequisicaoPublica) {
    return this.booking.slots(slug, data ?? '', ctx(req));
  }

  @Post(':slug/book')
  @HttpCode(201)
  reservar(@Param('slug') slug: string, @Body() body: Record<string, unknown>, @Req() req: RequisicaoPublica) {
    return this.booking.reservar(slug, body, ctx(req));
  }
}

/**
 * Gerenciar a reserva pelo link enviado ao visitante (`/b/<slug>/gerenciar/<token>`).
 * O token (256 bits, só o sha256 fica no banco) é a credencial.
 */
@Public()
@SkipRateLimit()
@Controller('public/reservas')
export class PublicReservasController {
  constructor(private readonly booking: BookingService) {}

  @Get(':token')
  obter(@Param('token') token: string, @Req() req: RequisicaoPublica) {
    return this.booking.reserva(token, ctx(req));
  }

  @Post(':token/cancelar')
  @HttpCode(200)
  cancelar(@Param('token') token: string, @Req() req: RequisicaoPublica) {
    return this.booking.cancelar(token, ctx(req));
  }

  @Post(':token/remarcar')
  @HttpCode(200)
  remarcar(@Param('token') token: string, @Body() body: Record<string, unknown>, @Req() req: RequisicaoPublica) {
    return this.booking.remarcar(token, body, ctx(req));
  }

  @Get(':token/ics')
  async ics(@Param('token') token: string, @Req() req: RequisicaoPublica, @Res() res: Response) {
    const conteudo = await this.booking.ics(token, ctx(req));
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="agendamento.ics"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(conteudo);
  }
}

import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { SkipRateLimit } from '../common/rate-limit.guard';
import { ipDoCliente, userAgentDe, type RequisicaoPublica } from '../common/public-request';
import { FormsService } from './forms.service';

/**
 * Formulário PÚBLICO (Q4.1), sem sessão. O tenant sai do slug (função SECURITY
 * DEFINER da db/059); nada no corpo escolhe conta.
 *
 * `@SkipRateLimit`: o limite global conta por `req.ip`, que aqui é o proxy do
 * web (todo visitante viria do mesmo IP). O serviço aplica o limite pelo IP
 * REAL do visitante (`ipDoCliente`, validado pelo segredo do proxy).
 */
@Public()
@SkipRateLimit()
@Controller('public/forms')
export class PublicFormsController {
  constructor(private readonly forms: FormsService) {}

  @Get(':slug')
  obter(@Param('slug') slug: string, @Req() req: RequisicaoPublica) {
    return this.forms.publico(slug, { ip: ipDoCliente(req), userAgent: userAgentDe(req) });
  }

  @Post(':slug/submit')
  @HttpCode(200)
  enviar(@Param('slug') slug: string, @Body() body: Record<string, unknown>, @Req() req: RequisicaoPublica) {
    return this.forms.enviar(slug, body, { ip: ipDoCliente(req), userAgent: userAgentDe(req) });
  }
}

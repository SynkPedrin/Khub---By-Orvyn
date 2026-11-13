import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { CurrentUser, Public, TenantId, type AuthUser } from '../auth/decorators';
import { SkipAudit } from '../common/audit.interceptor';
import { ConfigRequiredException, type Provider } from '../config/config.service';
import { ipDoCliente, PublicRateLimiter, type RequisicaoPublica } from '../common/public-request';
import { AvaliacoesService, pedirSchema, TOKEN_RE, validar } from './avaliacoes.service';

/**
 * Avaliações (Q4.4). Permissões (PermissionsGuard): leitura `contacts.read`;
 * `pedidos` = `contacts.write`; configuração = `organization.manage`.
 */
@SkipAudit()
@Controller('avaliacoes')
export class AvaliacoesController {
  constructor(private readonly avaliacoes: AvaliacoesService) {}

  @Get('config')
  config(@TenantId() t: string) {
    return this.avaliacoes.obterConfig(t);
  }

  // POST (não PUT): o proxy /api/v1 da web encaminha GET/POST/PATCH/DELETE.
  @Post('config')
  @HttpCode(200)
  salvar(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    return this.avaliacoes.salvarConfig(t, u.identityId, body);
  }

  @Get('pedidos')
  listar(@TenantId() t: string, @Query('contactId') contactId?: string, @Query('limit') limit?: string) {
    return this.avaliacoes.listar(t, { contactId: contactId || undefined, limit: limit ? Number(limit) || undefined : undefined });
  }

  @Get('resumo')
  resumo(@TenantId() t: string, @Query('dias') dias?: string) {
    return this.avaliacoes.resumo(t, dias ? Number(dias) || 90 : 90);
  }

  /** "Pedir avaliação" no perfil do contato. Sem canal configurado: 501 config_required. */
  @Post('pedidos')
  async pedir(@TenantId() t: string, @CurrentUser() u: AuthUser, @Body() body: unknown) {
    const r = await this.avaliacoes.pedir(t, validar(pedirSchema, body), { tipo: 'manual', identityId: u.identityId });
    if (r.status === 'config_required') throw new ConfigRequiredException((r.provider ?? 'evolution') as Provider, r.missing ?? []);
    return r;
  }
}

/**
 * Link curto público (`/r/:token` na web chama estas rotas). Sem sessão: o
 * token roteia para o tenant (função SECURITY DEFINER da db/062). Rate limit
 * por IP antes de qualquer escrita.
 */
@Public()
@SkipAudit()
@Controller('public/avaliacoes')
export class AvaliacoesPublicoController {
  constructor(private readonly avaliacoes: AvaliacoesService, private readonly limite: PublicRateLimiter) {}

  @Post(':token/abrir')
  @HttpCode(200)
  async abrir(@Param('token') token: string, @Req() req: RequisicaoPublica, @Headers('user-agent') ua?: string) {
    await this.limite.consumir(`avaliacao:${ipDoCliente(req)}`, 60, 600);
    return this.avaliacoes.abrir(token, ua ?? null);
  }

  @Post(':token/nota')
  @HttpCode(200)
  async nota(@Param('token') token: string, @Req() req: RequisicaoPublica, @Body() body: unknown) {
    await this.limite.consumir(`avaliacao:${ipDoCliente(req)}`, 30, 600);
    return this.avaliacoes.avaliar(token, body);
  }

  @Post(':token/feedback')
  @HttpCode(200)
  async feedback(@Param('token') token: string, @Req() req: RequisicaoPublica, @Body() body: unknown) {
    await this.limite.consumir(`avaliacao:${ipDoCliente(req)}`, 10, 600);
    return this.avaliacoes.feedback(token, body);
  }
}

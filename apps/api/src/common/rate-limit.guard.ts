import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, ServiceUnavailableException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { AuthUser } from '../auth/decorators';
import { RedisService } from './redis.service';

/** Marca uma rota para pular o rate limit (ex.: webhooks de alto volume). */
export const SKIP_RATE_LIMIT = 'skipRateLimit';
export const SkipRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(SKIP_RATE_LIMIT, true);

/**
 * Rate limit por **tenant** (autenticado) ou por **IP** (rotas públicas), janela
 * fixa no Redis. Roda DEPOIS do JwtAuthGuard (a ordem em app.module garante o
 * `req.user`). Fail-open: sem Redis, não bloqueia (ver RedisService).
 * Excede → 429 `application/problem+json` com `Retry-After`.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly windowSec = Number(process.env.RATE_LIMIT_WINDOW_SEC ?? 60);
  private readonly tenantMax = Number(process.env.RATE_LIMIT_TENANT_MAX ?? 600);
  private readonly ipMax = Number(process.env.RATE_LIMIT_IP_MAX ?? 120);

  constructor(private readonly reflector: Reflector, private readonly redis: RedisService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT, [ctx.getHandler(), ctx.getClass()]);
    if (skip) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const tenantId = req.user?.tenantId;
    const [escopo, id, max] = tenantId
      ? ['t', tenantId, this.tenantMax] as const
      : ['ip', (req.ip || req.socket?.remoteAddress || 'desconhecido'), this.ipMax] as const;

    const bucket = Math.floor(Date.now() / 1000 / this.windowSec);
    const key = `rl:${escopo}:${id}:${bucket}`;
    const n = await this.redis.incrWithTtl(key, this.windowSec);
    if (n === null) {
      if (process.env.NODE_ENV === 'production') throw new ServiceUnavailableException('proteção de tráfego indisponível');
      return true;
    }

    if (n > max) {
      const res = ctx.switchToHttp().getResponse<{ setHeader: (k: string, v: string | number) => void }>();
      res.setHeader('Retry-After', this.windowSec);
      throw new HttpException(
        { title: 'Muitas requisições', status: 429, detail: `Limite de ${max} req/${this.windowSec}s excedido. Tente novamente em instantes.`, code: 'rate_limited' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}

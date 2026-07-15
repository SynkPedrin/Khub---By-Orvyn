import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { IS_PUBLIC, type AuthUser } from './decorators';

/** Guard global: exige JWT válido, exceto rotas @Public(). Deriva o tenant do
 *  token (invariante 3 — nunca de header do browser). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('token ausente');

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tenant_id: string; role: string; email: string }>(auth.slice(7));
      const user: AuthUser = { identityId: payload.sub, tenantId: payload.tenant_id, role: payload.role, email: payload.email };
      if (!user.tenantId) throw new Error('sem tenant no token');
      (req as Request & { user: AuthUser }).user = user;
      return true;
    } catch {
      throw new UnauthorizedException('token inválido ou expirado');
    }
  }
}

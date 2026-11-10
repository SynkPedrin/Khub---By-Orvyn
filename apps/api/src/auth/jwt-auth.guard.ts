import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { IS_PUBLIC, type AuthUser } from './decorators';
import { PrismaService } from '../prisma/prisma.service';

/** Prefixo das Private Integrations (chaves de API do tenant). */
export const API_KEY_PREFIX = 'orv_live_';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Guard global: exige JWT válido, exceto rotas @Public(). Deriva o tenant do
 *  token (invariante 3 — nunca de header do browser). Além do JWT, aceita
 *  Private Integrations: `X-API-Key: orv_live_…` ou `Authorization: Bearer orv_live_…`,
 *  cujo tenant vem do banco (função SECURITY DEFINER), nunca de header. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;

    // ---- Private Integration (API key) ----
    const headerKey = (req.headers['x-api-key'] as string | undefined)?.trim();
    const bearer = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const rawKey = headerKey?.startsWith(API_KEY_PREFIX) ? headerKey : bearer?.startsWith(API_KEY_PREFIX) ? bearer : undefined;
    if (rawKey) {
      const rows = await this.prisma.$queryRawUnsafe<{ tenant_id: string; key_id: string }[]>(
        'SELECT tenant_id, key_id FROM auth_lookup_api_key($1)', sha256(rawKey),
      );
      if (!rows.length) throw new UnauthorizedException('API key inválida ou revogada');
      // identityId = UUID da própria chave (válido para colunas uuid: created_by,
      // audit actor_id). role 'api' distingue de humano; e-mail é rótulo.
      const key = await this.prisma.withTenant(rows[0].tenant_id, tx => tx.apiKey.findFirst({
        where: { id: rows[0].key_id, tenantId: rows[0].tenant_id, revokedAt: null }, select: { scopes: true },
      }));
      if (!key) throw new UnauthorizedException('API key inválida ou revogada');
      const user: AuthUser = { identityId: rows[0].key_id, tenantId: rows[0].tenant_id, role: 'api', email: 'api-key', scopes: key.scopes };
      (req as Request & { user: AuthUser }).user = user;
      return true;
    }

    if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException('token ausente');

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; tenant_id: string; role: string; email: string; typ?: string }>(auth.slice(7));
      // Ticket de socket é assinado com o mesmo segredo, mas NÃO abre a API REST
      // (ADR-0011): ele é curto e trafega na URL/handshake, superfície mais exposta.
      if (payload.typ === 'ws') throw new Error('ticket de socket não vale como access token');
      if (!payload.sub || !payload.tenant_id) throw new Error('token sem identidade');
      const membership = await this.prisma.membership.findUnique({
        where: { identityId_tenantId: { identityId: payload.sub, tenantId: payload.tenant_id } },
      });
      const tenant = await this.prisma.tenant.findUnique({ where: { id: payload.tenant_id }, select: { status: true } });
      if (!membership || tenant?.status !== 'active') throw new Error('vínculo revogado');
      const user: AuthUser = { identityId: payload.sub, tenantId: payload.tenant_id, role: membership.role, email: payload.email };
      (req as Request & { user: AuthUser }).user = user;
      return true;
    } catch {
      throw new UnauthorizedException('token inválido ou expirado');
    }
  }
}

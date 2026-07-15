import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';

export interface AccessClaims {
  sub: string; // identityId
  tenant_id: string;
  role: string;
  email: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  signAccess(claims: AccessClaims): string {
    return this.jwt.sign(claims);
  }

  /** Cria refresh token opaco, guarda só o hash. Retorna o token cru. */
  async issueRefresh(identityId: string, tenantId: string, userAgent?: string): Promise<string> {
    const raw = randomBytes(48).toString('base64url');
    const days = Number(process.env.REFRESH_TTL_DAYS ?? 30);
    await this.prisma.refreshToken.create({
      data: { identityId, tenantId, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + days * 86400000), userAgent: userAgent ?? null },
    });
    return raw;
  }

  /** Rotação: revoga o token usado e emite um novo (defesa contra replay). */
  async rotate(rawToken: string, userAgent?: string): Promise<{ raw: string; identityId: string; tenantId: string }> {
    const rec = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) } });
    if (!rec || rec.revokedAt || rec.expiresAt < new Date()) throw new UnauthorizedException('refresh inválido ou expirado');
    await this.prisma.refreshToken.update({ where: { id: rec.id }, data: { revokedAt: new Date() } });
    const tenantId = rec.tenantId ?? '';
    const raw = await this.issueRefresh(rec.identityId, tenantId, userAgent);
    return { raw, identityId: rec.identityId, tenantId };
  }

  async revoke(rawToken: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha256(rawToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForIdentity(identityId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { identityId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}

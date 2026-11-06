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

/** Marca o JWT como "só serve para abrir socket". */
const WS_TYP = 'ws';
/** Vida curta: o ticket só precisa sobreviver ao handshake. */
const WS_TICKET_TTL = '60s';

@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  signAccess(claims: AccessClaims): string {
    return this.jwt.sign(claims);
  }

  /**
   * Ticket de WebSocket (ADR-0011). O access token mora em cookie **httpOnly** —
   * o JS do browser não o alcança, e é bom que seja assim. Então o front pede um
   * ticket curto pelo servidor e usa só ele no handshake: se vazar, expira em
   * segundos e não abre a API REST (`typ:'ws'` é recusado pelo guard HTTP).
   */
  signWsTicket(claims: AccessClaims): string {
    return this.jwt.sign({ ...claims, typ: WS_TYP }, { expiresIn: WS_TICKET_TTL });
  }

  /** Valida o ticket do handshake. Access token comum NÃO serve (typ ausente). */
  verifyWsTicket(ticket: string): AccessClaims {
    let payload: AccessClaims & { typ?: string };
    try {
      payload = this.jwt.verify(ticket);
    } catch {
      throw new UnauthorizedException('ticket de socket inválido ou expirado');
    }
    if (payload.typ !== WS_TYP) throw new UnauthorizedException('ticket de socket inválido');
    if (!payload.sub || !payload.tenant_id) throw new UnauthorizedException('ticket sem identidade/tenant');
    return { sub: payload.sub, tenant_id: payload.tenant_id, role: payload.role, email: payload.email };
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
    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: rec.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() },
    });
    if (claimed.count !== 1) throw new UnauthorizedException('refresh já utilizado');
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

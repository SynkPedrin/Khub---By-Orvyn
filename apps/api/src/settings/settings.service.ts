import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidade: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, ${entidade}, ${entidadeId ?? null})`;
}

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async profile(tenantId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { identityId }, select: { id: true, nome: true, email: true, role: true, idioma: true, prefs: true } });
      if (!u) throw new NotFoundException('perfil não encontrado');
      return u;
    });
  }

  async updateProfile(tenantId: string, identityId: string, dto: { nome?: string; idioma?: string; prefs?: Record<string, unknown> }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { identityId }, select: { id: true, prefs: true } });
      if (!u) throw new NotFoundException('perfil não encontrado');
      const prefs = dto.prefs ? ({ ...(u.prefs as object), ...dto.prefs } as Prisma.InputJsonValue) : undefined;
      await tx.user.update({ where: { id: u.id }, data: { nome: dto.nome ?? undefined, idioma: dto.idioma ?? undefined, prefs } });
      await audit(tx, tenantId, identityId, 'profile.update', 'user', u.id);
      return { ok: true };
    });
  }

  async business(tenantId: string) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, endereco: true, telefone: true, website: true, idioma: true, nicho: true, plano: true, status: true } }),
    );
  }

  async updateBusiness(tenantId: string, identityId: string, dto: { nome?: string; endereco?: string; telefone?: string; website?: string; idioma?: string; nicho?: string }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { nome: dto.nome ?? undefined, endereco: dto.endereco ?? undefined, telefone: dto.telefone ?? undefined, website: dto.website ?? undefined, idioma: dto.idioma ?? undefined, nicho: dto.nicho ?? undefined, updatedAt: new Date() } });
      await audit(tx, tenantId, identityId, 'business.update', 'tenant', tenantId);
      return { ok: true };
    });
  }

  async members(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const members = await tx.$queryRaw<any[]>`
        SELECT m.identity_id AS "identityId", m.role, m.is_default AS "isDefault", i.email, u.nome, u.idioma
        FROM memberships m JOIN identities i ON i.id = m.identity_id
        LEFT JOIN users u ON u.identity_id = m.identity_id AND u.tenant_id = ${tenantId}::uuid
        WHERE m.tenant_id = ${tenantId}::uuid ORDER BY m.created_at`;
      const invites = await tx.$queryRaw<any[]>`
        SELECT id, email, role, expires_at AS "expiresAt", created_at AS "createdAt"
        FROM invites WHERE tenant_id = ${tenantId}::uuid AND accepted_at IS NULL ORDER BY created_at DESC`;
      return { members, invites };
    });
  }

  async createInvite(tenantId: string, identityId: string, email: string, role: string) {
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('e-mail inválido');
    const raw = randomBytes(24).toString('base64url');
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.invite.create({ data: { tenantId, email, role: role || 'member', tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      await audit(tx, tenantId, identityId, 'invite.create', 'invite', email);
    });
    const acceptUrl = `${process.env.WEB_URL ?? 'http://localhost:3210'}/signup?invite=${raw}`;
    // Envio por e-mail fica atrás de credencial real (Gmail OAuth2 / SMTP). API key não envia.
    const emailSent = false;
    return { ok: true, acceptUrl, emailSent };
  }

  async revokeInvite(tenantId: string, identityId: string, id: string) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.invite.deleteMany({ where: { id, tenantId } });
      await audit(tx, tenantId, identityId, 'invite.revoke', 'invite', id);
    });
    return { ok: true };
  }

  async changeRole(tenantId: string, identityId: string, targetIdentityId: string, role: string) {
    if (!['owner', 'admin', 'member', 'viewer'].includes(role)) throw new BadRequestException('papel inválido');
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$executeRaw`UPDATE memberships SET role = ${role} WHERE tenant_id = ${tenantId}::uuid AND identity_id = ${targetIdentityId}::uuid`;
      await audit(tx, tenantId, identityId, 'member.role', 'membership', targetIdentityId);
    });
    return { ok: true };
  }

  async auditLogs(tenantId: string, limit = 100) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({ orderBy: { ts: 'desc' }, take: Math.min(Math.max(limit, 1), 200), select: { id: true, actorType: true, actorId: true, acao: true, entidade: true, entidadeId: true, ts: true } }),
    );
  }
}

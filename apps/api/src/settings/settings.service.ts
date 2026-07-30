import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { Prisma } from '@prisma/client';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export interface NotificationItem {
  id: string;
  tipo: 'mensagem' | 'integracao';
  titulo: string;
  detalhe: string;
  url: string;
  ts: string;
  novo: boolean;
}
export interface Notifications {
  items: NotificationItem[];
  naoLidas: number;
}

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidade: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, ${entidade}, ${entidadeId ?? null})`;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
  ) {}

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
    const empresa = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.invite.create({ data: { tenantId, email, role: role || 'member', tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      await audit(tx, tenantId, identityId, 'invite.create', 'invite', email);
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true } });
      return t?.nome ?? 'Orvyn OS';
    });

    const acceptUrl = `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/signup?invite=${raw}`;
    // O convite JÁ existe: se o SMTP não estiver configurado, o link volta para
    // envio manual em vez de falhar a operação (gating — Brief §2).
    const mail = await this.mailer.send({
      to: email,
      subject: `Você foi convidado para ${empresa} no Orvyn OS`,
      text: `Você foi convidado para ${empresa} no Orvyn OS.\n\nAceite em: ${acceptUrl}\n\nO link expira em 7 dias e só pode ser usado uma vez.`,
      html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:520px;margin:0 auto;padding:24px">
        <h2 style="color:#6d28d9;margin:0 0 8px">Você foi convidado para ${escapeHtml(empresa)}</h2>
        <p style="color:#475569;line-height:1.6">Sua conta no <strong>Orvyn OS</strong> está a um clique. O link expira em 7 dias e só pode ser usado uma vez.</p>
        <p style="margin:24px 0"><a href="${acceptUrl}" style="background:#6d28d9;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Aceitar convite</a></p>
        <p style="color:#94a3b8;font-size:12px">Se o botão não funcionar, copie: ${acceptUrl}</p>
      </div>`,
    });
    return { ok: true, acceptUrl, emailSent: mail.sent, missing: mail.missing, erro: mail.erro };
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

  /**
   * Notificações (S0-5) derivadas do estado REAL do tenant — nada de tabela
   * paralela para sincronizar: conversa com mensagem não lida e integração
   * quebrada já são a verdade. O "lido" mora em `users.prefs.notifsSeenAt`.
   */
  async notifications(tenantId: string, identityId: string): Promise<Notifications> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { identityId }, select: { prefs: true } });
      const seen = new Date(((u?.prefs as Record<string, unknown>)?.notifsSeenAt as string) ?? 0);

      const [convs, integs] = await Promise.all([
        tx.conversation.findMany({
          where: { naoLidas: { gt: 0 } },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { id: true, nome: true, ultimaPrevia: true, naoLidas: true, updatedAt: true },
        }),
        tx.integration.findMany({
          where: { OR: [{ status: 'error' }, { health: 'down' }] },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { id: true, provider: true, erro: true, updatedAt: true },
        }),
      ]);

      const items: NotificationItem[] = [
        ...convs.map((c) => ({
          id: `conv:${c.id}`,
          tipo: 'mensagem' as const,
          titulo: `${c.naoLidas} nova${c.naoLidas > 1 ? 's' : ''} de ${c.nome}`,
          detalhe: c.ultimaPrevia ?? '',
          url: `/inbox?c=${c.id}`,
          ts: c.updatedAt.toISOString(),
          novo: c.updatedAt > seen,
        })),
        ...integs.map((i) => ({
          id: `int:${i.id}`,
          tipo: 'integracao' as const,
          titulo: `${i.provider} precisa de atenção`,
          detalhe: i.erro ?? 'conexão degradada',
          url: '/configuracoes?tab=integracoes',
          ts: i.updatedAt.toISOString(),
          novo: i.updatedAt > seen,
        })),
      ].sort((a, b) => b.ts.localeCompare(a.ts));

      return { items, naoLidas: items.filter((i) => i.novo).length };
    });
  }

  async markNotificationsRead(tenantId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { identityId }, select: { id: true, prefs: true } });
      if (!u) throw new NotFoundException('perfil não encontrado');
      const prefs = { ...(u.prefs as object), notifsSeenAt: new Date().toISOString() } as Prisma.InputJsonValue;
      await tx.user.update({ where: { id: u.id }, data: { prefs } });
      return { ok: true };
    });
  }

  async auditLogs(tenantId: string, limit = 100) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({ orderBy: { ts: 'desc' }, take: Math.min(Math.max(limit, 1), 200), select: { id: true, actorType: true, actorId: true, acao: true, entidade: true, entidadeId: true, ts: true } }),
    );
  }
}

import { parsePreferences } from './account-preferences';
import { invitationEmail } from '../common/invite-email';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { Prisma } from '@prisma/client';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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
      tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true, endereco: true, telefone: true, website: true, idioma: true, nicho: true, plano: true, status: true, settings: true } }),
    );
  }

  async updateBusiness(tenantId: string, identityId: string, dto: { nome?: string; endereco?: string; telefone?: string; website?: string; idioma?: string; nicho?: string; settings?: Record<string, unknown> }) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      await tx.tenant.update({ where: { id: tenantId }, data: { settings: dto.settings ? parsePreferences(dto.settings) : undefined, nome: dto.nome ?? undefined, endereco: dto.endereco ?? undefined, telefone: dto.telefone ?? undefined, website: dto.website ?? undefined, idioma: dto.idioma ?? undefined, nicho: dto.nicho ?? undefined, updatedAt: new Date() } });
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
    email = email.trim().toLowerCase();
    if (!['owner','admin','manager','member','viewer'].includes(role)) throw new BadRequestException('papel inválido');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('e-mail inválido');
    const actor = await this.prisma.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } } });
    if (!actor || !['owner', 'admin'].includes(actor.role) || (role === 'owner' && actor.role !== 'owner')) throw new ForbiddenException('permissão insuficiente');
    const raw = randomBytes(24).toString('base64url');
    const empresa = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      if (await tx.user.findFirst({ where: { tenantId, email: { equals: email, mode: 'insensitive' } } })) throw new ConflictException('Este usuário já faz parte da operação.');
      if (await tx.invite.findFirst({ where: { tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } } })) throw new ConflictException('Já existe um convite pendente. Revogue-o antes de enviar outro.');
      await tx.invite.create({ data: { tenantId, email, role: role || 'member', tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      await audit(tx, tenantId, identityId, 'invite.create', 'invite', email);
      const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true } });
      return t?.nome ?? 'KHUB';
    });

    const acceptUrl = `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/signup?invite=${raw}`;
    // O convite JÁ existe: se o SMTP não estiver configurado, o link volta para
    // envio manual em vez de falhar a operação (gating — Brief §2).
    const mail = await this.mailer.send({
      to: email,
      ...invitationEmail(empresa, acceptUrl, this.config.get('WEB_URL') ?? 'http://localhost:3210'),
      idempotencyKey: `invite/${sha256(raw)}`,
    });
    return { ok: true, acceptUrl, emailSent: mail.sent, missing: mail.missing, erro: mail.erro };
  }

  emailStatus() { return this.mailer.status(); }

  async revokeInvite(tenantId: string, identityId: string, id: string) {
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.invite.deleteMany({ where: { id, tenantId } });
      await audit(tx, tenantId, identityId, 'invite.revoke', 'invite', id);
    });
    return { ok: true };
  }

  async changeRole(tenantId: string, identityId: string, targetIdentityId: string, role: string) {
    if (!['owner', 'admin', 'manager', 'member', 'viewer'].includes(role)) throw new BadRequestException('papel inválido');
    await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const actor = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } } });
      const target = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId: targetIdentityId, tenantId } } });
      if (!target) throw new NotFoundException('membro inexistente');
      if (!actor || !['owner', 'admin'].includes(actor.role) || ((role === 'owner' || target.role === 'owner') && actor.role !== 'owner')) throw new ForbiddenException('permissão insuficiente');
      if (target.role === 'owner' && role !== 'owner' && await tx.membership.count({ where: { tenantId, role: 'owner' } }) <= 1) throw new BadRequestException('a organização precisa manter um proprietário');
      await tx.membership.update({ where: { identityId_tenantId: { identityId: targetIdentityId, tenantId } }, data: { role } });
      await tx.user.updateMany({ where: { tenantId, identityId: targetIdentityId }, data: { role } });
      await audit(tx, tenantId, identityId, 'member.role', 'membership', targetIdentityId);
    });
    return { ok: true };
  }

  /**
   * Remove um membro da equipe (SEC-01 · ADR-0042). O acesso cai NA HORA: o
   * JwtAuthGuard confere a membership a cada requisição, então apagar o vínculo
   * derruba até o access token de 15 min ainda válido; as sessões (refresh) do
   * tenant são revogadas para o próximo refresh também falhar. Conversas abertas
   * que estavam com a pessoa voltam para a fila (sem responsável). Histórico
   * (mensagens enviadas, auditoria) é preservado.
   */
  async removeMember(tenantId: string, identityId: string, targetIdentityId: string) {
    if (targetIdentityId === identityId) throw new BadRequestException('você não pode remover a si mesmo; peça a outro administrador');
    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      const actor = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } } });
      const target = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId: targetIdentityId, tenantId } } });
      if (!target) throw new NotFoundException('membro inexistente');
      if (!actor || !['owner', 'admin'].includes(actor.role) || (target.role === 'owner' && actor.role !== 'owner')) throw new ForbiddenException('permissão insuficiente');
      if (target.role === 'owner' && await tx.membership.count({ where: { tenantId, role: 'owner' } }) <= 1) throw new BadRequestException('a organização precisa manter um proprietário');
      const ident = await tx.identity.findUnique({ where: { id: targetIdentityId }, select: { email: true } });
      await tx.membership.delete({ where: { identityId_tenantId: { identityId: targetIdentityId, tenantId } } });
      await tx.user.deleteMany({ where: { tenantId, identityId: targetIdentityId } });
      const sessoes = await tx.refreshToken.updateMany({ where: { identityId: targetIdentityId, tenantId, revokedAt: null }, data: { revokedAt: new Date() } });
      const conversas = await tx.conversation.updateMany({ where: { assigneeId: targetIdentityId }, data: { assigneeId: null } });
      if (ident?.email) await tx.invite.deleteMany({ where: { tenantId, email: { equals: ident.email, mode: 'insensitive' }, acceptedAt: null } });
      // O tenant padrão de quem saiu passa a ser outro vínculo dele (se houver).
      if (target.isDefault) {
        const outro = await tx.membership.findFirst({ where: { identityId: targetIdentityId }, orderBy: { createdAt: 'asc' } });
        if (outro) await tx.membership.update({ where: { id: outro.id }, data: { isDefault: true } });
      }
      await audit(tx, tenantId, identityId, 'member.remove', 'membership', targetIdentityId);
      return { sessoesRevogadas: sessoes.count, conversasLiberadas: conversas.count };
    });
    return { ok: true, ...r };
  }

  /** "Sair de todos os dispositivos": revoga TODAS as sessões da própria identidade. */
  async revokeMySessions(tenantId: string, identityId: string) {
    const r = await this.prisma.refreshToken.updateMany({ where: { identityId, revokedAt: null }, data: { revokedAt: new Date() } });
    await this.prisma.withTenant(tenantId, (tx) => audit(tx, tenantId, identityId, 'sessions.revoke_all', 'identity', identityId));
    return { ok: true, sessoesRevogadas: r.count };
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

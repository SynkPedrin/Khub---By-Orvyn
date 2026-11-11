import { parsePreferences } from './account-preferences';
import { invitationEmail } from '../common/invite-email';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { Prisma } from '@prisma/client';
import { ID_NOTIFICACAO, lidasDasPrefs, montarNotificacoes, registrarLida, type Derivada, type NotificationItem } from './notificacoes';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export type { NotificationItem } from './notificacoes';
export interface Notifications {
  items: NotificationItem[];
  naoLidas: number;
}

async function audit(tx: Prisma.TransactionClient, tenantId: string, actorId: string, acao: string, entidade: string, entidadeId?: string) {
  await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
    VALUES (${tenantId}::uuid, 'humano', ${actorId}, ${acao}, ${entidade}, ${entidadeId ?? null})`;
}

export interface DadosConvite {
  nome?: string | null;
  mensagem?: string | null;
  telefone?: string | null;
}

/** "(11) 99999-0000" → "5511999990000" (wa.me exige DDI). Vazio → null. Inválido → 400. */
export function normalizarTelefone(t?: string | null): string | null {
  const d = (t ?? '').replace(/\D/g, '');
  if (!d) return null;
  const n = d.length <= 11 ? `55${d}` : d;
  if (n.length < 12 || n.length > 15) throw new BadRequestException('telefone inválido para WhatsApp (use DDD + número)');
  return n;
}

/** Mensagem pronta para colar no WhatsApp (sem markdown que o WhatsApp não entende). */
export function textoConviteWhatsApp(p: { empresa: string; acceptUrl: string; email: string; convidado: string | null; remetente: string | null; mensagem: string | null }): string {
  return [
    p.convidado ? `Oi, ${p.convidado}!` : 'Oi!',
    '',
    `${p.remetente ? `${p.remetente} liberou` : 'Liberamos'} o seu acesso ao KHUB da *${p.empresa}*.`,
    ...(p.mensagem ? ['', p.mensagem] : []),
    '',
    'Para entrar, abra o link abaixo e crie a sua senha:',
    p.acceptUrl,
    '',
    `Seu login será o e-mail ${p.email}. O link vale por 7 dias e só funciona uma vez.`,
  ].join('\n');
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

  async createInvite(tenantId: string, identityId: string, email: string, role: string, extra: DadosConvite = {}) {
    email = email.trim().toLowerCase();
    if (!['owner','admin','manager','member','viewer'].includes(role)) throw new BadRequestException('papel inválido');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadRequestException('e-mail inválido');
    const telefone = normalizarTelefone(extra.telefone);
    const actor = await this.prisma.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } } });
    if (!actor || !['owner', 'admin'].includes(actor.role) || (role === 'owner' && actor.role !== 'owner')) throw new ForbiddenException('permissão insuficiente');
    const raw = randomBytes(24).toString('base64url');
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => {
      await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;
      if (await tx.user.findFirst({ where: { tenantId, email: { equals: email, mode: 'insensitive' } } })) throw new ConflictException('Este usuário já faz parte da operação.');
      if (await tx.invite.findFirst({ where: { tenantId, email, acceptedAt: null, expiresAt: { gt: new Date() } } })) throw new ConflictException('Já existe um convite pendente para este e-mail. Use "Gerar novo link" nele ou revogue antes.');
      // Convite expirado para o mesmo e-mail sai: o novo o substitui.
      await tx.invite.deleteMany({ where: { tenantId, email, acceptedAt: null, expiresAt: { lte: new Date() } } });
      const inv = await tx.invite.create({ data: { tenantId, email, role: role || 'member', tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      await audit(tx, tenantId, identityId, 'invite.create', 'invite', inv.id);
      return { inviteId: inv.id, ...(await this.contextoConvite(tx, tenantId, identityId)) };
    });
    return { ok: true, inviteId: ctx.inviteId, ...(await this.entregarConvite(email, raw, ctx.empresa, { ...extra, remetente: ctx.remetente, telefone })) };
  }

  /**
   * "Gerar novo link": o token cru nunca é guardado (só o hash), então para
   * recopiar o link ou reenviar o e-mail o convite ganha um token NOVO e
   * mais 7 dias; o link anterior deixa de valer na hora.
   */
  async resendInvite(tenantId: string, identityId: string, id: string, extra: DadosConvite = {}) {
    const telefone = normalizarTelefone(extra.telefone);
    const actor = await this.prisma.membership.findUnique({ where: { identityId_tenantId: { identityId, tenantId } } });
    if (!actor || !['owner', 'admin'].includes(actor.role)) throw new ForbiddenException('permissão insuficiente');
    const raw = randomBytes(24).toString('base64url');
    const ctx = await this.prisma.withTenant(tenantId, async (tx) => {
      const inv = await tx.invite.findFirst({ where: { id, tenantId, acceptedAt: null } });
      if (!inv) throw new NotFoundException('convite não encontrado ou já aceito');
      if (inv.role === 'owner' && actor.role !== 'owner') throw new ForbiddenException('permissão insuficiente');
      await tx.invite.update({ where: { id }, data: { tokenHash: sha256(raw), expiresAt: new Date(Date.now() + 7 * 86400000) } });
      await audit(tx, tenantId, identityId, 'invite.resend', 'invite', id);
      return { email: inv.email, ...(await this.contextoConvite(tx, tenantId, identityId)) };
    });
    return { ok: true, inviteId: id, ...(await this.entregarConvite(ctx.email, raw, ctx.empresa, { ...extra, remetente: ctx.remetente, telefone })) };
  }

  private async contextoConvite(tx: Prisma.TransactionClient, tenantId: string, identityId: string) {
    const [t, u] = await Promise.all([
      tx.tenant.findUnique({ where: { id: tenantId }, select: { nome: true } }),
      tx.user.findFirst({ where: { identityId }, select: { nome: true } }),
    ]);
    return { empresa: t?.nome ?? 'KHUB', remetente: u?.nome ?? null };
  }

  /** Envia o e-mail (se configurado) e monta o texto pronto para WhatsApp. O convite já existe: e-mail fora do ar não desfaz nada. */
  private async entregarConvite(email: string, raw: string, empresa: string, p: DadosConvite & { remetente: string | null; telefone: string | null }) {
    const web = (this.config.get('WEB_URL') ?? 'http://localhost:3210').replace(/\/$/, '');
    const acceptUrl = `${web}/signup?invite=${raw}`;
    const convidado = p.nome?.trim() || null;
    const mensagem = p.mensagem?.trim() || null;
    const mail = await this.mailer.send({
      to: email,
      ...invitationEmail(empresa, acceptUrl, web, false, { convidado, remetente: p.remetente, mensagem }),
      idempotencyKey: `invite/${sha256(raw)}`,
    });
    const whatsappTexto = textoConviteWhatsApp({ empresa, acceptUrl, email, convidado, remetente: p.remetente, mensagem });
    return {
      acceptUrl,
      email,
      emailSent: mail.sent,
      missing: mail.missing,
      erro: mail.erro,
      whatsappTexto,
      whatsappUrl: `https://wa.me/${p.telefone ?? ''}?text=${encodeURIComponent(whatsappTexto)}`,
      linkPublico: /^https:\/\//.test(web),
    };
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
   * quebrada já são a verdade. O "lido" mora em `users.prefs.notifsSeenAt`
   * (todas) e `prefs.notifsLidas` (por item). Q2.6: soma as PERSISTIDAS do
   * próprio membro (`notifications`, @menção — db/055), lidas por `lida_em`.
   */
  async notifications(tenantId: string, identityId: string): Promise<Notifications> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { identityId }, select: { prefs: true } });
      const seen = new Date(((u?.prefs as Record<string, unknown>)?.notifsSeenAt as string) ?? 0);

      const [convs, integs, persistidas] = await Promise.all([
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
        tx.notification.findMany({
          where: { identityId },
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, tipo: true, titulo: true, detalhe: true, url: true, createdAt: true, lidaEm: true },
        }),
      ]);

      const derivadas: Derivada[] = [
        ...convs.map((c) => ({
          id: `conv:${c.id}`,
          tipo: 'mensagem' as const,
          titulo: `${c.naoLidas} nova${c.naoLidas > 1 ? 's' : ''} de ${c.nome}`,
          detalhe: c.ultimaPrevia ?? '',
          url: `/inbox?c=${c.id}`,
          ts: c.updatedAt.toISOString(),
        })),
        ...integs.map((i) => ({
          id: `int:${i.id}`,
          tipo: 'integracao' as const,
          titulo: `${i.provider} precisa de atenção`,
          detalhe: i.erro ?? 'conexão degradada',
          url: '/configuracoes?tab=integracoes',
          ts: i.updatedAt.toISOString(),
        })),
      ];

      return montarNotificacoes(derivadas, persistidas, seen, lidasDasPrefs(u?.prefs));
    });
  }

  async markNotificationsRead(tenantId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const u = await tx.user.findFirst({ where: { identityId }, select: { id: true, prefs: true } });
      if (!u) throw new NotFoundException('perfil não encontrado');
      const prefs = { ...(u.prefs as object), notifsSeenAt: new Date().toISOString() } as Prisma.InputJsonValue;
      await tx.user.update({ where: { id: u.id }, data: { prefs } });
      await tx.notification.updateMany({ where: { identityId, lidaEm: null }, data: { lidaEm: new Date() } });
      return { ok: true };
    });
  }

  /** Marca UMA notificação como lida (Q2.6). `men:` é persistida; as demais, derivadas. */
  async markNotificationRead(tenantId: string, identityId: string, id: string) {
    if (!ID_NOTIFICACAO.test(id)) throw new BadRequestException('notificação inválida');
    return this.prisma.withTenant(tenantId, async (tx) => {
      if (id.startsWith('men:')) {
        // Filtra pelo destinatário: ninguém marca a notificação de outro membro.
        const r = await tx.notification.updateMany({ where: { id: id.slice(4), identityId, lidaEm: null }, data: { lidaEm: new Date() } });
        return { ok: true, atualizada: r.count > 0 };
      }
      const u = await tx.user.findFirst({ where: { identityId }, select: { id: true, prefs: true } });
      if (!u) throw new NotFoundException('perfil não encontrado');
      const notifsLidas = registrarLida(lidasDasPrefs(u.prefs), id, new Date().toISOString());
      await tx.user.update({ where: { id: u.id }, data: { prefs: { ...(u.prefs as object), notifsLidas } as Prisma.InputJsonValue } });
      return { ok: true, atualizada: true };
    });
  }

  async auditLogs(tenantId: string, limit = 100) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.auditLog.findMany({ orderBy: { ts: 'desc' }, take: Math.min(Math.max(limit, 1), 200), select: { id: true, actorType: true, actorId: true, acao: true, entidade: true, entidadeId: true, ts: true } }),
    );
  }
}

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { MailerService } from '../common/mailer.service';
import { RedisService } from '../common/redis.service';
import { passwordResetEmail } from '../common/password-reset-email';
import { TokenService } from './token.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** Validade do link de redefinição. Curta: o link vive na caixa de e-mail. */
export const RESET_TTL_MIN = 60;
/** No máximo N pedidos por e-mail por hora (evita usar o KHUB para spam). */
export const RESET_MAX_POR_HORA = 3;

/**
 * "Esqueci minha senha" self-service (ADR-0042).
 *
 * Garantias:
 *  - resposta IDÊNTICA para e-mail existente ou não (sem enumeração de conta);
 *  - só o hash do token é guardado; uso único; expira em 60 min;
 *  - pedir um link novo invalida os anteriores;
 *  - redefinir revoga TODAS as sessões da identidade (quem roubou a sessão cai);
 *  - conta só OAuth (sem senha) também pode definir uma senha por aqui — o
 *    e-mail verificado é a prova de posse.
 */
@Injectable()
export class PasswordResetService {
  private readonly log = new Logger('PasswordReset');

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mailer: MailerService,
    private readonly redis: RedisService,
    private readonly tokens: TokenService,
  ) {}

  /** A tela de login mostra o fluxo por e-mail só se o envio estiver configurado. */
  disponivel() {
    return { disponivel: this.mailer.configured() };
  }

  async solicitar(emailBruto: string): Promise<{ ok: true }> {
    const email = emailBruto.trim().toLowerCase();
    const n = await this.redis.incrWithTtl(`pwdreset:${sha256(email)}`, 3600);
    if (n !== null && n > RESET_MAX_POR_HORA) {
      this.log.warn('pedido de redefinição acima do limite por e-mail (ignorado)');
      return { ok: true };
    }
    const identity = await this.prisma.identity.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true, email: true } });
    if (!identity) return { ok: true };

    const raw = randomBytes(32).toString('base64url');
    await this.prisma.$transaction([
      this.prisma.passwordResetToken.updateMany({ where: { identityId: identity.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({ data: { identityId: identity.id, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000) } }),
    ]);

    const web = (this.config.get('WEB_URL') ?? 'http://localhost:3210').replace(/\/$/, '');
    const link = `${web}/redefinir-senha?token=${raw}`;
    const r = await this.mailer.send({ to: identity.email, ...passwordResetEmail(link, web, RESET_TTL_MIN), idempotencyKey: `pwdreset/${sha256(raw)}` });
    if (!r.sent) this.log.warn(`e-mail de redefinição não enviado${r.missing?.length ? ` (falta ${r.missing.join(', ')})` : ''}`);
    return { ok: true };
  }

  async redefinir(token: string, novaSenha: string): Promise<{ ok: true }> {
    if (novaSenha.length < 8) throw new BadRequestException('a senha precisa ter pelo menos 8 caracteres');
    const rec = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.usedAt || rec.expiresAt.getTime() < Date.now()) throw new BadRequestException('link inválido ou expirado. Peça um novo.');
    // Uso único mesmo sob corrida: só um update condicional vence.
    const claimed = await this.prisma.passwordResetToken.updateMany({ where: { id: rec.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new BadRequestException('link inválido ou expirado. Peça um novo.');

    await this.prisma.identity.update({ where: { id: rec.identityId }, data: { passwordHash: await hash(novaSenha), emailVerifiedAt: new Date(), updatedAt: new Date() } });
    await this.tokens.revokeAllForIdentity(rec.identityId);
    const vinculos = await this.prisma.membership.findMany({ where: { identityId: rec.identityId }, select: { tenantId: true } });
    for (const v of vinculos) {
      await this.prisma
        .withTenant(v.tenantId, (tx) => tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${v.tenantId}::uuid, 'humano', ${rec.identityId}, 'password.reset', 'identity', ${rec.identityId})`)
        .catch(() => undefined); // auditoria nunca impede a redefinição
    }
    return { ok: true };
  }
}

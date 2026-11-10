import { createHash } from 'node:crypto';
import { verify } from '@node-rs/argon2';
import { PasswordResetService, RESET_MAX_POR_HORA } from './password-reset.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '../config/config.service';
import type { MailerService } from '../common/mailer.service';
import type { RedisService } from '../common/redis.service';
import type { TokenService } from './token.service';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function ambiente(o: { existe?: boolean; contador?: number | null } = {}) {
  const tokens: { id: string; identityId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null }[] = [];
  const identidade = { id: 'id1', email: 'dono@studio.com', passwordHash: 'antigo' as string | null };
  const prisma = {
    identity: {
      findFirst: jest.fn(async () => (o.existe === false ? null : { id: identidade.id, email: identidade.email })),
      update: jest.fn(async ({ data }: { data: { passwordHash: string } }) => { identidade.passwordHash = data.passwordHash; return identidade; }),
    },
    passwordResetToken: {
      updateMany: jest.fn(async ({ where, data }: { where: { id?: string; identityId?: string; usedAt: null }; data: { usedAt: Date } }) => {
        let n = 0;
        for (const t of tokens) if (!t.usedAt && (where.id ? t.id === where.id && t.expiresAt > new Date() : t.identityId === where.identityId)) { t.usedAt = data.usedAt; n++; }
        return { count: n };
      }),
      create: jest.fn(async ({ data }: { data: { identityId: string; tokenHash: string; expiresAt: Date } }) => { tokens.push({ id: `t${tokens.length + 1}`, usedAt: null, ...data }); return tokens.at(-1); }),
      findUnique: jest.fn(async ({ where }: { where: { tokenHash: string } }) => tokens.find((t) => t.tokenHash === where.tokenHash) ?? null),
    },
    membership: { findMany: jest.fn(async () => [{ tenantId: '11111111-1111-1111-1111-111111111111' }]) },
    withTenant: jest.fn(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn({ $executeRaw: jest.fn(async () => 1) })),
    // $transaction([a, b]) do Prisma: as promises já foram disparadas, só aguarda.
    $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  } as unknown as PrismaService;
  const enviados: { to: string; text: string }[] = [];
  const mailer = { configured: () => true, send: jest.fn(async (m: { to: string; text: string }) => { enviados.push(m); return { sent: true }; }) } as unknown as MailerService;
  const config = { get: (k: string) => (k === 'WEB_URL' ? 'https://app.khub.test' : undefined) } as unknown as ConfigService;
  const redis = { incrWithTtl: jest.fn(async () => (o.contador === undefined ? 1 : o.contador)) } as unknown as RedisService;
  const tokenSvc = { revokeAllForIdentity: jest.fn(async () => undefined) } as unknown as TokenService;
  const svc = new PasswordResetService(prisma, config, mailer, redis, tokenSvc);
  const linkDo = () => new URL(/https:\/\/\S+/.exec(enviados.at(-1)!.text)![0]).searchParams.get('token')!;
  return { svc, tokens, enviados, identidade, tokenSvc, linkDo, mailer };
}

describe('PasswordResetService — esqueci minha senha (ADR-0042)', () => {
  it('e-mail inexistente recebe a MESMA resposta e nenhum e-mail sai (sem enumeração)', async () => {
    const a = ambiente({ existe: false });
    expect(await a.svc.solicitar('ninguem@x.com')).toEqual({ ok: true });
    expect(a.enviados).toHaveLength(0);
    expect(a.tokens).toHaveLength(0);
  });

  it('guarda só o hash; o link do e-mail leva o token cru com validade de 60 min', async () => {
    const a = ambiente();
    await a.svc.solicitar('Dono@Studio.com ');
    const cru = a.linkDo();
    expect(a.tokens[0].tokenHash).toBe(sha256(cru));
    expect(a.tokens[0].tokenHash).not.toContain(cru);
    expect(a.tokens[0].expiresAt.getTime() - Date.now()).toBeGreaterThan(59 * 60_000);
    expect(a.enviados[0].text).toContain('https://app.khub.test/redefinir-senha?token=');
  });

  it('pedir um link novo invalida os anteriores', async () => {
    const a = ambiente();
    await a.svc.solicitar('dono@studio.com');
    const primeiro = a.linkDo();
    await a.svc.solicitar('dono@studio.com');
    await expect(a.svc.redefinir(primeiro, 'senhaNova123')).rejects.toThrow('link inválido ou expirado');
  });

  it('redefine com hash argon2, é de uso único e encerra TODAS as sessões', async () => {
    const a = ambiente();
    await a.svc.solicitar('dono@studio.com');
    const cru = a.linkDo();
    expect(await a.svc.redefinir(cru, 'senhaNova123')).toEqual({ ok: true });
    expect(await verify(a.identidade.passwordHash!, 'senhaNova123')).toBe(true);
    expect(a.tokenSvc.revokeAllForIdentity).toHaveBeenCalledWith('id1');
    await expect(a.svc.redefinir(cru, 'outraSenha123')).rejects.toThrow('link inválido ou expirado');
  });

  it('link expirado é recusado', async () => {
    const a = ambiente();
    await a.svc.solicitar('dono@studio.com');
    a.tokens[0].expiresAt = new Date(Date.now() - 1000);
    await expect(a.svc.redefinir(a.linkDo(), 'senhaNova123')).rejects.toThrow('link inválido ou expirado');
  });

  it('senha curta é recusada antes de consumir o link', async () => {
    const a = ambiente();
    await a.svc.solicitar('dono@studio.com');
    await expect(a.svc.redefinir(a.linkDo(), '123')).rejects.toThrow('pelo menos 8');
    expect(a.tokens[0].usedAt).toBeNull();
  });

  it(`acima de ${RESET_MAX_POR_HORA} pedidos/hora para o mesmo e-mail: responde igual e não envia`, async () => {
    const a = ambiente({ contador: RESET_MAX_POR_HORA + 1 });
    expect(await a.svc.solicitar('dono@studio.com')).toEqual({ ok: true });
    expect(a.enviados).toHaveLength(0);
  });
});

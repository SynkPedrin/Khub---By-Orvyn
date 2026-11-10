import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { TokenService, type AccessClaims } from './token.service';
import type { PrismaService } from '../prisma/prisma.service';

const SEGREDO = 'segredo-de-teste-com-mais-de-16-chars';
const CLAIMS: AccessClaims = { sub: 'id-1', tenant_id: 't-1', role: 'owner', email: 'a@b.c' };
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Tabela de refresh_tokens em memória, com o mesmo contrato do Prisma. */
function fakePrisma(inicial: Record<string, unknown>[] = []) {
  const tokens = [...inicial];
  const prisma = {
    refreshToken: {
      create: jest.fn(async ({ data }: any) => { tokens.push({ id: `r${tokens.length}`, revokedAt: null, ...data }); return tokens[tokens.length - 1]; }),
      findUnique: jest.fn(async ({ where }: any) => tokens.find((t: any) => t.tokenHash === where.tokenHash) ?? null),
      update: jest.fn(async ({ where, data }: any) => { const t: any = tokens.find((x: any) => x.id === where.id); Object.assign(t, data); return t; }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let n = 0;
        for (const t of tokens as any[]) {
          const casa = (!where.tokenHash || t.tokenHash === where.tokenHash)
            && (!where.identityId || t.identityId === where.identityId)
            && (where.revokedAt === undefined || t.revokedAt === where.revokedAt);
          if (casa) { Object.assign(t, data); n++; }
        }
        return { count: n };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, tokens };
}

const svc = (prisma: PrismaService) => new TokenService(new JwtService({ secret: SEGREDO, signOptions: { expiresIn: '15m' } }), prisma);

describe('TokenService — ticket de WebSocket (ADR-0011)', () => {
  const t = svc(fakePrisma().prisma);

  it('ticket carrega as claims e volta a ser lido', () => {
    expect(t.verifyWsTicket(t.signWsTicket(CLAIMS))).toEqual(CLAIMS);
  });

  /**
   * O que separa ticket de access token: o `typ`. Sem esta checagem, um access
   * token roubado abriria socket — e um ticket (que trafega na URL do handshake,
   * superfície mais exposta) abriria a API REST inteira.
   */
  it('ACCESS TOKEN comum não vale como ticket', () => {
    expect(() => t.verifyWsTicket(t.signAccess(CLAIMS))).toThrow(UnauthorizedException);
  });

  it('ticket assinado com outro segredo é recusado', () => {
    const atacante = new JwtService({ secret: 'segredo-do-atacante-0000000000' });
    expect(() => t.verifyWsTicket(atacante.sign({ ...CLAIMS, typ: 'ws' }))).toThrow(/inválido|expirado/);
  });

  it('ticket expirado é recusado (a vida curta é a defesa)', () => {
    const jwt = new JwtService({ secret: SEGREDO });
    expect(() => t.verifyWsTicket(jwt.sign({ ...CLAIMS, typ: 'ws' }, { expiresIn: '-1s' }))).toThrow(UnauthorizedException);
  });

  it('ticket sem tenant é recusado — socket sem tenant não tem sala', () => {
    const jwt = new JwtService({ secret: SEGREDO });
    expect(() => t.verifyWsTicket(jwt.sign({ sub: 'x', typ: 'ws' }))).toThrow(/tenant/);
    expect(() => t.verifyWsTicket(jwt.sign({ tenant_id: 't', typ: 'ws' }))).toThrow(/identidade|tenant/);
  });

  it('lixo não derruba o serviço', () => {
    for (const v of ['', 'nao.e.jwt', 'a.b.c']) expect(() => t.verifyWsTicket(v)).toThrow(UnauthorizedException);
  });
});

describe('TokenService — refresh rotativo (defesa contra replay)', () => {
  it('guarda só o HASH: o token cru nunca vai para o banco', async () => {
    const f = fakePrisma();
    const raw = await svc(f.prisma).issueRefresh('id-1', 't-1');
    const salvo: any = f.tokens[0];
    expect(salvo.tokenHash).toBe(sha256(raw));
    expect(JSON.stringify(f.tokens)).not.toContain(raw); // vazou = comprometeu todo mundo
  });

  it('rotação revoga o usado e emite outro', async () => {
    const f = fakePrisma();
    const s = svc(f.prisma);
    const raw = await s.issueRefresh('id-1', 't-1');
    const novo = await s.rotate(raw);

    expect(novo.raw).not.toBe(raw);
    expect(novo.identityId).toBe('id-1');
    expect((f.tokens[0] as any).revokedAt).toBeTruthy(); // o antigo morreu
    expect(f.tokens).toHaveLength(2);
  });

  /** O ataque que a rotação existe para impedir: reusar um refresh já usado. */
  it('REPLAY: o mesmo refresh não pode ser usado duas vezes', async () => {
    const f = fakePrisma();
    const s = svc(f.prisma);
    const raw = await s.issueRefresh('id-1', 't-1');
    await s.rotate(raw);
    await expect(s.rotate(raw)).rejects.toThrow(/inválido|expirado/);
  });

  it('refresh expirado é recusado', async () => {
    const f = fakePrisma([{ id: 'r0', tokenHash: sha256('velho'), identityId: 'id-1', tenantId: 't-1', revokedAt: null, expiresAt: new Date(Date.now() - 1000) }]);
    await expect(svc(f.prisma).rotate('velho')).rejects.toThrow(/inválido|expirado/);
  });

  it('refresh inexistente é recusado (não cria sessão do nada)', async () => {
    await expect(svc(fakePrisma().prisma).rotate('nunca-existiu')).rejects.toThrow(UnauthorizedException);
  });

  it('a rotação mantém o tenant — não é caminho para trocar de conta', async () => {
    const f = fakePrisma();
    const s = svc(f.prisma);
    const novo = await s.rotate(await s.issueRefresh('id-1', 'tenant-A'));
    expect(novo.tenantId).toBe('tenant-A');
    expect((f.tokens[1] as any).tenantId).toBe('tenant-A');
  });

  it('logout revoga o token; revogar tudo derruba as sessões da identidade', async () => {
    const f = fakePrisma();
    const s = svc(f.prisma);
    const raw = await s.issueRefresh('id-1', 't-1');
    await s.issueRefresh('id-1', 't-1');
    await s.revoke(raw);
    expect((f.tokens[0] as any).revokedAt).toBeTruthy();

    await s.revokeAllForIdentity('id-1');
    expect((f.tokens as any[]).every((t) => t.revokedAt)).toBe(true);
  });
});

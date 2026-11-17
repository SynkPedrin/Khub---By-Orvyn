import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';
import { normalizarPagamento } from './caixa.service';
import { FinanceiroSenhaService, conferirHash, gerarHash } from './senha.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { ConfigService } from '../config/config.service';

const T = '11111111-1111-4111-8111-111111111111';
const U = '22222222-2222-4222-8222-222222222222';

function servico(hash: string | null) {
  let atual = hash;
  const tx = {
    financeiroConfig: {
      findUnique: jest.fn(async () => (atual ? { senhaHash: atual } : null)),
      upsert: jest.fn(async ({ create, update }: { create: { senhaHash: string }; update: { senhaHash: string } }) => { atual = (update ?? create).senhaHash; return {}; }),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, fn: (x: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  const config = { get: (k: string) => (k === 'JWT_SECRET' ? 'segredo-de-teste-com-tamanho' : undefined) } as unknown as ConfigService;
  return new FinanceiroSenhaService(prisma, config);
}

describe('caixa: forma de pagamento', () => {
  it('parcelas só no crédito (1x por padrão); nas outras somem', () => {
    expect(normalizarPagamento('credito', undefined)).toEqual({ formaPagamento: 'credito', parcelas: 1 });
    expect(normalizarPagamento('credito', 3)).toEqual({ formaPagamento: 'credito', parcelas: 3 });
    expect(normalizarPagamento('pix', 3)).toEqual({ formaPagamento: 'pix', parcelas: null });
    expect(normalizarPagamento(null, 2)).toEqual({ formaPagamento: null, parcelas: null });
    expect(() => normalizarPagamento('credito', 30)).toThrow(BadRequestException);
    expect(() => normalizarPagamento('cheque' as never, 1)).toThrow(BadRequestException);
  });
});

describe('senha do financeiro', () => {
  it('hash scrypt confere só a senha certa', async () => {
    const h = await gerarHash('@Senha123');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await conferirHash('@Senha123', h)).toBe(true);
    expect(await conferirHash('@senha123', h)).toBe(false);
  });

  it('sem senha configurada nada é bloqueado', async () => {
    await expect(servico(null).exigir(T, U, undefined)).resolves.toBeUndefined();
  });

  it('senha certa libera por 30 min, só para a mesma conta e pessoa', async () => {
    const s = servico(await gerarHash('@Senha123'));
    await expect(s.exigir(T, U, undefined)).rejects.toThrow(ForbiddenException);
    const agora = Date.now();
    const r = await s.verificar(T, U, '@Senha123', agora);
    expect(r.token).toBeTruthy();
    expect(s.tokenValido(r.token!, T, U, agora + 29 * 60_000)).toBe(true);
    expect(s.tokenValido(r.token!, T, U, agora + 31 * 60_000)).toBe(false);
    expect(s.tokenValido(r.token!, T, '33333333-3333-4333-8333-333333333333', agora)).toBe(false);
    expect(s.tokenValido(`${r.token!.split('.')[0]}.assinaturafalsa`, T, U, agora)).toBe(false);
    await expect(s.exigir(T, U, r.token!)).resolves.toBeUndefined();
  });

  it('senha errada recusa e trava depois de 6 tentativas', async () => {
    const s = servico(await gerarHash('@Senha123'));
    for (let i = 0; i < 6; i++) await expect(s.verificar(T, U, 'errada')).rejects.toThrow(ForbiddenException);
    await expect(s.verificar(T, U, '@Senha123')).rejects.toThrow(HttpException);
  });

  it('só dono/admin define; trocar exige a senha atual', async () => {
    const s = servico(null);
    await expect(s.definir(T, { identityId: U, role: 'member' }, { novaSenha: '1234' })).rejects.toThrow(ForbiddenException);
    await s.definir(T, { identityId: U, role: 'owner' }, { novaSenha: '@Senha123' });
    await expect(s.definir(T, { identityId: U, role: 'owner' }, { senhaAtual: 'errada', novaSenha: 'outra1' })).rejects.toThrow(ForbiddenException);
    await expect(s.definir(T, { identityId: U, role: 'owner' }, { senhaAtual: '@Senha123', novaSenha: 'outra1' })).resolves.toEqual({ ok: true });
  });
});

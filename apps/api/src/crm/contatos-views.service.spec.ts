import { ContatosViewsService, parseColunas } from './contatos-views.service';
import type { PrismaService } from '../prisma/prisma.service';

const T = '11111111-1111-1111-1111-111111111111';
const VID = '22222222-2222-4222-8222-222222222222';
const agora = new Date('2026-11-10T12:00:00Z');

function fake(dono = 'eu') {
  const criados: unknown[] = [];
  const tx = {
    contactView: {
      findMany: jest.fn(async (a: unknown) => { criados.push({ findMany: a }); return [{ id: VID, nome: 'VIPs', filtros: { tag: 'vip', lixo: 1 }, colunas: ['nome', 7], ordem: 'xx', compartilhada: true, ownerIdentityId: 'outro', createdAt: agora, updatedAt: agora }]; }),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { criados.push(data); return { id: VID, createdAt: agora, updatedAt: agora, ...data }; }),
      findUnique: jest.fn(async () => ({ ownerIdentityId: dono })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: VID, nome: 'x', filtros: {}, colunas: [], ordem: 'recentes', compartilhada: false, ownerIdentityId: dono, createdAt: agora, updatedAt: agora, ...data })),
      delete: jest.fn(async () => ({})),
    },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  return { svc: new ContatosViewsService(prisma), criados, tx };
}

describe('ContatosViewsService (Q2.2 — listas salvas)', () => {
  it('lista as minhas + as compartilhadas; filtro antigo inválido vira "sem filtro" (não 500)', async () => {
    const { svc, criados } = fake();
    const [v] = await svc.listar(T, 'eu');
    expect(JSON.stringify(criados[0])).toContain('"compartilhada":true');
    expect(v).toMatchObject({ filtros: {}, colunas: ['nome'], ordem: 'recentes', minha: false });
  });

  it('cria com filtro e colunas validados; dono = quem pediu', async () => {
    const { svc, criados } = fake();
    const v = await svc.criar(T, 'eu', { nome: '  Quentes  de SP ', filtros: { tag: 'quente', naoPerturbe: 'nao' }, colunas: ['nome', 'tags', 'nome'], ordem: 'nome_az', compartilhada: true });
    expect(criados[0]).toMatchObject({ tenantId: T, nome: 'Quentes de SP', ownerIdentityId: 'eu', colunas: ['nome', 'tags'], ordem: 'nome_az', compartilhada: true });
    expect(v.minha).toBe(true);
    await expect(svc.criar(T, 'eu', { nome: 'x', filtros: { ownerId: 'nao-uuid' } })).rejects.toThrow(/filtro inválido/);
    await expect(svc.criar(T, 'eu', { nome: '' })).rejects.toThrow(/nome da lista/);
    expect(() => parseColunas(['senha'])).toThrow(/coluna desconhecida/);
  });

  it('só quem criou altera ou apaga (compartilhada de outro é só leitura)', async () => {
    const { svc } = fake('outro');
    await expect(svc.atualizar(T, 'eu', VID, { nome: 'Minha agora' })).rejects.toThrow(/só quem criou/);
    await expect(svc.remover(T, 'eu', VID)).rejects.toThrow(/só quem criou/);
    const meu = fake('eu');
    await expect(meu.svc.remover(T, 'eu', VID)).resolves.toEqual({ ok: true });
  });
});

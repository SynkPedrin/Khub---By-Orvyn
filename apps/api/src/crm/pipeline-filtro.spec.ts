import { BadRequestException } from '@nestjs/common';
import { filtroNegociosDaQuery, filtrosAtivos, totaisDoFunil, whereDosNegocios } from './pipeline-filtro';
import { CrmService, LIMITE_QUADRO } from './crm.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { AvatarContatoService } from './messaging/avatar-contato.service';

const P = '9a000000-0000-4000-8000-000000000001';
const OWNER = 'eeeeeeee-0000-4000-8000-000000000001';

describe('Filtro do pipeline (Q2.1): query string', () => {
  it('lê os filtros conhecidos, ignora chaves estranhas e trata vazio como ausente', () => {
    const f = filtroNegociosDaQuery({ q: ' plano ', ownerId: 'nenhum', origem: 'Instagram', tag: 'vip', valorMin: '100', valorMax: '5000', status: 'todos', criadoDe: '2026-10-01', criadoAte: '2026-10-31', pipelineId: P, _: '123', tagVazia: '', origemVazia: '' });
    expect(f).toEqual({ q: 'plano', ownerId: 'nenhum', origem: 'Instagram', tag: 'vip', valorMin: 100, valorMax: 5000, status: 'todos', criadoDe: '2026-10-01', criadoAte: '2026-10-31' });
    expect(filtroNegociosDaQuery({ tag: '', status: '' })).toEqual({});
  });

  it('valor inválido, status desconhecido, dono que não é uuid e faixas invertidas são 400', () => {
    expect(() => filtroNegociosDaQuery({ valorMin: 'abc' })).toThrow(BadRequestException);
    expect(() => filtroNegociosDaQuery({ status: 'arquivados' })).toThrow(BadRequestException);
    expect(() => filtroNegociosDaQuery({ ownerId: 'fulano' })).toThrow(BadRequestException);
    expect(() => filtroNegociosDaQuery({ valorMin: '900', valorMax: '100' })).toThrow(/mínimo maior/);
    expect(() => filtroNegociosDaQuery({ criadoDe: '2026-11-02', criadoAte: '2026-11-01' })).toThrow(/criado de/);
    expect(() => filtroNegociosDaQuery({ criadoDe: '01/11/2026' })).toThrow(BadRequestException);
  });

  it('status=abertos é o padrão e não conta como filtro ligado', () => {
    expect(filtrosAtivos({ status: 'abertos' })).toBe(0);
    expect(filtrosAtivos({ status: 'ganhos', tag: 'vip' })).toBe(2);
  });
});

describe('Filtro do pipeline (Q2.1): where do Prisma', () => {
  const and = (w: ReturnType<typeof whereDosNegocios>) => w.AND as Record<string, unknown>[];

  it('sem filtro: só o funil e só abertos (contrato anterior do quadro)', () => {
    expect(and(whereDosNegocios(P, {}))).toEqual([{ pipelineId: P }, { status: 'aberto' }]);
    expect(and(whereDosNegocios(P, { status: 'todos' }))).toEqual([{ pipelineId: P }]);
    expect(and(whereDosNegocios(P, { status: 'perdidos' }))).toContainEqual({ status: 'perdido' });
  });

  it('busca no título e no nome do contato; tag no contato (principal ou lista); dono "nenhum" = sem dono', () => {
    const w = and(whereDosNegocios(P, { q: 'ana', tag: 'vip', ownerId: 'nenhum' }));
    expect(w).toContainEqual({ OR: [{ titulo: { contains: 'ana', mode: 'insensitive' } }, { contact: { nome: { contains: 'ana', mode: 'insensitive' } } }] });
    expect(w).toContainEqual({ contact: { OR: [{ tags: { has: 'vip' } }, { tag: { equals: 'vip', mode: 'insensitive' } }] } });
    expect(w).toContainEqual({ ownerId: null });
    expect(and(whereDosNegocios(P, { ownerId: OWNER }))).toContainEqual({ ownerId: OWNER });
  });

  it('faixa de valor e "criado em" pelo dia de Brasília (fim exclusivo no dia seguinte)', () => {
    const w = and(whereDosNegocios(P, { valorMin: 10, valorMax: 20, criadoDe: '2026-11-01', criadoAte: '2026-11-01' }));
    expect(w).toContainEqual({ valor: { gte: 10 } });
    expect(w).toContainEqual({ valor: { lte: 20 } });
    expect(w).toContainEqual({ createdAt: { gte: new Date('2026-11-01T03:00:00.000Z') } });
    expect(w).toContainEqual({ createdAt: { lt: new Date('2026-11-02T03:00:00.000Z') } });
  });

  it('totais do funil separam abertos, ganhos e perdidos', () => {
    expect(totaisDoFunil([{ status: 'aberto', valor: 100 }, { status: 'ganho', valor: 300 }, { status: 'perdido', valor: 50 }, { status: 'aberto', valor: 1 }])).toEqual({
      negocios: 4, valor: 451, abertos: 2, valorAberto: 101, ganhos: 1, valorGanho: 300, perdidos: 1, valorPerdido: 50,
    });
  });
});

describe('CrmService.pipeline com filtro (Q2.1)', () => {
  const S1 = '5a000000-0000-4000-8000-000000000001';
  const deal = (i: number, status = 'aberto') => ({
    id: `da000000-0000-4000-8000-${String(i).padStart(12, '0')}`, titulo: `N${i}`, valor: 10, origem: null, status, stageId: S1, ownerId: null,
    createdAt: new Date(), contactId: null, contact: { nome: 'Ana', ultimoContatoAt: null }, motivoPerda: status === 'perdido' ? { nome: 'Preço' } : null,
  });
  function fake(deals: ReturnType<typeof deal>[]) {
    const capt: unknown[] = [];
    const tx = {
      pipeline: { findMany: jest.fn(async () => [{ id: P, nome: 'Vendas' }]) },
      stage: { findMany: jest.fn(async () => [{ id: S1, pipelineId: P, nome: 'Novo', cor: '#7B2FBE', ordem: 0 }]) },
      deal: {
        groupBy: jest.fn(async () => [{ pipelineId: P, _count: { _all: deals.length } }]),
        findMany: jest.fn(async (a: { where: unknown; distinct?: unknown; take: number }) => { if (a.distinct) return [{ origem: 'Instagram' }]; capt.push(a.where); return deals.slice(0, a.take); }),
      },
      $queryRaw: jest.fn(async () => [{ tag: 'vip' }]),
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    return { svc: new CrmService(prisma, { publicar: jest.fn() } as unknown as DomainEventsService, {} as AvatarContatoService), capt };
  }

  it('filtro vai para o WHERE do banco; totais e opções voltam junto', async () => {
    const { svc, capt } = fake([deal(1), deal(2, 'perdido')]);
    const r = await svc.pipeline('t', undefined, { status: 'todos', tag: 'vip' });
    expect(JSON.stringify(capt[0])).toContain('"tags":{"has":"vip"}');
    expect(r.totais).toMatchObject({ negocios: 2, abertos: 1, perdidos: 1 });
    expect(r.stages[0].deals[1]).toMatchObject({ status: 'perdido', motivoPerda: 'Preço' });
    expect(r.opcoes).toEqual({ origens: ['Instagram'], tags: ['vip'] });
    expect(r.truncado).toBe(false);
  });

  it(`acima de ${LIMITE_QUADRO} negócios avisa truncado (não corta em silêncio)`, async () => {
    const { svc } = fake(Array.from({ length: LIMITE_QUADRO + 1 }, (_, i) => deal(i)));
    const r = await svc.pipeline('t');
    expect(r.truncado).toBe(true);
    expect(r.stages[0].deals).toHaveLength(LIMITE_QUADRO);
  });
});

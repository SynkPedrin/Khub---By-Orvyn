import { BadRequestException } from '@nestjs/common';
import { LIMITE_MASSA_NEGOCIOS, NegociosMassaService } from './negocios-massa.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { DomainEventsService } from '../events/domain-events.service';

const T = '11111111-1111-1111-1111-111111111111';
const id = (n: number) => `da000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P1 = '9a000000-0000-4000-8000-000000000001';
const P2 = '9a000000-0000-4000-8000-000000000002';
const M1 = '7a000000-0000-4000-8000-000000000001';

/** tx falso: registra o que o serviço pediu ao banco. */
function fake(opts: { existentes?: string[]; motivosAtivos?: number; membro?: boolean; naMesmaEtapa?: string[] } = {}) {
  const log: { op: string; args: unknown }[] = [];
  const tx = {
    deal: {
      findMany: jest.fn(async (a: { where: { id: { in: string[] }; stageId?: unknown } }) => {
        const vis = a.where.id.in.filter((x) => (opts.existentes ?? a.where.id.in).includes(x));
        const fora = a.where.stageId ? opts.naMesmaEtapa ?? [] : [];
        return vis.filter((x) => !fora.includes(x)).map((x) => ({ id: x, titulo: `N ${x.slice(-2)}`, pipelineId: P1, contactId: null }));
      }),
      updateMany: jest.fn(async (a: { where: { id: { in: string[] } } }) => { log.push({ op: 'deal.updateMany', args: a }); return { count: a.where.id.in.length }; }),
      deleteMany: jest.fn(async (a: { where: { id: { in: string[] } } }) => { log.push({ op: 'deal.deleteMany', args: a }); return { count: a.where.id.in.length }; }),
    },
    stage: { findUnique: jest.fn(async () => ({ id: 'st', nome: 'Proposta', pipelineId: P2 })) },
    membership: { findUnique: jest.fn(async () => (opts.membro === false ? null : { id: 'm' })) },
    lostReason: {
      count: jest.fn(async () => opts.motivosAtivos ?? 1),
      findUnique: jest.fn(async (a: { where: { id: string } }) => (a.where.id === M1 ? { id: M1, ativo: true } : null)),
    },
    activity: { create: jest.fn(async (a: unknown) => { log.push({ op: 'activity.create', args: a }); }), createMany: jest.fn(async (a: unknown) => { log.push({ op: 'activity.createMany', args: a }); }) },
    $executeRaw: jest.fn(async (s: TemplateStringsArray, ...v: unknown[]) => { log.push({ op: 'executeRaw', args: { sql: s.join('?'), v } }); return 1; }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  const publicados: { evento: string; dados: unknown }[] = [];
  const eventos = { publicar: (_t: string, evento: string, dados: unknown) => publicados.push({ evento, dados }) } as unknown as DomainEventsService;
  return { svc: new NegociosMassaService(prisma, eventos), log, publicados };
}
const auditoria = (log: { op: string; args: unknown }[]) => {
  const a = log.find((l) => l.op === 'executeRaw' && (l.args as { sql: string }).sql.includes('audit_logs'))!.args as { v: unknown[] };
  return { acao: a.v[2], payload: JSON.parse(a.v[3] as string) };
};

describe('NegociosMassaService (Q2.1 — ações em massa do pipeline)', () => {
  it('acima de 1.000 negócios recusa antes de tocar no banco', async () => {
    const { svc, log } = fake();
    const ids = Array.from({ length: LIMITE_MASSA_NEGOCIOS + 1 }, (_, i) => id(i));
    await expect(svc.executar(T, 'eu', { ids, acao: 'ganho' })).rejects.toThrow(/no máximo 1000/);
    expect(log).toHaveLength(0);
  });

  it('perdido em massa sem motivo, com motivos ativos: 400 e nada gravado', async () => {
    const { svc, log } = fake({ motivosAtivos: 3 });
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'perdido', params: {} })).rejects.toThrow(/motivo de perda obrigatório/);
    expect(log.some((l) => l.op === 'deal.updateMany')).toBe(false);
  });

  it('perdido com motivo: grava status + motivo e UMA auditoria com os ids', async () => {
    const { svc, log, publicados } = fake();
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2), id(1)], acao: 'perdido', params: { motivoPerdaId: M1, motivoPerdaObs: ' caro ' } });
    expect(r).toEqual({ acao: 'perdido', alvo: 2, afetados: 2, ignorados: 0 });
    const upd = log.find((l) => l.op === 'deal.updateMany')!.args as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({ status: 'perdido', motivoPerdaId: M1, motivoPerdaObs: 'caro' });
    const a = auditoria(log);
    expect(a.acao).toBe('deals.bulk.perdido');
    expect(a.payload).toMatchObject({ alvo: 2, afetados: 2, ids: [id(1), id(2)], motivoPerdaId: M1 });
    expect(publicados).toEqual([{ evento: 'pipeline.updated', dados: { id: P1 } }]);
  });

  it('id de outro tenant (invisível pela RLS) não entra no alvo', async () => {
    const { svc } = fake({ existentes: [id(1)] });
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2)], acao: 'ganho' });
    expect(r.alvo).toBe(1);
  });

  it('etapa: quem já está na etapa é ignorado; atividade por negócio movido; avisa os dois funis', async () => {
    const { svc, log, publicados } = fake({ naMesmaEtapa: [id(2)] });
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2)], acao: 'etapa', params: { stageId: '5a000000-0000-4000-8000-000000000001' } });
    expect(r).toEqual({ acao: 'etapa', alvo: 2, afetados: 1, ignorados: 1 });
    const upd = log.find((l) => l.op === 'deal.updateMany')!.args as { data: Record<string, unknown> };
    expect(upd.data).toMatchObject({ stageId: 'st', pipelineId: P2 });
    expect((log.find((l) => l.op === 'activity.createMany')!.args as { data: unknown[] }).data).toHaveLength(1);
    expect(publicados.map((p) => (p.dados as { id: string }).id).sort()).toEqual([P1, P2].sort());
  });

  it('dono que não é membro do tenant é 400; parâmetro errado é 400', async () => {
    const { svc } = fake({ membro: false });
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'dono', params: { ownerId: 'eeeeeeee-0000-4000-8000-000000000001' } })).rejects.toThrow(/não é membro/);
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'etapa', params: { stageId: 'x' } })).rejects.toThrow(BadRequestException);
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'ganho', params: { extra: 1 } })).rejects.toThrow(BadRequestException);
  });

  it('excluir: deleteMany dos alcançados e auditoria deals.bulk.excluir', async () => {
    const { svc, log } = fake();
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2)], acao: 'excluir' });
    expect(r.afetados).toBe(2);
    expect(log.some((l) => l.op === 'deal.deleteMany')).toBe(true);
    expect(auditoria(log).acao).toBe('deals.bulk.excluir');
  });
});

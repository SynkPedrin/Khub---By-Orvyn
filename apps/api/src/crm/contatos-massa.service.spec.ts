import { ContatosMassaService, LIMITE_MASSA } from './contatos-massa.service';
import type { PrismaService } from '../prisma/prisma.service';

const T = '11111111-1111-1111-1111-111111111111';
const id = (n: number) => `100a1015-2cbd-44a7-872c-${String(n).padStart(12, '0')}`;

/** tx falso: registra o que o serviço pediu ao banco. */
function fake(opts: { existentes?: string[]; alcanceFiltro?: number; membro?: boolean; abertos?: { id: string; contact_id: string; titulo: string; stage_id: string }[] } = {}) {
  const log: { op: string; args: unknown }[] = [];
  const tx = {
    contact: {
      findMany: jest.fn(async (a: { where: { id?: { in: string[] } }; take?: number }) => {
        log.push({ op: 'contact.findMany', args: a });
        if (a.where?.id?.in) return a.where.id.in.filter((x) => (opts.existentes ?? a.where.id!.in).includes(x)).map((x) => ({ id: x }));
        return Array.from({ length: Math.min(opts.alcanceFiltro ?? 0, a.take ?? Infinity) }, (_, i) => ({ id: id(i) }));
      }),
      updateMany: jest.fn(async (a: unknown) => { log.push({ op: 'contact.updateMany', args: a }); return { count: 2 }; }),
      deleteMany: jest.fn(async (a: unknown) => { log.push({ op: 'contact.deleteMany', args: a }); return { count: 2 }; }),
    },
    deal: { updateMany: jest.fn(async (a: unknown) => { log.push({ op: 'deal.updateMany', args: a }); return { count: 1 }; }) },
    stage: { findUnique: jest.fn(async () => ({ id: id(900), nome: 'Proposta', pipelineId: id(901) })) },
    membership: { findUnique: jest.fn(async () => (opts.membro === false ? null : { id: 'm' })) },
    activity: { create: jest.fn(async (a: unknown) => { log.push({ op: 'activity.create', args: a }); }), createMany: jest.fn(async (a: unknown) => { log.push({ op: 'activity.createMany', args: a }); }) },
    customFieldDef: { findMany: jest.fn(async () => []) },
    $queryRaw: jest.fn(async (s: TemplateStringsArray) => { log.push({ op: 'queryRaw', args: s.join('?') }); return opts.abertos ?? []; }),
    $executeRaw: jest.fn(async (s: TemplateStringsArray, ...v: unknown[]) => { log.push({ op: 'executeRaw', args: { sql: s.join('?'), v } }); return s.join('').includes('audit_logs') || s.join('').includes('crm_tags') ? 1 : 3; }),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  return { svc: new ContatosMassaService(prisma), log };
}
const auditoria = (log: { op: string; args: unknown }[]) => {
  const a = log.find((l) => l.op === 'executeRaw' && (l.args as { sql: string }).sql.includes('audit_logs'))!.args as { v: unknown[] };
  return { acao: a.v[2], payload: JSON.parse(a.v[3] as string) };
};

describe('ContatosMassaService (Q2.2 — ações em massa)', () => {
  it('tag_add: UPDATE só de quem ainda não tem a tag, catálogo e UMA auditoria', async () => {
    const { svc, log } = fake();
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2), id(3), id(1)], acao: 'tag_add', params: { tag: ' vip ' } });
    expect(r).toEqual({ acao: 'tag_add', alvo: 3, afetados: 3, ignorados: 0 });
    const sqls = log.filter((l) => l.op === 'executeRaw').map((l) => (l.args as { sql: string }).sql);
    expect(sqls[0]).toContain('array_append');
    expect(sqls[0]).toContain('NOT EXISTS');
    expect(sqls.some((s) => s.includes('crm_tags'))).toBe(true);
    const a = auditoria(log);
    expect(a.acao).toBe('contacts.bulk.tag_add');
    expect(a.payload).toMatchObject({ modo: 'ids', alvo: 3, params: { tag: 'vip' } });
  });

  it('id de outro tenant (invisível pela RLS) não entra no alvo', async () => {
    const { svc } = fake({ existentes: [id(1)] });
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2)], acao: 'nao_perturbe', params: { ativo: true } });
    expect(r.alvo).toBe(1);
  });

  it('modo filtro: acima de 5.000 contatos recusa (não corta em silêncio)', async () => {
    const { svc } = fake({ alcanceFiltro: LIMITE_MASSA + 1 });
    await expect(svc.executar(T, 'eu', { filtro: { tag: 'vip' }, acao: 'excluir' })).rejects.toThrow(/mais de 5000/);
    const ok = fake({ alcanceFiltro: 10 });
    await expect(ok.svc.executar(T, 'eu', { filtro: { tag: 'vip' }, acao: 'excluir' })).resolves.toMatchObject({ alvo: 10, afetados: 2 });
  });

  it('parâmetros validados por ação; sem ids nem filtro é 400', async () => {
    const { svc } = fake();
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'tag_add', params: {} })).rejects.toThrow(/parâmetros inválidos/);
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'etapa', params: { stageId: 'x' } })).rejects.toThrow(/parâmetros inválidos/);
    await expect(svc.executar(T, 'eu', { acao: 'excluir' })).rejects.toThrow(/ids ou filtro/);
    await expect(svc.executar(T, 'eu', { filtro: { ownerId: 'x' }, acao: 'excluir' })).rejects.toThrow(/filtro inválido/);
  });

  it('dono: só membro da operação', async () => {
    const { svc } = fake({ membro: false });
    await expect(svc.executar(T, 'eu', { ids: [id(1)], acao: 'dono', params: { ownerId: id(50) } })).rejects.toThrow(/não é membro/);
    const ok = fake();
    await expect(ok.svc.executar(T, 'eu', { ids: [id(1)], acao: 'dono', params: { ownerId: null } })).resolves.toMatchObject({ afetados: 2 });
  });

  it('etapa: move o negócio aberto de cada contato; quem já está na etapa ou não tem negócio é ignorado', async () => {
    const { svc, log } = fake({
      abertos: [
        { id: id(10), contact_id: id(1), titulo: 'N1', stage_id: id(800) },
        { id: id(11), contact_id: id(2), titulo: 'N2', stage_id: id(900) }, // já na etapa
      ],
    });
    const r = await svc.executar(T, 'eu', { ids: [id(1), id(2), id(3)], acao: 'etapa', params: { stageId: id(900) } });
    expect(r).toEqual({ acao: 'etapa', alvo: 3, afetados: 1, ignorados: 2 });
    const mov = log.find((l) => l.op === 'deal.updateMany')!.args as { where: { id: { in: string[] } }; data: { stageId: string; pipelineId: string } };
    expect(mov.where.id.in).toEqual([id(10)]);
    expect(mov.data).toMatchObject({ stageId: id(900), pipelineId: id(901) });
  });
});

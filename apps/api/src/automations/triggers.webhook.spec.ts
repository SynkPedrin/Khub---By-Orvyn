import { TriggersService } from './triggers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RunsService } from './runs.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

/** Grafo publicado como a API/Nyro/blueprint o guardam: config crua, SEM os defaults do catálogo. */
const grafoCom = (config: Record<string, unknown>) => ({
  nos: [{ id: 'g', tipo: 'gatilho.webhook', posicao: { x: 0, y: 0 }, config }, { id: 'n', tipo: 'acao.criar_nota', posicao: { x: 1, y: 0 }, config: { corpo: 'x' } }],
  arestas: [{ id: 'a', de: 'g', para: 'n' }],
});

function ambiente(config: Record<string, unknown>) {
  const criados: unknown[] = [];
  const tx = {
    workflow: { findUnique: jest.fn(async () => ({ status: 'ativo', versaoAtiva: { id: 'v1', grafo: grafoCom(config) } })) },
    contact: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => { criados.push(data); return { id: 'c1', nome: data.nome, email: data.email, telefone: data.telefone, empresa: null, tag: 'Lead', tags: [], valorEstimado: 0 }; }),
    },
    activity: { create: jest.fn(async () => ({})) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const runs = { iniciar: jest.fn(async () => ({ runId: 'r1' })) } as unknown as RunsService;
  return { svc: new TriggersService(prisma, runs), runs, tx, criados };
}

describe('TriggersService.processarWebhook — config sem defaults (regressão: TypeError e evento em retry sem aviso)', () => {
  it('gatilho com config vazia usa os defaults do catálogo (email/email/criar) e inicia a execução', async () => {
    const a = ambiente({});
    const r = await a.svc.processarWebhook(TENANT, 'w1', { email: 'ana@qa.test', nome: 'Ana' }, 'ev1');
    expect(r).toEqual({ ok: true, runId: 'r1' });
    expect(a.criados[0]).toMatchObject({ email: 'ana@qa.test', nome: 'Ana', telefone: null });
    expect(a.runs.iniciar).toHaveBeenCalledWith(expect.objectContaining({ gatilho: 'gatilho.webhook', dedupeKey: 'webhook:w1:ev1' }));
  });

  it('payload sem o campo esperado devolve motivo claro (não lança)', async () => {
    const a = ambiente({});
    await expect(a.svc.processarWebhook(TENANT, 'w1', { nome: 'Sem email' }, 'ev2')).resolves.toEqual({ ok: false, motivo: 'payload sem o campo "email"' });
    expect(a.runs.iniciar).not.toHaveBeenCalled();
  });

  it('config explícita continua valendo (telefone em campo aninhado)', async () => {
    const a = ambiente({ identificarPor: 'telefone', campo: 'lead.fone', seNaoAchar: 'criar' });
    const r = await a.svc.processarWebhook(TENANT, 'w1', { lead: { fone: '5511999990000' } }, 'ev3');
    expect(r).toMatchObject({ ok: true });
    expect(a.criados[0]).toMatchObject({ telefone: '5511999990000', email: null });
  });

  it('config inválida é rejeitada com motivo, sem estourar', async () => {
    const a = ambiente({ identificarPor: 'cpf' });
    const r = await a.svc.processarWebhook(TENANT, 'w1', { email: 'a@b.c' }, 'ev4');
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/gatilho de webhook inválido/);
  });
});

import { MarketplaceService } from './marketplace.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkflowsService } from '../automations/workflows.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const GRAFO = { nos: [{ id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} }], arestas: [] };

function amb() {
  const tx = {
    automationTemplate: {
      findUnique: jest.fn(async () => ({ id: 'tpl1', name: 'Boas-vindas', description: 'd', workflow: GRAFO })),
      findMany: jest.fn(async () => [{ id: 'tpl1', name: 'Boas-vindas', category: 'Entrada de Leads' }]),
      groupBy: jest.fn(async () => [{ category: 'Marketing', _count: { _all: 3 } }, { category: 'IA', _count: { _all: 1 } }]),
    },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const workflows = {
    criar: jest.fn(async () => ({ id: 'wf1' })),
    salvarRascunho: jest.fn(async () => ({ ok: true, versao: 1 })),
    publicar: jest.fn(async () => ({ ok: true, versao: 1 })),
  } as unknown as WorkflowsService;
  return { svc: new MarketplaceService(prisma, workflows), workflows, tx };
}

describe('MarketplaceService', () => {
  it('instalar: cria workflow do template → salva o grafo → publica (nessa ordem), reusando o motor', async () => {
    const { svc, workflows } = amb();
    const r = await svc.instalar(TENANT, 'ident1', 'tpl1');
    expect(r.workflowId).toBe('wf1');
    expect(workflows.criar).toHaveBeenCalledWith(TENANT, 'ident1', { nome: 'Boas-vindas', descricao: 'd' });
    expect(workflows.salvarRascunho).toHaveBeenCalledWith(TENANT, 'wf1', GRAFO);
    expect(workflows.publicar).toHaveBeenCalledWith(TENANT, 'wf1', 'ident1');
  });

  it('obter template inexistente (ou não visível pela RLS) → 404', async () => {
    const { svc, tx } = amb();
    (tx.automationTemplate.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(svc.obter(TENANT, '00000000-0000-0000-0000-000000000000')).rejects.toThrow(/não encontrado/i);
  });

  it('categorias agrega e ordena por total', async () => {
    const { svc } = amb();
    const cats = await svc.categorias(TENANT);
    expect(cats[0]).toMatchObject({ categoria: 'Marketing', total: 3 });
    expect(cats).toHaveLength(2);
  });
});

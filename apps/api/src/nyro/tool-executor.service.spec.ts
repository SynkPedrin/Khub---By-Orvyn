import { ToolExecutorService, type ContextoNyro } from './tool-executor.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { TasksService } from '../crm/tasks.service';
import type { NotesService } from '../crm/notes.service';
import type { WorkflowsService } from '../automations/workflows.service';
import type { RetrievalService } from '../rag/retrieval.service';
import type { MarketplaceService } from '../marketplace/marketplace.service';
import type { BlueprintService } from '../blueprints/blueprint.service';
import type { NicoAnalisesService } from './analises.service';

const CTX: ContextoNyro = { tenantId: '11111111-1111-1111-1111-111111111111', identityId: 'id-1', nicho: 'clinica', subespecialidade: null };
const UUID = '22222222-2222-2222-2222-222222222222';

function amb() {
  const crm = {
    createPipeline: jest.fn(async () => ({ id: 'pl1', nome: 'Vendas', etapas: [{ id: 's1', nome: 'Novo' }] })),
    createStage: jest.fn(async () => ({ id: 's9', nome: 'Proposta' })),
  } as unknown as CrmService;
  const marketplace = {
    listar: jest.fn(async () => [{ id: 'tpl1', name: 'Boas-vindas' }]),
    instalar: jest.fn(async () => ({ workflowId: 'wf1', nome: 'Boas-vindas' })),
  } as unknown as MarketplaceService;
  const blueprints = { aplicar: jest.fn(async () => ({ jaAplicado: false, blueprint: 'saude.odontologia', funil: { id: 'pl1' }, automacoes: [] })) } as unknown as BlueprintService;
  const prisma = { withTenant: jest.fn(async (_t: string, w: (tx: unknown) => unknown) => w({ $executeRaw: jest.fn() })) } as unknown as PrismaService;
  const vazio = {} as never;
  const svc = new ToolExecutorService(prisma, crm, vazio as MessagesService, vazio as TasksService, vazio as NotesService, vazio as WorkflowsService, vazio as RetrievalService, marketplace, blueprints, vazio as NicoAnalisesService, vazio as never, vazio as never, vazio as never);
  return { svc, crm, marketplace, blueprints };
}

describe('ToolExecutorService — Nyro configuradora', () => {
  it('criar_funil chama o CRM com o nome e as etapas', async () => {
    const { svc, crm } = amb();
    const r = await svc.executar('criar_funil', { nome: 'Vendas', etapas: ['Novo', 'Proposta', 'Fechado'] }, CTX);
    expect(r.ok).toBe(true);
    expect((crm.createPipeline as jest.Mock)).toHaveBeenCalledWith(CTX.tenantId, { nome: 'Vendas', etapas: ['Novo', 'Proposta', 'Fechado'] });
  });

  it('criar_funil recusa com menos de 2 etapas (schema)', async () => {
    const { svc, crm } = amb();
    const r = await svc.executar('criar_funil', { nome: 'X', etapas: ['só uma'] }, CTX);
    expect(r.ok).toBe(false);
    expect((crm.createPipeline as jest.Mock)).not.toHaveBeenCalled();
  });

  it('criar_etapa adiciona a etapa ao funil', async () => {
    const { svc, crm } = amb();
    const r = await svc.executar('criar_etapa', { pipelineId: UUID, nome: 'Proposta' }, CTX);
    expect(r.ok).toBe(true);
    expect((crm.createStage as jest.Mock)).toHaveBeenCalledWith(CTX.tenantId, { pipelineId: UUID, nome: 'Proposta', cor: undefined });
  });

  it('instalar_automacao busca no marketplace e instala o melhor match', async () => {
    const { svc, marketplace } = amb();
    const r = await svc.executar('instalar_automacao', { busca: 'boas vindas' }, CTX);
    expect(r.ok).toBe(true);
    expect((marketplace.listar as jest.Mock)).toHaveBeenCalledWith(CTX.tenantId, { q: 'boas vindas' });
    expect((marketplace.instalar as jest.Mock)).toHaveBeenCalledWith(CTX.tenantId, 'id-1', 'tpl1');
    expect((r.dados as { instalado: boolean }).instalado).toBe(true);
  });

  it('instalar_automacao sem match não instala', async () => {
    const { svc, marketplace } = amb();
    (marketplace.listar as jest.Mock).mockResolvedValueOnce([]);
    const r = await svc.executar('instalar_automacao', { busca: 'algo inexistente' }, CTX);
    expect(r.ok).toBe(true);
    expect((r.dados as { instalado: boolean }).instalado).toBe(false);
    expect((marketplace.instalar as jest.Mock)).not.toHaveBeenCalled();
  });

  it('aplicar_blueprint provisiona o CRM inteiro pelo nicho', async () => {
    const { svc, blueprints } = amb();
    const r = await svc.executar('aplicar_blueprint', { blueprint: 'saude.odontologia' }, CTX);
    expect(r.ok).toBe(true);
    expect((blueprints.aplicar as jest.Mock)).toHaveBeenCalledWith(CTX.tenantId, 'id-1', 'saude.odontologia');
  });

  it('tool desconhecida é recusada (não adivinha)', async () => {
    const { svc } = amb();
    const r = await svc.executar('tool_que_nao_existe', {}, CTX);
    expect(r.ok).toBe(false);
    expect(r.erro).toMatch(/desconhecida/i);
  });
});

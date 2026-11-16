import { AgentsService } from './agents.service';
import { AtendimentoService } from '../crm/messaging/atendimento.service';
import { modoDoAgente } from '../common/modo-agente';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentLlm } from '../ai/provider.contract';
import type { AiProviderRegistry } from '../ai/provider.registry';
import type { EvaluationService } from './evaluation/evaluation.service';
import type { DomainEventsService } from '../events/domain-events.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = { identityId: 'id-ana', role: 'admin' };
const INSTRUCOES = 'Você é a Lia, atendente do estúdio. Responda curto, simpático e sempre em português do Brasil.';

/** Agente principal do WhatsApp e um tx falso que registra o que mudou nas conversas. */
function servico(agente: Record<string, unknown>) {
  const conversas = { updateMany: jest.fn(async (_a: unknown) => ({ count: 7 })) };
  const tx = {
    agent: {
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...agente, ...data })),
      updateMany: jest.fn(async () => ({ count: 0 })),
      findUnique: jest.fn(async () => agente),
    },
    conversation: conversas,
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const llm = { configured: () => true, missing: () => [], exigirCredencial: () => undefined, provedor: () => 'anthropic' } as unknown as AgentLlm;
  const svc = new AgentsService(prisma, llm, { nomeAtivo: 'anthropic' } as unknown as AiProviderRegistry, { semearPadrao: jest.fn() } as unknown as EvaluationService);
  return { svc, conversas };
}

const base = { id: 'ag1', tenantId: TENANT, nome: 'Lia', status: 'pausado', padrao: true, canais: ['WhatsApp'], instrucoes: INSTRUCOES, config: {}, createdAt: new Date(), updatedAt: new Date() };

describe('modo do agente (ADR-0048: desativado / sugestivo / piloto automático)', () => {
  it('config sem modo = piloto automático (comportamento de antes)', () => {
    expect(modoDoAgente({})).toBe('automatico');
    expect(modoDoAgente(null)).toBe('automatico');
    expect(modoDoAgente({ modo: 'sugestivo' })).toBe('sugestivo');
  });

  it('ativar o principal em piloto automático liga a IA em TODAS as conversas abertas sem humano do canal', async () => {
    const { svc, conversas } = servico(base);
    await svc.mudarStatus(TENANT, ADMIN, 'ag1', 'ativo');
    const where = (conversas.updateMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect(where).toMatchObject({ atendimento: 'humano', assigneeId: null, handoffMotivo: null, canal: { in: ['WhatsApp'] } });
    expect(where.status).toEqual({ not: 'resolvida' });
  });

  it('em modo sugestivo, ativar NÃO liga a IA nas conversas', async () => {
    const { svc, conversas } = servico({ ...base, config: { modo: 'sugestivo' } });
    await svc.mudarStatus(TENANT, ADMIN, 'ag1', 'ativo');
    expect(conversas.updateMany).not.toHaveBeenCalled();
  });

  it('agente que não é o principal não assume conversas', async () => {
    const { svc, conversas } = servico({ ...base, padrao: false });
    await svc.mudarStatus(TENANT, ADMIN, 'ag1', 'ativo');
    expect(conversas.updateMany).not.toHaveBeenCalled();
  });

  it('trocar de piloto automático para sugestivo tira a IA das conversas dela', async () => {
    const { svc, conversas } = servico({ ...base, status: 'ativo' });
    await svc.atualizar(TENANT, ADMIN, 'ag1', { config: { modo: 'sugestivo' } });
    expect(conversas.updateMany).toHaveBeenCalledWith({ where: { agentId: 'ag1', atendimento: 'ia' }, data: { atendimento: 'humano', handoffMotivo: null, handoffAt: null } });
  });
});

describe('estado inicial da conversa conforme o modo', () => {
  const svc = (config: unknown) => {
    const tx = { agent: { findFirst: jest.fn(async () => ({ id: 'ag1', config })) } };
    return { atendimento: new AtendimentoService({} as PrismaService, {} as DomainEventsService), tx };
  };
  it('piloto automático: conversa nova já nasce com a IA', async () => {
    const { atendimento, tx } = svc({});
    await expect(atendimento.estadoInicial(tx as never, 'WhatsApp')).resolves.toEqual({ atendimento: 'ia', agentId: 'ag1' });
  });
  it('sugestivo: conversa nova nasce com humano (a automação ativa a IA quando quiser)', async () => {
    const { atendimento, tx } = svc({ modo: 'sugestivo' });
    await expect(atendimento.estadoInicial(tx as never, 'WhatsApp')).resolves.toEqual({ atendimento: 'humano', agentId: null });
  });
});

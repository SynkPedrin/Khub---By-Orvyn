import { AgentsService } from './agents.service';
import { AtendimentoService } from '../crm/messaging/atendimento.service';
import { contatoNoPublico, publicoDoAgente, publicoValendo } from '../common/publico-agente';
import { agentConfigSchema, mesclarConfig, configPadrao } from './config/agent-config';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentLlm } from '../ai/provider.contract';
import type { AiProviderRegistry } from '../ai/provider.registry';
import type { EvaluationService } from './evaluation/evaluation.service';
import type { DomainEventsService } from '../events/domain-events.service';

/**
 * Público do agente por tag (ADR-0059). Regressão do incidente de 24/11:
 * agente principal em piloto automático "só para o contato com a tag testia"
 * assumiu 136 conversas e respondeu clientes reais, porque a tag só servia
 * para LIGAR a IA (automação), nunca para RESTRINGIR.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = { identityId: 'id-ana', role: 'admin' };
const INSTRUCOES = 'Você é a Carol, secretária da clínica. Responda curto, cordial e sempre em português do Brasil.';

describe('publicoDoAgente / contatoNoPublico', () => {
  it('config sem público = todos os contatos (comportamento de antes)', () => {
    expect(publicoDoAgente({})).toEqual([]);
    expect(publicoDoAgente(null)).toEqual([]);
    expect(contatoNoPublico([], [])).toBe(true);
    expect(contatoNoPublico(null, [])).toBe(true);
  });
  it('normaliza tags (caixa, espaço, repetidas, lixo)', () => {
    expect(publicoDoAgente({ publico: { tags: [' TestIA ', 'testia', '', 3] } })).toEqual(['testia']);
  });
  it('com público, só passa contato com a tag (sem diferenciar caixa)', () => {
    expect(contatoNoPublico(['Lead', 'TESTIA'], ['testia'])).toBe(true);
    expect(contatoNoPublico(['agendart'], ['testia'])).toBe(false);
    expect(contatoNoPublico([], ['testia'])).toBe(false);
    expect(contatoNoPublico(null, ['testia'])).toBe(false);
  });
  it('público valendo: o da config viva manda; sem ele, o da versão publicada (vale também para o follow-up)', () => {
    expect(publicoValendo({ publico: { tags: ['testia'] } }, { publico: { tags: ['outra'] } })).toEqual(['testia']);
    expect(publicoValendo({}, { publico: { tags: ['Pacientes IA'] } })).toEqual(['pacientes ia']);
    expect(publicoValendo({}, {})).toEqual([]);
    expect(contatoNoPublico(['lead'], publicoValendo({ publico: { tags: ['testia'] } }, {}))).toBe(false);
  });
  it('o schema aceita e mescla o público por seção', () => {
    expect(agentConfigSchema.parse({}).publico).toEqual({ tags: [] });
    const c = mesclarConfig(configPadrao(), { publico: { tags: ['testia'] } });
    expect(c.publico.tags).toEqual(['testia']);
    expect(c.modo).toBe('automatico');
  });
});

function servico(agente: Record<string, unknown>) {
  const conversas = { updateMany: jest.fn(async (_a: unknown) => ({ count: 3 })) };
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

const base = { id: 'ag1', tenantId: TENANT, nome: 'Carol', status: 'pausado', padrao: true, canais: ['WhatsApp'], instrucoes: INSTRUCOES, createdAt: new Date(), updatedAt: new Date() };

describe('piloto automático com público por tag', () => {
  it('ativar o principal com público só assume conversas de contatos com a tag', async () => {
    const { svc, conversas } = servico({ ...base, config: { publico: { tags: ['testia'] } } });
    await svc.mudarStatus(TENANT, ADMIN, 'ag1', 'ativo');
    const chamadas = conversas.updateMany.mock.calls.map((c) => (c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }));
    const assumir = chamadas.find((c) => c.data.atendimento === 'ia');
    expect(assumir).toBeDefined();
    expect(assumir!.where).toMatchObject({ atendimento: 'humano', canal: { in: ['WhatsApp'] } });
    expect((assumir!.where.contact as { tags: { hasSome: string[] } }).tags.hasSome).toContain('testia');
  });

  it('colocar público num agente ativo devolve para a equipe as conversas de quem não tem a tag', async () => {
    const { svc, conversas } = servico({ ...base, status: 'ativo', config: {} });
    await svc.atualizar(TENANT, ADMIN, 'ag1', { config: { publico: { tags: ['testia'] } } });
    const liberar = conversas.updateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }).find((c) => c.data.atendimento === 'humano');
    expect(liberar).toBeDefined();
    expect(liberar!.where).toMatchObject({ agentId: 'ag1', atendimento: 'ia' });
    expect(liberar!.where.NOT).toBeDefined();
  });

  it('sem público, o piloto automático continua assumindo todas (sem filtro de contato)', async () => {
    const { svc, conversas } = servico({ ...base, config: {} });
    await svc.mudarStatus(TENANT, ADMIN, 'ag1', 'ativo');
    const assumir = conversas.updateMany.mock.calls.map((c) => c[0] as { where: Record<string, unknown>; data: Record<string, unknown> }).find((c) => c.data.atendimento === 'ia');
    expect(assumir!.where.contact).toBeUndefined();
  });
});

describe('conversa nova e nó "Ativar IA" com público por tag', () => {
  const atendimento = () => new AtendimentoService({} as PrismaService, {} as DomainEventsService);
  const txInicial = (config: unknown) => ({ agent: { findFirst: jest.fn(async () => ({ id: 'ag1', config })) } });

  it('contato sem a tag: conversa nova nasce com a equipe', async () => {
    await expect(atendimento().estadoInicial(txInicial({ publico: { tags: ['testia'] } }) as never, 'WhatsApp', ['agendart'])).resolves.toEqual({ atendimento: 'humano', agentId: null });
    await expect(atendimento().estadoInicial(txInicial({ publico: { tags: ['testia'] } }) as never, 'WhatsApp')).resolves.toEqual({ atendimento: 'humano', agentId: null });
  });
  it('contato com a tag: conversa nova nasce com a IA', async () => {
    await expect(atendimento().estadoInicial(txInicial({ publico: { tags: ['testia'] } }) as never, 'WhatsApp', ['testia'])).resolves.toEqual({ atendimento: 'ia', agentId: 'ag1' });
  });

  it('"Ativar IA" da automação recusa contato fora do público, com motivo legível', async () => {
    const tx = {
      conversation: { findUnique: jest.fn(async () => ({ id: 'c1', canal: 'WhatsApp', contactId: 'ct1' })) },
      agent: { findFirst: jest.fn(async () => ({ id: 'ag1', config: { publico: { tags: ['testia'] } } })) },
      contact: { findUnique: jest.fn(async () => ({ tags: ['agendart'] })) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
    const svc = new AtendimentoService(prisma, { publish: jest.fn() } as unknown as DomainEventsService);
    await expect(svc.ativarIaSistema(TENANT, 'c1', 'ag1')).rejects.toThrow(/fora do público do agente.*testia/);
  });
});

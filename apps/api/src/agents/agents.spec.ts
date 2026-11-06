import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentToolsService, type ContextoAgente } from './agent-tools.service';
import { cortarNoLimite, ferramentasDoAgente, paraJsonSchema, FERRAMENTAS_POR_NOME } from './catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { AnthropicProvider } from '../ai/anthropic.provider';
import type { AgentRuntimeService } from './agent-runtime.service';
import type { CrmService } from '../crm/crm.service';
import type { NotesService } from '../crm/notes.service';
import type { TasksService } from '../crm/tasks.service';
import type { RetrievalService } from '../rag/retrieval.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = { identityId: 'id-ana', role: 'admin' };

function servico(agenteAtual: Record<string, unknown> | null = null, configurado = true) {
  const tx = {
    agent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ag1', createdAt: new Date(), updatedAt: new Date(), ...data })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ ...agenteAtual, ...data })),
      updateMany: jest.fn(async () => ({ count: 1 })),
      findUnique: jest.fn(async () => agenteAtual),
    },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const llm = {
    configured: () => configurado,
    missing: () => (configurado ? [] : ['ANTHROPIC_API_KEY']),
    exigirCredencial: () => {
      if (!configurado) throw new Error('config_required');
    },
  } as unknown as AnthropicProvider;
  return { svc: new AgentsService(prisma, llm, {} as AgentRuntimeService), tx };
}

describe('AgentsService — allowlist e permissões', () => {
  it('modelo fora do catálogo → 400', async () => {
    const { svc } = servico();
    await expect(svc.criar(TENANT, ADMIN, { nome: 'Lia', modelo: 'gpt-5' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ferramenta fora do catálogo (ex.: enviar_mensagem da Nyro) → 400', async () => {
    const { svc } = servico();
    await expect(svc.criar(TENANT, ADMIN, { nome: 'Lia', ferramentas: ['buscar_conhecimento', 'enviar_mensagem'] })).rejects.toThrow('ferramentas não permitidas: enviar_mensagem');
  });

  it('transferir_para_humano não é opção: é sempre ativa', async () => {
    const { svc } = servico();
    await expect(svc.criar(TENANT, ADMIN, { nome: 'Lia', ferramentas: ['transferir_para_humano'] })).rejects.toBeInstanceOf(BadRequestException);
    expect(ferramentasDoAgente([], false).map((f) => f.nome)).toEqual(['transferir_para_humano']);
  });

  it('atendente (member) não configura agente → 403', async () => {
    const { svc } = servico();
    await expect(svc.criar(TENANT, { identityId: 'id-bia', role: 'member' }, { nome: 'Lia' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('agente nasce como rascunho com o modelo padrão (Opus 5.5)', async () => {
    const { svc, tx } = servico();
    const a = await svc.criar(TENANT, ADMIN, { nome: 'Lia' });
    expect(a).toMatchObject({ status: 'rascunho', modelo: 'claude-opus-5-5' });
    expect(tx.$executeRaw).toHaveBeenCalled(); // auditoria
  });

  it('marcar como padrão desmarca o padrão anterior na mesma transação', async () => {
    const { svc, tx } = servico();
    await svc.criar(TENANT, ADMIN, { nome: 'Lia', padrao: true });
    expect(tx.agent.updateMany).toHaveBeenCalledWith({ where: { padrao: true }, data: { padrao: false } });
  });

  it('ativar sem instruções → 400 (agente não atende "no escuro")', async () => {
    const { svc } = servico({ id: 'ag1', status: 'rascunho', instrucoes: '' });
    await expect(svc.mudarStatus(TENANT, ADMIN, 'ag1', 'ativo')).rejects.toThrow('instruções');
  });

  it('playground sem ANTHROPIC_API_KEY falha explicitamente (config_required)', async () => {
    const { svc } = servico({ id: 'ag1', status: 'ativo', instrucoes: 'x'.repeat(30) }, false);
    await expect(svc.testar(TENANT, 'ag1', undefined, [{ de: 'contato', texto: 'oi' }])).rejects.toThrow('config_required');
  });
});

function ferramentas(contato: Record<string, unknown> | null = { nome: 'Marina', email: null, empresa: null, tag: 'Lead' }) {
  const tx = { contact: { findUnique: jest.fn(async () => contato) }, $executeRaw: jest.fn(async () => 1) };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const crm = { updateContact: jest.fn(async () => ({ ok: true })) } as unknown as CrmService;
  const notas = { create: jest.fn(async () => ({ id: 'n1' })) } as unknown as NotesService;
  const tarefas = { create: jest.fn(async () => ({ id: 't1' })) } as unknown as TasksService;
  const rag = { search: jest.fn(async () => []) } as unknown as RetrievalService;
  return { svc: new AgentToolsService(prisma, crm, notas, tarefas, rag), tx, crm, notas, rag };
}

const CTX: ContextoAgente = {
  tenantId: TENANT, agentId: 'ag1', agentNome: 'Lia', conversationId: 'cv1', contactId: 'c1',
  nicho: null, subespecialidade: null, escopos: ['tenant'], simulacao: false,
};
const TODAS = new Set(['buscar_conhecimento', 'ver_contato', 'atualizar_contato', 'adicionar_nota', 'criar_tarefa', 'transferir_para_humano']);

describe('AgentToolsService — alcance de UM contato (anti prompt-injection)', () => {
  it('ferramenta não liberada para o agente é recusada', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('atualizar_contato', { campo: 'nome', valor: 'X' }, CTX, new Set(['buscar_conhecimento']));
    expect(r).toMatchObject({ ok: false });
    expect(f.crm.updateContact).not.toHaveBeenCalled();
  });

  it('contactId nos argumentos é REJEITADO: o contato vem só da conversa', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('ver_contato', { contactId: 'contato-de-outra-pessoa' }, CTX, TODAS);
    expect(r).toMatchObject({ ok: false });
    expect(r.erro).toContain('argumentos inválidos');
    expect(f.tx.contact.findUnique).not.toHaveBeenCalled();
  });

  it('ver_contato lê o contato da conversa', async () => {
    const f = ferramentas();
    await f.svc.executar('ver_contato', {}, CTX, TODAS);
    expect(f.tx.contact.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'c1' } }));
  });

  it('atualizar_contato grava pelo CrmService no contato da conversa e audita como IA', async () => {
    const f = ferramentas();
    await f.svc.executar('atualizar_contato', { campo: 'email', valor: 'marina@ex.com' }, CTX, TODAS);
    expect(f.crm.updateContact).toHaveBeenCalledWith(TENANT, 'c1', { email: 'marina@ex.com' });
    expect(f.tx.$executeRaw).toHaveBeenCalled();
  });

  it('no playground, escrita é só descrita (nada gravado)', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('adicionar_nota', { texto: 'quer consulta na sexta' }, { ...CTX, simulacao: true }, TODAS);
    expect(r).toMatchObject({ ok: true, dados: { simulado: true } });
    expect(f.notas.create).not.toHaveBeenCalled();
  });

  it('busca vazia diz a verdade (sem trecho → declarar lacuna)', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('buscar_conhecimento', { pergunta: 'preço da cirurgia' }, CTX, TODAS);
    expect(r).toMatchObject({ ok: true, dados: { vazio: true } });
    expect(f.rag.search).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), 'preço da cirurgia', ['tenant']);
  });

  it('transferir_para_humano devolve o pedido sem efeito colateral', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('transferir_para_humano', { motivo: 'pediu uma pessoa' }, CTX, TODAS);
    expect(r.transferir).toEqual({ motivo: 'pediu uma pessoa' });
  });
});

describe('catálogo', () => {
  it('cortarNoLimite prefere fim de frase e nunca passa do limite', () => {
    expect(cortarNoLimite('Curto.', 100)).toBe('Curto.');
    const t = cortarNoLimite('Primeira frase completa aqui. Segunda frase que passa do limite com folga.', 40);
    expect(t).toBe('Primeira frase completa aqui.');
    expect(cortarNoLimite('palavra '.repeat(30), 50).length).toBeLessThanOrEqual(51);
  });

  it('JSON Schema das tools é estrito (additionalProperties: false)', () => {
    const s = paraJsonSchema(FERRAMENTAS_POR_NOME.get('atualizar_contato')!.schema);
    expect(s).toMatchObject({ additionalProperties: false, required: ['campo', 'valor'], properties: { campo: { enum: ['nome', 'email', 'empresa'] } } });
  });
});

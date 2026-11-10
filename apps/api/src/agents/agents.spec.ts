import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentToolsService, type ContextoAgente } from './agent-tools.service';
import { cortarNoLimite, ferramentasDoAgente, paraJsonSchema, FERRAMENTAS_POR_NOME } from './catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentLlm } from '../ai/provider.contract';
import type { AiProviderRegistry } from '../ai/provider.registry';
import type { EvaluationService } from './evaluation/evaluation.service';
import type { AgendaService } from '../agenda/agenda.service';
import type { WorkflowsService } from '../automations/workflows.service';
import type { CrmService } from '../crm/crm.service';
import type { NotesService } from '../crm/notes.service';
import type { TasksService } from '../crm/tasks.service';
import type { RetrievalService } from '../rag/retrieval.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const ADMIN = { identityId: 'id-ana', role: 'admin' };

function servico(agenteAtual: Record<string, unknown> | null = null, configurado = true) {
  const tx = {
    agent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ag1', createdAt: new Date(), updatedAt: new Date(), versaoPublicadaId: null, config: {}, ...data })),
      delete: jest.fn(async () => ({})),
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
    provedor: () => 'anthropic',
  } as unknown as AgentLlm;
  const registry = { nomeAtivo: 'anthropic' } as unknown as AiProviderRegistry;
  const avaliacoes = { semearPadrao: jest.fn(async () => undefined) } as unknown as EvaluationService;
  return { svc: new AgentsService(prisma, llm, registry, avaliacoes), tx, avaliacoes };
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

  it('agente novo recebe os cenários de regressão padrão', async () => {
    const { svc, avaliacoes } = servico();
    await svc.criar(TENANT, ADMIN, { nome: 'Lia' });
    expect(avaliacoes.semearPadrao).toHaveBeenCalled();
  });

  it('config estendida é validada por seção (Zod) — inválida → 400 com o campo', async () => {
    const { svc } = servico();
    await expect(svc.criar(TENANT, ADMIN, { nome: 'Lia', config: { personalidade: { empatia: 500 } } })).rejects.toMatchObject({ response: { title: 'configuração inválida' } });
    const ok = await svc.criar(TENANT, ADMIN, { nome: 'Lia', config: { identidade: { cargo: 'Consultora' } } });
    expect(ok.config.identidade.cargo).toBe('Consultora');
    expect(ok.config.comunicacao.fragmentacao.ativo).toBe(true);
  });

  it('atualizar mescla a seção sem apagar as outras', async () => {
    const { svc, tx } = servico({ id: 'ag1', status: 'rascunho', instrucoes: '', config: { identidade: { cargo: 'SDR' } } });
    await svc.atualizar(TENANT, ADMIN, 'ag1', { config: { personalidade: { humor: 0 } } });
    const data = (tx.agent.update.mock.calls[0] as unknown as [{ data: { config: { identidade: { cargo: string }; personalidade: { humor: number } } } }])[0].data;
    expect(data.config.identidade.cargo).toBe('SDR');
    expect(data.config.personalidade.humor).toBe(0);
  });

  it('exclusão exige agente arquivado e o nome exato como confirmação', async () => {
    const ativo = servico({ id: 'ag1', nome: 'Lia', status: 'ativo' });
    await expect(ativo.svc.excluir(TENANT, ADMIN, 'ag1', 'Lia')).rejects.toThrow('arquive');
    const arq = servico({ id: 'ag1', nome: 'Lia', status: 'arquivado' });
    await expect(arq.svc.excluir(TENANT, ADMIN, 'ag1', 'lia')).rejects.toThrow('confirmação');
    await expect(arq.svc.excluir(TENANT, ADMIN, 'ag1', 'Lia')).resolves.toEqual({ ok: true });
    expect(arq.tx.agent.delete).toHaveBeenCalled();
  });
});

function ferramentas(contato: Record<string, unknown> | null = { nome: 'Marina', email: null, empresa: null, tag: 'Lead', tags: ['vip'], camposCustom: {} }) {
  const tx = {
    contact: { findUnique: jest.fn(async () => contato) },
    task: { findFirst: jest.fn(async ({ where }: { where: { id: string; contactId: string } }) => (where.id === '00000000-0000-4000-8000-000000000001' ? { id: where.id } : null)) },
    stage: { findMany: jest.fn(async () => [{ id: '00000000-0000-4000-8000-0000000000aa', nome: 'Qualificado' }, { id: '00000000-0000-4000-8000-0000000000bb', nome: 'Proposta' }]) },
    deal: { findFirst: jest.fn(async () => ({ id: 'd1' })) },
    agentToolExecution: { create: jest.fn(async () => ({ id: 'ex1' })), updateMany: jest.fn(async () => ({ count: 1 })) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const crm = { updateContact: jest.fn(async () => ({ ok: true })), moveDeal: jest.fn(async () => ({ ok: true })), createDeal: jest.fn(async () => ({ id: 'd2' })) } as unknown as CrmService;
  const notas = { create: jest.fn(async () => ({ id: 'n1' })) } as unknown as NotesService;
  const tarefas = { create: jest.fn(async () => ({ id: 't1' })), update: jest.fn(async () => ({ ok: true })) } as unknown as TasksService;
  const agenda = { criar: jest.fn(async () => ({ id: 'cp1', inicio: new Date() })), sugerirHorarios: jest.fn(async () => []) } as unknown as AgendaService;
  const workflows = { dispararPorAgente: jest.fn(async () => ({ runId: 'r1' })) } as unknown as WorkflowsService;
  const rag = { searchAgente: jest.fn(async () => []) } as unknown as RetrievalService;
  return { svc: new AgentToolsService(prisma, crm, notas, tarefas, agenda, workflows, rag), tx, crm, notas, tarefas, workflows, rag };
}

const CTX: ContextoAgente = {
  tenantId: TENANT, agentId: 'ag1', agentNome: 'Lia', conversationId: 'cv1', contactId: 'c1',
  nicho: null, subespecialidade: null, escopos: ['tenant'], simulacao: false,
};
const TODAS = new Set(FERRAMENTAS_POR_NOME.keys());

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
    expect(f.rag.searchAgente).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }), 'preço da cirurgia', ['tenant'], null, 6);
  });

  it('toda execução é registrada (inclusive negada)', async () => {
    const f = ferramentas();
    await f.svc.executar('adicionar_tag', { tag: 'x' }, CTX, new Set());
    expect(f.tx.agentToolExecution.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ferramenta: 'adicionar_tag', status: 'negado' }) }));
  });

  it('operação marcada para confirmação fica aguardando aprovação humana', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('mover_etapa', { etapa: 'Proposta' }, { ...CTX, exigirConfirmacao: ['mover_etapa'] }, TODAS);
    expect(r).toMatchObject({ ok: true, aguardandoAprovacao: true, execucaoId: 'ex1' });
    expect(f.crm.moveDeal).not.toHaveBeenCalled();
  });

  it('adicionar_tag não duplica e emite pelo CrmService', async () => {
    const f = ferramentas();
    const r1 = await f.svc.executar('adicionar_tag', { tag: 'VIP' }, CTX, TODAS);
    expect(r1.dados).toEqual({ jaTinha: 'VIP' });
    await f.svc.executar('adicionar_tag', { tag: 'implante' }, CTX, TODAS);
    expect(f.crm.updateContact).toHaveBeenCalledWith(TENANT, 'c1', { tags: ['vip', 'implante'] });
  });

  it('atualizar_tarefa só mexe em tarefa DO contato da conversa', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('atualizar_tarefa', { tarefaId: '00000000-0000-4000-8000-000000000099', status: 'concluida' }, CTX, TODAS);
    expect(r).toMatchObject({ ok: false });
    expect(f.tarefas.update).not.toHaveBeenCalled();
  });

  it('acionar_workflow recusa workflow fora da lista permitida', async () => {
    const f = ferramentas();
    const wf = '00000000-0000-4000-8000-0000000000cc';
    expect(await f.svc.executar('acionar_workflow', { workflowId: wf }, CTX, TODAS)).toMatchObject({ ok: false });
    expect(f.workflows.dispararPorAgente).not.toHaveBeenCalled();
    expect(await f.svc.executar('acionar_workflow', { workflowId: wf }, { ...CTX, workflowsPermitidos: [wf] }, TODAS)).toMatchObject({ ok: true });
  });

  it('mover_etapa respeita as etapas permitidas', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('mover_etapa', { etapa: 'Proposta' }, { ...CTX, etapasPermitidas: ['00000000-0000-4000-8000-0000000000aa'] }, TODAS);
    expect(r).toMatchObject({ ok: false });
    expect(r.erro).toContain('não permitida');
    const ok = await f.svc.executar('mover_etapa', { etapa: 'qualificado' }, CTX, TODAS);
    expect(ok).toMatchObject({ ok: true, dados: { etapa: 'Qualificado' } });
  });

  it('regra SE/ENTÃO usa a ferramenta equivalente com as mesmas permissões', async () => {
    const f = ferramentas();
    expect(await f.svc.executarAcaoRegra({ tipo: 'adicionar_tag', valor: 'quente' }, CTX, new Set())).toMatchObject({ resultado: { ok: false } });
    expect(await f.svc.executarAcaoRegra({ tipo: 'adicionar_tag', valor: 'quente' }, CTX, TODAS)).toMatchObject({ acao: 'adicionar_tag', resultado: { ok: true } });
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

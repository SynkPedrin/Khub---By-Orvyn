import { Prisma } from '@prisma/client';
import { AgentRuntimeService, historicoParaModelo, montarPrompt, type ConfigAgente } from './agent-runtime.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AnthropicProvider, RespostaLLM } from '../ai/anthropic.provider';
import type { AgentToolsService } from './agent-tools.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { AtendimentoService } from '../crm/messaging/atendimento.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

const AGENTE = {
  id: 'ag1',
  tenantId: TENANT,
  nome: 'Lia',
  descricao: null,
  status: 'ativo',
  modelo: 'claude-opus-5-5',
  instrucoes: 'Atenda pacientes da Clínica Aurora e qualifique para consulta.',
  tom: 'cordial',
  personalidade: '',
  ferramentas: ['buscar_conhecimento', 'adicionar_nota'],
  conhecimentoAtivo: true,
  conhecimentoEscopos: ['tenant'],
  maxRespostasConversa: 20,
  maxCaracteres: 600,
  canais: ['WhatsApp'],
  padrao: true,
};

function resp(texto: string, toolCalls: RespostaLLM['toolCalls'] = [], pararPor = 'end_turn', extras: unknown[] = []): RespostaLLM {
  return {
    texto,
    toolCalls,
    pararPor,
    modelo: 'claude-opus-5-5',
    uso: { entrada: 100, saida: 20, cache: 0, custoUsd: 0.0008 },
    blocos: [...extras, ...(texto ? [{ type: 'text', text: texto }] : []), ...toolCalls.map((c) => ({ type: 'tool_use', id: c.id, name: c.nome, input: c.args }))],
  };
}

function ambiente(o: {
  atendimento?: 'ia' | 'humano';
  autorTipo?: string;
  agente?: Partial<typeof AGENTE> | null;
  configurado?: boolean;
  respostasIa?: number;
  maisNova?: boolean;
  runExiste?: boolean;
  optout?: boolean;
  respostas?: (RespostaLLM | Error)[];
} = {}) {
  const runs: Record<string, unknown>[] = [];
  const tx = {
    message: {
      findUnique: jest.fn(async () => ({ id: 'm1', autorTipo: o.autorTipo ?? 'contato', conversationId: 'cv1', createdAt: new Date('2026-11-06T10:00:00Z') })),
      findFirst: jest.fn(async () => (o.maisNova ? { id: 'm2' } : null)),
      count: jest.fn(async () => o.respostasIa ?? 0),
      findMany: jest.fn(async () => [{ autorTipo: 'contato', corpo: 'Oi, quanto custa a consulta?' }]),
    },
    conversation: { findUnique: jest.fn(async () => ({ id: 'cv1', atendimento: o.atendimento ?? 'ia', agentId: 'ag1', contactId: 'c1' })) },
    agent: { findUnique: jest.fn(async () => (o.agente === null ? null : { ...AGENTE, ...o.agente })) },
    contact: { findUnique: jest.fn(async () => ({ nome: 'Marina', optedOutAt: o.optout ? new Date() : null })) },
    tenant: { findUnique: jest.fn(async () => ({ nome: 'Clínica Aurora', nicho: null, subespecialidade: null })) },
    agentRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (o.runExiste) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
        runs.push({ id: 'r1', ...data });
        return { id: 'r1' };
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(runs[0], data)),
    },
    aiUsageEvent: { create: jest.fn(async () => ({})) },
    nyroGuardrailHit: { create: jest.fn(async () => ({})) },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const fila = [...(o.respostas ?? [resp('Olá, Marina! A consulta custa R$ 350.')])];
  const llm = {
    configured: () => o.configurado ?? true,
    missing: () => (o.configurado === false ? ['ANTHROPIC_API_KEY'] : []),
    conversar: jest.fn(async () => {
      const r = fila.shift();
      if (r instanceof Error) throw r;
      return r ?? resp('');
    }),
  } as unknown as AnthropicProvider;
  const tools = {
    executar: jest.fn(async (nome: string) =>
      nome === 'transferir_para_humano'
        ? { ok: true, dados: { transferindo: true }, transferir: { motivo: 'contato pediu uma pessoa' } }
        : { ok: true, dados: { trechos: [{ fonte: 'Tabela', texto: 'Consulta: R$ 350' }] }, fontes: [{ chunkId: 'k1', titulo: 'Tabela', escopo: 'tenant' }] },
    ),
  } as unknown as AgentToolsService;
  const mensagens = { send: jest.fn(async () => ({ id: 'resp1' })) } as unknown as MessagesService;
  const atendimento = { transferirParaHumano: jest.fn(async () => ({})) } as unknown as AtendimentoService;
  const svc = new AgentRuntimeService(prisma, llm, tools, mensagens, atendimento);
  return { svc, tx, llm, tools, mensagens, atendimento, runs };
}

const JOB = { tenantId: TENANT, messageId: 'm1' };

describe('AgentRuntimeService.responder — quando o agente NÃO fala', () => {
  it('conversa com humano: não chama o modelo nem abre run', async () => {
    const a = ambiente({ atendimento: 'humano' });
    await expect(a.svc.responder(JOB)).resolves.toBe('nada');
    expect(a.llm.conversar).not.toHaveBeenCalled();
    expect(a.tx.agentRun.create).not.toHaveBeenCalled();
  });

  it('mensagem que não é do contato (resposta da IA/humano) nunca dispara o agente — sem loop', async () => {
    const a = ambiente({ autorTipo: 'ia' });
    await expect(a.svc.responder(JOB)).resolves.toBe('nada');
    expect(a.llm.conversar).not.toHaveBeenCalled();
  });

  it('mesma mensagem entregue duas vezes: o segundo job não responde (idempotência)', async () => {
    const a = ambiente({ runExiste: true });
    await expect(a.svc.responder(JOB)).resolves.toBe('duplicado');
    expect(a.llm.conversar).not.toHaveBeenCalled();
    expect(a.mensagens.send).not.toHaveBeenCalled();
  });

  it('rajada: se já chegou mensagem mais nova do contato, esta é ignorada sem ir ao modelo', async () => {
    const a = ambiente({ maisNova: true });
    await expect(a.svc.responder(JOB)).resolves.toBe('ignorado');
    expect(a.llm.conversar).not.toHaveBeenCalled();
  });

  it('contato que optou por sair não recebe resposta', async () => {
    const a = ambiente({ optout: true });
    await expect(a.svc.responder(JOB)).resolves.toBe('ignorado');
    expect(a.mensagens.send).not.toHaveBeenCalled();
    expect(a.atendimento.transferirParaHumano).not.toHaveBeenCalled();
  });
});

describe('AgentRuntimeService.responder — o lead nunca fica sem dono', () => {
  it('sem ANTHROPIC_API_KEY: transfere para humano com o motivo explícito, sem resposta simulada', async () => {
    const a = ambiente({ configurado: false });
    await expect(a.svc.responder(JOB)).resolves.toBe('transferido');
    expect(a.llm.conversar).not.toHaveBeenCalled();
    expect(a.mensagens.send).not.toHaveBeenCalled();
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('ANTHROPIC_API_KEY'), { tipo: 'ia', agentId: 'ag1' });
    expect(a.runs[0]).toMatchObject({ status: 'transferido' });
  });

  it('agente pausado: transfere', async () => {
    const a = ambiente({ agente: { status: 'pausado' } });
    await expect(a.svc.responder(JOB)).resolves.toBe('transferido');
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('indisponível'), expect.anything());
  });

  it('limite de respostas da IA atingido: transfere', async () => {
    const a = ambiente({ agente: { maxRespostasConversa: 3 }, respostasIa: 3 });
    await expect(a.svc.responder(JOB)).resolves.toBe('transferido');
    expect(a.llm.conversar).not.toHaveBeenCalled();
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('limite de 3'), expect.anything());
  });

  it('recusa do modelo (stop_reason refusal): transfere sem enviar nada', async () => {
    const a = ambiente({ respostas: [resp('', [], 'refusal')] });
    await expect(a.svc.responder(JOB)).resolves.toBe('transferido');
    expect(a.mensagens.send).not.toHaveBeenCalled();
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('recusou'), expect.anything());
  });

  it('erro do provedor: marca erro e transfere', async () => {
    const a = ambiente({ respostas: [new Error('Anthropic 529: overloaded')] });
    await expect(a.svc.responder(JOB)).resolves.toBe('erro');
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('falha ao gerar resposta'), expect.anything());
    expect(a.runs[0]).toMatchObject({ status: 'erro' });
  });
});

describe('AgentRuntimeService.responder — resposta', () => {
  it('envia como IA, com idempotência agent:<messageId>, effort low e fallback de recusa', async () => {
    const a = ambiente();
    await expect(a.svc.responder(JOB)).resolves.toBe('respondido');
    expect(a.mensagens.send).toHaveBeenCalledWith(TENANT, 'cv1', 'Olá, Marina! A consulta custa R$ 350.', 'agent:m1', undefined, { tipo: 'ia', agentId: 'ag1' });
    expect(a.llm.conversar).toHaveBeenCalledWith(expect.objectContaining({ modelo: 'claude-opus-5-5', effort: 'low', fallbackRecusa: true }));
    expect(a.runs[0]).toMatchObject({ status: 'respondido', respostaMessageId: 'resp1', modelo: 'claude-opus-5-5' });
    expect(a.tx.aiUsageEvent.create).toHaveBeenCalled();
  });

  it('corta a mensagem no limite de caracteres do agente', async () => {
    const longo = 'A consulta custa R$ 350 e inclui retorno em 30 dias. '.repeat(10);
    const a = ambiente({ agente: { maxCaracteres: 100 }, respostas: [resp(longo)] });
    await a.svc.responder(JOB);
    const enviado = (a.mensagens.send as jest.Mock).mock.calls[0][2] as string;
    expect(enviado.length).toBeLessThanOrEqual(101);
  });

  it('no loop de tools, o turno do assistente volta INTACTO (thinking incluso)', async () => {
    const pensamento = { type: 'thinking', thinking: '', signature: 'sig-abc' };
    const primeira = resp('', [{ id: 'tu1', nome: 'buscar_conhecimento', args: { pergunta: 'preço da consulta' } }], 'tool_use', [pensamento]);
    const a = ambiente({ respostas: [primeira, resp('A consulta custa R$ 350.')] });
    await a.svc.responder(JOB);
    const segunda = (a.llm.conversar as jest.Mock).mock.calls[1][0] as { mensagens: { role: string; content: unknown }[] };
    const turnoAssistente = segunda.mensagens.find((m) => m.role === 'assistant');
    expect(turnoAssistente?.content).toEqual(primeira.blocos);
    expect((turnoAssistente?.content as unknown[])[0]).toEqual(pensamento);
    expect(a.runs[0]).toMatchObject({ fontes: [{ chunkId: 'k1', titulo: 'Tabela', escopo: 'tenant' }] });
  });

  it('pedido de transferência: envia o aviso e depois transfere', async () => {
    const pedido = resp('Vou te passar para alguém da equipe.', [{ id: 'tu1', nome: 'transferir_para_humano', args: { motivo: 'pediu pessoa' } }], 'tool_use');
    const a = ambiente({ respostas: [pedido, resp('')] });
    await expect(a.svc.responder(JOB)).resolves.toBe('transferido');
    expect(a.mensagens.send).toHaveBeenCalledWith(TENANT, 'cv1', 'Vou te passar para alguém da equipe.', 'agent:m1', undefined, expect.anything());
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', 'contato pediu uma pessoa', { tipo: 'ia', agentId: 'ag1' });
  });
});

describe('montarPrompt / historicoParaModelo', () => {
  const cfg = { ...AGENTE } as unknown as ConfigAgente;

  it('regras fixas vêm ANTES das instruções do cliente, que ficam delimitadas', () => {
    const p = montarPrompt(cfg, { empresa: 'Clínica Aurora', nicho: null, contatoNome: 'Marina' });
    expect(p.indexOf('REGRAS FIXAS')).toBeGreaterThan(-1);
    expect(p.indexOf('REGRAS FIXAS')).toBeLessThan(p.indexOf('<instrucoes>'));
    expect(p).toContain('Atenda pacientes da Clínica Aurora');
    expect(p).toContain('no máximo 600 caracteres');
    expect(p).toContain('CONTATO: Marina');
  });

  it('histórico começa e termina no contato e junta autores consecutivos', () => {
    const h = historicoParaModelo([
      { autorTipo: 'ia', corpo: 'Olá! Sou a Lia.' },
      { autorTipo: 'contato', corpo: 'oi' },
      { autorTipo: 'contato', corpo: 'quanto custa?' },
      { autorTipo: 'humano', corpo: 'Já te respondo' },
      { autorTipo: 'contato', corpo: 'ok' },
    ]);
    expect(h).toEqual([
      { role: 'user', content: 'oi\nquanto custa?' },
      { role: 'assistant', content: '(atendente da equipe) Já te respondo' },
      { role: 'user', content: 'ok' },
    ]);
  });
});

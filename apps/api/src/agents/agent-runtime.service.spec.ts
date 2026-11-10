import { Prisma } from '@prisma/client';
import { AgentRuntimeService } from './agent-runtime.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AtendimentoService } from '../crm/messaging/atendimento.service';
import type { DeliveryService } from './delivery/delivery.service';
import type { FollowupService } from './followup/followup.service';
import type { IntelligenceCoreService, ResultadoCore } from './intelligence/intelligence-core.service';
import type { MemoryService } from './intelligence/memory.service';
import { perfilVazio, type ProfileService } from './intelligence/profile.service';
import type { KnowledgeService } from './knowledge/knowledge.service';
import type { LearningService } from './learning/learning.service';
import type { VersioningService } from './versioning/versioning.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { ConfigHorario } from './config/horario';
import { configPadrao } from './config/agent-config';
import { analisarHeuristica } from './engines/analysis';

const TENANT = '11111111-1111-1111-1111-111111111111';
const AGENTE = { id: 'ag1', nome: 'Lia', status: 'ativo', modelo: 'claude-opus-5-5', config: {}, versaoPublicadaId: null };

function resultado(o: Partial<ResultadoCore> = {}): ResultadoCore {
  const analise = analisarHeuristica('quanto custa a consulta?');
  return {
    decisao: 'responder',
    motivo: null,
    analise,
    regras: { disparadas: [], instrucoes: [], acoes: [], iniciarFollowup: null },
    conhecimento: { consulta: null, fontes: [], confianca: null, conflitos: [], latenciaMs: 0 },
    memoria: { resumo: false, longoPrazo: 0, operacional: 0 },
    extracoes: [],
    ferramentas: [],
    textoBruto: 'Olá!\n\nA consulta custa R$ 350.',
    texto: 'Olá!\n\nA consulta custa R$ 350.',
    validacao: [],
    guardrail: null,
    fragmentacao: { blocos: [{ ordem: 1, texto: 'Olá!', atrasoMs: 1200 }, { ordem: 2, texto: 'A consulta custa R$ 350.', atrasoMs: 1200 }], estrategia: 'semantica', ajustes: [] },
    modelo: 'claude-opus-5-5',
    modelos: ['claude-opus-5-5'],
    tokensEntrada: 100,
    tokensSaida: 20,
    custoUsd: 0.001,
    tempos: { analiseMs: 1, conhecimentoMs: 1, geracaoMs: 1, totalMs: 3 },
    ...o,
  };
}

function ambiente(o: {
  atendimento?: 'ia' | 'humano';
  autorTipo?: string;
  agente?: Record<string, unknown> | null;
  respostasIa?: number;
  maisNova?: boolean;
  runExiste?: boolean;
  optout?: boolean;
  custoConversa?: number;
  core?: ResultadoCore | Error;
  horario?: Partial<ConfigHorario>;
} = {}) {
  const runs: Record<string, unknown>[] = [];
  const tx = {
    message: {
      findUnique: jest.fn(async () => ({ id: 'm1', autorTipo: o.autorTipo ?? 'contato', conversationId: 'cv1', createdAt: new Date('2026-11-06T10:00:00Z') })),
      findFirst: jest.fn(async () => (o.maisNova ? { id: 'm2' } : null)),
      findMany: jest.fn(async () => [{ autorTipo: 'contato', corpo: 'Oi, quanto custa a consulta?' }]),
    },
    conversation: { findUnique: jest.fn(async () => ({ id: 'cv1', atendimento: o.atendimento ?? 'ia', agentId: 'ag1', contactId: 'c1' })) },
    agent: { findUnique: jest.fn(async () => (o.agente === null ? null : { ...AGENTE, ...o.agente })) },
    contact: { findUnique: jest.fn(async () => ({ nome: 'Marina', optedOutAt: o.optout ? new Date() : null })) },
    tenant: { findUnique: jest.fn(async () => ({ nome: 'Clínica Aurora', nicho: null, subespecialidade: null })) },
    agentIntentCategory: { findMany: jest.fn(async () => []) },
    agentFollowupRule: { findMany: jest.fn(async () => [{ id: 'regra-resp' }]) },
    agentFollowup: { updateMany: jest.fn(async () => ({ count: 1 })) },
    agentRun: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (o.runExiste) throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.22.0' });
        runs.push({ id: 'r1', ...data });
        return { id: 'r1' };
      }),
      count: jest.fn(async () => o.respostasIa ?? 0),
      findMany: jest.fn(async () => (o.custoConversa ? [{ trace: {}, custoUsd: new Prisma.Decimal(o.custoConversa) }] : [])),
      aggregate: jest.fn(async () => ({ _sum: { custoUsd: null } })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(runs[0], data)),
    },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const core = {
    processar: jest.fn(async () => {
      if (o.core instanceof Error) throw o.core;
      return o.core ?? resultado();
    }),
    registrarUso: jest.fn(async () => undefined),
  } as unknown as IntelligenceCoreService;
  const atendimento = { transferirParaHumano: jest.fn(async () => ({})) } as unknown as AtendimentoService;
  const entregas = { enfileirar: jest.fn(async () => ({ sequenciaId: 'seq1', blocos: 2, duplicado: false })), cancelarPendentes: jest.fn(async () => 2) } as unknown as DeliveryService;
  const followups = { agendarAposResposta: jest.fn(async () => ({ agendado: true })) } as unknown as FollowupService;
  const memoria = { contexto: jest.fn(async () => ({ resumoConversa: null, longoPrazo: [], operacional: [] })), registrarOperacional: jest.fn(async () => undefined), atualizarResumo: jest.fn(async () => ({ atualizado: false, custoUsd: 0 })) } as unknown as MemoryService;
  const perfis = { carregar: jest.fn(async () => perfilVazio('c1')) } as unknown as ProfileService;
  const conhecimento = { documentosDoAgente: jest.fn(async () => null) } as unknown as KnowledgeService;
  const versoes = {
    efetivo: jest.fn(async () => ({ id: 'ag1', nome: 'Lia', modelo: 'claude-opus-5-5', instrucoes: 'x'.repeat(30), tom: 'cordial', personalidade: '', ferramentas: [], conhecimentoAtivo: true, conhecimentoEscopos: ['tenant'], maxCaracteres: 600, maxRespostasConversa: 20, config: { ...configPadrao(), horario: { ...configPadrao().horario, ...o.horario } }, versionId: 'v3' })),
  } as unknown as VersioningService;
  const aprendizado = { registrar: jest.fn(async () => undefined) } as unknown as LearningService;
  const mensagens = { send: jest.fn(async () => ({ id: 'msg-aviso', status: 'sent' })) } as unknown as MessagesService;
  const svc = new AgentRuntimeService(prisma, core, atendimento, entregas, followups, memoria, perfis, conhecimento, versoes, aprendizado, mensagens);
  return { svc, tx, runs, core, atendimento, entregas, followups, aprendizado, mensagens };
}

const JOB = { tenantId: TENANT, messageId: 'm1' };

describe('AgentRuntimeService — orquestração do atendimento', () => {
  it('mensagem que não é do contato não dispara nada', async () => {
    const a = ambiente({ autorTipo: 'ia' });
    expect(await a.svc.responder(JOB)).toBe('nada');
    expect(a.core.processar).not.toHaveBeenCalled();
  });

  it('nova mensagem do contato INTERROMPE blocos e follow-ups pendentes, mesmo com humano no comando', async () => {
    const a = ambiente({ atendimento: 'humano' });
    expect(await a.svc.responder(JOB)).toBe('nada');
    expect(a.entregas.cancelarPendentes).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('nova mensagem'));
    expect(a.tx.agentFollowup.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ contactId: 'c1', status: 'agendado', ruleId: { in: ['regra-resp'] } }) }));
  });

  it('mesma mensagem entregue duas vezes não gera segunda resposta', async () => {
    const a = ambiente({ runExiste: true });
    expect(await a.svc.responder(JOB)).toBe('duplicado');
    expect(a.core.processar).not.toHaveBeenCalled();
  });

  it('rajada: só a mensagem mais nova responde', async () => {
    const a = ambiente({ maisNova: true });
    expect(await a.svc.responder(JOB)).toBe('ignorado');
    expect(a.core.processar).not.toHaveBeenCalled();
  });

  it('agente pausado → humano', async () => {
    const a = ambiente({ agente: { status: 'pausado' } });
    expect(await a.svc.responder(JOB)).toBe('transferido');
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalled();
  });

  it('opt-out → não responde', async () => {
    const a = ambiente({ optout: true });
    expect(await a.svc.responder(JOB)).toBe('ignorado');
  });

  it('limite de respostas → humano', async () => {
    const a = ambiente({ respostasIa: 20 });
    expect(await a.svc.responder(JOB)).toBe('transferido');
  });

  it('orçamento de IA da conversa esgotado → humano com motivo', async () => {
    const a = ambiente({ custoConversa: 1.5 });
    expect(await a.svc.responder(JOB)).toBe('transferido');
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('orçamento'), expect.anything());
  });

  it('resposta: blocos vão para a FILA (idempotente pela mensagem), run grava a decisão e follow-up é agendado', async () => {
    const a = ambiente();
    expect(await a.svc.responder(JOB)).toBe('respondido');
    expect(a.entregas.enfileirar).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'cv1', runId: 'r1', chaveBase: 'agent:m1', blocos: expect.arrayContaining([expect.objectContaining({ ordem: 2 })]) }));
    expect(a.runs[0]).toMatchObject({ status: 'respondido', versionId: 'v3', intencao: 'orcamento', blocos: 2 });
    expect((a.runs[0].trace as { fragmentacao: { blocos: unknown[] } }).fragmentacao.blocos).toHaveLength(2);
    expect(a.followups.agendarAposResposta).toHaveBeenCalledWith(TENANT, expect.objectContaining({ agentId: 'ag1', contactId: 'c1', intencao: 'orcamento' }));
    expect(a.aprendizado.registrar).toHaveBeenCalled();
  });

  it('transferência decidida pelo agente: avisa (blocos) e passa para humano, sem follow-up', async () => {
    const a = ambiente({ core: resultado({ decisao: 'transferir', motivo: 'contato pediu uma pessoa' }) });
    expect(await a.svc.responder(JOB)).toBe('transferido');
    expect(a.entregas.enfileirar).toHaveBeenCalled();
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', 'contato pediu uma pessoa', expect.anything());
    expect(a.followups.agendarAposResposta).not.toHaveBeenCalled();
  });

  it('regra de silêncio: não envia nada', async () => {
    const a = ambiente({ core: resultado({ decisao: 'silenciar', motivo: 'regra: fora do escopo', fragmentacao: { blocos: [], estrategia: 'unica', ajustes: [] } }) });
    expect(await a.svc.responder(JOB)).toBe('ignorado');
    expect(a.entregas.enfileirar).not.toHaveBeenCalled();
  });

  it('falha do core → lead vai para humano e o run registra erro', async () => {
    const a = ambiente({ core: new Error('Anthropic 529: overloaded') });
    expect(await a.svc.responder(JOB)).toBe('erro');
    expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('falha ao gerar resposta'), expect.anything());
    expect(a.runs[0]).toMatchObject({ status: 'erro' });
  });

  describe('horário de atendimento (ADR-0042)', () => {
    // Terça 2026-11-10 às 23:00 em São Paulo = 02:00 UTC de quarta.
    const NOITE = new Date('2026-11-11T02:00:00Z');
    const fechado = { ativo: true, fuso: 'America/Sao_Paulo' } as const;
    beforeEach(() => jest.useFakeTimers({ now: NOITE, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] }));
    afterEach(() => jest.useRealTimers());

    it('desligado (padrão): responde a qualquer hora', async () => {
      const a = ambiente();
      expect(await a.svc.responderOuAdiar(JOB)).toEqual({ desfecho: 'respondido' });
    });

    it('fora do horário: adia para a abertura sem abrir run nem chamar o modelo', async () => {
      const a = ambiente({ horario: { ...fechado, foraDoHorario: 'responder_na_abertura' } });
      const r = await a.svc.responderOuAdiar(JOB);
      expect(r.desfecho).toBe('adiado');
      // Quarta 08:00 em SP = 11:00 UTC (+ folga de rajada).
      expect(r.adiarAte!.getTime()).toBe(new Date('2026-11-11T11:00:00Z').getTime() + 4000);
      expect(a.runs).toHaveLength(0);
      expect(a.core.processar).not.toHaveBeenCalled();
      expect(a.mensagens.send).not.toHaveBeenCalled();
    });

    it('avisar e responder na abertura: manda UM aviso idempotente pela abertura', async () => {
      const a = ambiente({ horario: { ...fechado, foraDoHorario: 'avisar_e_responder_na_abertura' } });
      const r = await a.svc.responderOuAdiar(JOB);
      expect(r.desfecho).toBe('adiado');
      expect(a.mensagens.send).toHaveBeenCalledWith(TENANT, 'cv1', expect.stringContaining('amanhã às 08:00'), 'agent-fora:cv1:2026-11-11T11:00:00.000Z', undefined, { tipo: 'ia', agentId: 'ag1' });
    });

    it('transferir para a equipe: passa para humano com motivo explícito', async () => {
      const a = ambiente({ horario: { ...fechado, foraDoHorario: 'transferir_para_equipe' } });
      expect(await a.svc.responderOuAdiar(JOB)).toEqual({ desfecho: 'transferido' });
      expect(a.atendimento.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'cv1', 'fora do horário de atendimento do agente', expect.anything());
      expect(a.core.processar).not.toHaveBeenCalled();
    });

    it('dentro do horário: responde normalmente', async () => {
      jest.setSystemTime(new Date('2026-11-10T15:00:00Z')); // terça 12:00 em SP
      const a = ambiente({ horario: fechado });
      expect(await a.svc.responderOuAdiar(JOB)).toEqual({ desfecho: 'respondido' });
    });
  });
});

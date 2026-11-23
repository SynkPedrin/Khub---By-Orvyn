import { MODELO_PADRAO } from './catalogo';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AgentsService } from './agents.service';
import type { SalaoAgendaService } from './salao/salao-agenda.service';
import { AgentToolsService, type ContextoAgente } from './agent-tools.service';
import { cortarNoLimite, ferramentasDoAgente, paraJsonSchema, FERRAMENTAS_POR_NOME } from './catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { AgentLlm } from '../ai/provider.contract';
import type { AiProviderRegistry } from '../ai/provider.registry';
import type { EvaluationService } from './evaluation/evaluation.service';
import type { AgendaService } from '../agenda/agenda.service';
import type { WorkflowsService } from '../automations/workflows.service';
import type { FinanceiroService } from '../financeiro/financeiro.service';
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

  it('agente nasce como rascunho com o modelo padrão (Sonnet 5.5, decisão de 2026-11-13)', async () => {
    const { svc, tx } = servico();
    const a = await svc.criar(TENANT, ADMIN, { nome: 'Lia' });
    expect(a).toMatchObject({ status: 'rascunho', modelo: MODELO_PADRAO });
    expect(MODELO_PADRAO).toBe('claude-sonnet-5-5');
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
    tenant: { findUnique: jest.fn(async () => ({ settings: {} })) },
    task: { findFirst: jest.fn(async ({ where }: { where: { id: string; contactId: string } }) => (where.id === '00000000-0000-4000-8000-000000000001' ? { id: where.id } : null)) },
    stage: { findMany: jest.fn(async () => [{ id: '00000000-0000-4000-8000-0000000000aa', nome: 'Qualificado' }, { id: '00000000-0000-4000-8000-0000000000bb', nome: 'Proposta' }]) },
    deal: { findFirst: jest.fn(async () => ({ id: 'd1' })) },
    agentToolExecution: { create: jest.fn(async () => ({ id: 'ex1' })), updateMany: jest.fn(async () => ({ count: 1 })) },
    agendaCompromisso: { findMany: jest.fn(async () => []), findFirst: jest.fn(async () => null) },
    financeiroCobranca: { findFirst: jest.fn(async () => null), create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'cb1', ...data })) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
  const crm = { updateContact: jest.fn(async () => ({ ok: true })), moveDeal: jest.fn(async () => ({ ok: true })), createDeal: jest.fn(async () => ({ id: 'd2' })) } as unknown as CrmService;
  const notas = { create: jest.fn(async () => ({ id: 'n1' })) } as unknown as NotesService;
  const tarefas = { create: jest.fn(async () => ({ id: 't1' })), update: jest.fn(async () => ({ ok: true })) } as unknown as TasksService;
  const agenda = {
    criar: jest.fn(async (_t: string, _i: string, dto: { inicio: string }) => ({ id: 'cp1', inicio: new Date(dto.inicio) })),
    sugerirHorarios: jest.fn(async () => []),
    listar: jest.fn(async () => []),
    atualizar: jest.fn(async (_t: string, _i: string, _id: string, dto: { inicio: string }) => ({ id: 'cp1', inicio: new Date(dto.inicio), status: 'agendado' })),
    atualizarStatus: jest.fn(async () => ({ id: 'cp1', status: 'cancelado' })),
  } as unknown as AgendaService;
  const workflows = { dispararPorAgente: jest.fn(async () => ({ runId: 'r1' })) } as unknown as WorkflowsService;
  const rag = { searchAgente: jest.fn(async () => []) } as unknown as RetrievalService;
  const financeiro = { criar: jest.fn(async (_t: string, _i: string, dto: Record<string, unknown>) => ({ id: 'cb1', ...dto })) } as unknown as FinanceiroService;
  const salao = { horarios: jest.fn(), reservar: jest.fn() } as unknown as SalaoAgendaService;
  return { svc: new AgentToolsService(prisma, crm, notas, tarefas, agenda, workflows, rag, financeiro, salao), tx, crm, notas, tarefas, workflows, rag, agenda, financeiro, salao };
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

// ------------------------------------------------------------------ agenda do agente (respeito às faixas)

import { instanteLocal } from '../booking/booking.schema';
import { horarioSchema } from './config/horario';

const SP = 'America/Sao_Paulo';
const horarioPadrao = () => horarioSchema.parse({});

/** Próxima data (YYYY-MM-DD) que cai no dia da semana pedido, ao menos 7 dias à frente. */
function proximoDiaDaSemana(dow: number, minimoDias = 7): string {
  const d = new Date(Date.now() + minimoDias * 86_400_000);
  const delta = (dow - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + delta)).toISOString().slice(0, 10);
}
const horaLocalSP = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: SP, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('ferramentas de agenda respeitam o horário do agente', () => {
  it('ver_agendamentos oferece só horários dentro das faixas (segunda 08:00–18:00)', async () => {
    const f = ferramentas();
    const data = proximoDiaDaSemana(1);
    const r = await f.svc.executar('ver_agendamentos', { data, duracaoMin: 60 }, { ...CTX, horario: horarioPadrao() }, TODAS);
    const livres = (r.dados as { horariosLivres: { inicio: string }[] }).horariosLivres;
    expect(livres.length).toBeGreaterThan(0);
    expect(horaLocalSP(livres[0].inicio)).toBe('08:00');
    for (const s of livres) {
      const [h] = horaLocalSP(s.inicio).split(':').map(Number);
      expect(h).toBeGreaterThanOrEqual(8);
      expect(h).toBeLessThan(18);
    }
  });

  it('horário ocupado na agenda some da lista oferecida', async () => {
    const f = ferramentas();
    const data = proximoDiaDaSemana(1);
    const ini = instanteLocal(data, 10 * 60, SP);
    (f.agenda.listar as jest.Mock).mockResolvedValue([{ id: 'x', inicio: new Date(ini), fim: new Date(ini + 3_600_000), responsavelId: null }]);
    const r = await f.svc.executar('ver_agendamentos', { data, duracaoMin: 60 }, { ...CTX, horario: horarioPadrao() }, TODAS);
    const horas = (r.dados as { horariosLivres: { inicio: string }[] }).horariosLivres.map((s) => horaLocalSP(s.inicio));
    expect(horas).not.toContain('10:00');
    expect(horas).toContain('09:00');
  });

  it('domingo (fechado) e feriado não oferecem horário', async () => {
    const f = ferramentas();
    const domingo = proximoDiaDaSemana(0);
    const r1 = await f.svc.executar('ver_agendamentos', { data: domingo, duracaoMin: 60 }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect((r1.dados as { horariosLivres: unknown[] }).horariosLivres).toEqual([]);
    const segunda = proximoDiaDaSemana(1);
    const r2 = await f.svc.executar('ver_agendamentos', { data: segunda, duracaoMin: 60 }, { ...CTX, horario: horarioSchema.parse({ feriados: [segunda] }) }, TODAS);
    expect((r2.dados as { horariosLivres: unknown[] }).horariosLivres).toEqual([]);
  });

  it('solicitar_agendamento fora da faixa é recusado (nada é gravado)', async () => {
    const f = ferramentas();
    const data = proximoDiaDaSemana(1);
    const inicio = new Date(instanteLocal(data, 7 * 60, SP)).toISOString(); // 07:00, antes de abrir
    const r = await f.svc.executar('solicitar_agendamento', { inicio, duracaoMin: 60 }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('disponibilidade');
    expect((f.agenda.criar as jest.Mock)).not.toHaveBeenCalled();
  });

  it('solicitar_agendamento num horário livre cria pela AgendaService como IA', async () => {
    const f = ferramentas();
    const data = proximoDiaDaSemana(1);
    const inicio = new Date(instanteLocal(data, 9 * 60, SP)).toISOString();
    const r = await f.svc.executar('solicitar_agendamento', { inicio, duracaoMin: 60 }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(true);
    expect(f.agenda.criar).toHaveBeenCalledWith(TENANT, 'ag1', expect.objectContaining({ contactId: 'c1', inicio }), 'nyro');
  });

  it('sem config de horário, cai na janela genérica (comportamento anterior)', async () => {
    const f = ferramentas();
    (f.agenda.sugerirHorarios as jest.Mock).mockResolvedValue([{ inicio: '2026-11-20T12:00:00.000Z', fim: '2026-11-20T13:00:00.000Z' }]);
    const r = await f.svc.executar('ver_agendamentos', { data: '2026-11-20', duracaoMin: 60 }, CTX, TODAS);
    expect(f.agenda.sugerirHorarios).toHaveBeenCalledWith(TENANT, '2026-11-20', 60);
    expect((r.dados as { horariosLivres: unknown[] }).horariosLivres).toHaveLength(1);
  });

  it('grade fina (20 min) expõe o último horário que cabe no dia — regra da clínica', async () => {
    // Faixas do da clínica: 07:40–11:00 e 14:00–19:00, seg–sex.
    const horarioClinica = horarioSchema.parse({
      ativo: true,
      dias: {
        dom: [], sab: [],
        seg: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        ter: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qua: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qui: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        sex: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      },
    });
    const f = ferramentas();
    const data = proximoDiaDaSemana(1, 10);
    const solicita = async (hhmm: string, dur: number) => {
      const [h, m] = hhmm.split(':').map(Number);
      const inicio = new Date(instanteLocal(data, h * 60 + m, SP)).toISOString();
      return f.svc.executar('solicitar_agendamento', { inicio, duracaoMin: dur }, { ...CTX, horario: horarioClinica }, TODAS);
    };

    // Primeiro horário do dia aparece na listagem.
    const lista = (await f.svc.executar('ver_agendamentos', { data, duracaoMin: 100 }, { ...CTX, horario: horarioClinica }, TODAS)).dados as { horariosLivres: { inicio: string }[] };
    expect(horaLocalSP(lista.horariosLivres[0].inicio)).toBe('07:40');

    // Limites do fechamento às 19:00 (spec §12): aceita o último que cabe, recusa o seguinte.
    expect((await solicita('17:20', 100)).ok).toBe(true);  // 17:20 + 1h40 = 19:00
    expect((await solicita('17:40', 100)).ok).toBe(false); // terminaria 19:20
    expect((await solicita('17:40', 80)).ok).toBe(true);   // 17:40 + 1h20 = 19:00
    expect((await solicita('18:00', 80)).ok).toBe(false);  // terminaria 19:20
    expect((await solicita('18:20', 40)).ok).toBe(true);   // 18:20 + 40min = 19:00
    expect((await solicita('18:40', 40)).ok).toBe(false);  // terminaria 19:20

    // Almoço (11:00–14:00) e fora do expediente nunca são aceitos.
    expect((await solicita('10:20', 80)).ok).toBe(false);  // cruzaria o almoço
    expect((await solicita('13:00', 40)).ok).toBe(false);
    expect((await solicita('07:20', 40)).ok).toBe(false);  // antes de abrir
  });

  it('solicitar_agendamento grava os campos operacionais do contato', async () => {
    const f = ferramentas();
    const data = proximoDiaDaSemana(1);
    const inicio = new Date(instanteLocal(data, 9 * 60, SP)).toISOString();
    const r = await f.svc.executar('solicitar_agendamento', { inicio, duracaoMin: 80 }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(true);
    expect(f.crm.updateContact).toHaveBeenCalledWith(
      TENANT,
      'c1',
      expect.objectContaining({ camposCustom: expect.objectContaining({ carol_agendamento_id: 'cp1', carol_agendamento_status: 'agendado' }) }),
    );
  });

  it('sem duracaoMin, agenda usa a duração LONGA (100 min) como margem conservadora', async () => {
    const horarioClinica = horarioSchema.parse({
      ativo: true,
      dias: {
        dom: [], sab: [],
        seg: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        ter: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qua: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qui: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        sex: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      },
    });
    const f = ferramentas();
    const data = proximoDiaDaSemana(2, 10); // terça (evita a quinta, marcada como última opção de manhã)
    // Mock tenant sem settings → lerOperacao assume 100 min (duracaoConsultaLongaMin).
    const lista = (await f.svc.executar('ver_agendamentos', { data }, { ...CTX, horario: horarioClinica }, TODAS)).dados as {
      horariosLivres: { inicio: string }[];
      duracaoMinConsiderada: number;
    };
    expect(lista.duracaoMinConsiderada).toBe(100);
    const ultimos = lista.horariosLivres.map((s) => horaLocalSP(s.inicio));
    expect(ultimos).toContain('17:20'); // 100 min: último que cabe (termina 19:00)
    expect(ultimos).not.toContain('17:40'); // com 100 min terminaria 19:20

    const inicio = new Date(instanteLocal(data, 9 * 60, SP)).toISOString();
    const r = await f.svc.executar('solicitar_agendamento', { inicio }, { ...CTX, horario: horarioClinica }, TODAS);
    expect(r.ok).toBe(true);
    expect(f.agenda.criar).toHaveBeenCalledWith(TENANT, 'ag1', expect.objectContaining({ fim: new Date(+new Date(inicio) + 100 * 60_000).toISOString() }), 'nyro');
  });

  it('14h–15h, 17h+ e quinta de manhã são marcados ultimaOpcao e ordenados por último', async () => {
    const horarioClinica = horarioSchema.parse({
      ativo: true,
      dias: {
        dom: [], sab: [],
        seg: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        ter: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qua: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qui: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        sex: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      },
    });
    const f = ferramentas();
    const terca = proximoDiaDaSemana(2, 10);
    const lista = (await f.svc.executar('ver_agendamentos', { data: terca, duracaoMin: 80 }, { ...CTX, horario: horarioClinica }, TODAS)).dados as {
      horariosLivres: { inicio: string; ultimaOpcao?: boolean }[];
    };
    const livres = lista.horariosLivres;
    const marcados = livres.filter((s) => s.ultimaOpcao).map((s) => horaLocalSP(s.inicio));
    expect(marcados.length).toBeGreaterThan(0);
    for (const h of marcados) expect(h.startsWith('14:') || Number(h.split(':')[0]) >= 17).toBe(true);
    expect(marcados).toContain('17:40'); // 17h+ é última opção, mas CONTINUA oferecível
    // Nenhum horário preferido depois de um última-opção (ordenação).
    const primeiroUltima = livres.findIndex((s) => s.ultimaOpcao);
    expect(livres.slice(primeiroUltima).every((s) => s.ultimaOpcao)).toBe(true);

    const quinta = proximoDiaDaSemana(4, 10);
    const listaQui = (await f.svc.executar('ver_agendamentos', { data: quinta, duracaoMin: 80 }, { ...CTX, horario: horarioClinica }, TODAS)).dados as {
      horariosLivres: { inicio: string; ultimaOpcao?: boolean }[];
    };
    const quiManha = listaQui.horariosLivres.filter((s) => Number(horaLocalSP(s.inicio).split(':')[0]) < 11);
    expect(quiManha.length).toBeGreaterThan(0);
    expect(quiManha.every((s) => s.ultimaOpcao)).toBe(true);
  });

  it('horário pedido pelo contato: diz se está livre e ordena alternativas por proximidade', async () => {
    const horarioClinica = horarioSchema.parse({
      ativo: true,
      dias: {
        dom: [], sab: [],
        seg: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        ter: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qua: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        qui: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
        sex: [{ inicio: '07:40', fim: '11:00' }, { inicio: '14:00', fim: '19:00' }],
      },
    });
    const f = ferramentas();
    const data = proximoDiaDaSemana(2, 10);
    // Livre: 15:00 existe na grade de 20 min.
    const livre = (await f.svc.executar('ver_agendamentos', { data, horario: '15:00' }, { ...CTX, horario: horarioClinica }, TODAS)).dados as {
      solicitado: { horario: string; disponivel: boolean };
      horariosLivres: { inicio: string }[];
    };
    expect(livre.solicitado).toEqual({ horario: '15:00', disponivel: true });
    expect(horaLocalSP(livre.horariosLivres[0].inicio)).toBe('15:00'); // alternativas começam pelo pedido
    // Ocupado: compromisso 15:00–16:40 → 15:00 e 15:20 saem da grade.
    const ini = instanteLocal(data, 15 * 60, SP);
    (f.agenda.listar as jest.Mock).mockResolvedValue([{ id: 'x', inicio: new Date(ini), fim: new Date(ini + 100 * 60_000), responsavelId: null }]);
    const ocupado = (await f.svc.executar('ver_agendamentos', { data, horario: '15:00' }, { ...CTX, horario: horarioClinica }, TODAS)).dados as {
      solicitado: { horario: string; disponivel: boolean };
      horariosLivres: { inicio: string }[];
    };
    expect(ocupado.solicitado.disponivel).toBe(false);
    expect(horaLocalSP(ocupado.horariosLivres[0].inicio)).toBe('16:40'); // 15:00/15:20/15:40/16:00/16:20 colidem com o compromisso de 100 min
  });
});

// ------------------------------------------------------------------ remarcar / cancelar

describe('remarcar_agendamento / cancelar_agendamento — política da empresa', () => {
  const compromissoFuturo = (dias = 5) => ({ id: 'cp1', inicio: new Date(Date.now() + dias * 86_400_000), fim: new Date(Date.now() + dias * 86_400_000 + 80 * 60_000), status: 'agendado' });

  it('segunda remarcação é recusada e direciona para a equipe', async () => {
    const f = ferramentas({ nome: 'Marina', camposCustom: { carol_quantidade_remarcacoes: '1' } });
    (f.tx.agendaCompromisso.findFirst as jest.Mock).mockResolvedValue(compromissoFuturo());
    const data = proximoDiaDaSemana(1, 10);
    const inicio = new Date(instanteLocal(data, 9 * 60, SP)).toISOString();
    const r = await f.svc.executar('remarcar_agendamento', { inicio }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('limite');
    expect((f.agenda.atualizar as jest.Mock)).not.toHaveBeenCalled();
  });

  it('remarcar sem antecedência mínima é recusado', async () => {
    const f = ferramentas({ nome: 'Marina', camposCustom: {} });
    (f.tx.agendaCompromisso.findFirst as jest.Mock).mockResolvedValue(compromissoFuturo(0.5)); // daqui a 12h
    const data = proximoDiaDaSemana(1, 10);
    const inicio = new Date(instanteLocal(data, 9 * 60, SP)).toISOString();
    const r = await f.svc.executar('remarcar_agendamento', { inicio }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('antecedência');
    expect((f.agenda.atualizar as jest.Mock)).not.toHaveBeenCalled();
  });

  it('remarcação válida passa pela AgendaService como IA e conta a remarcação', async () => {
    const f = ferramentas({ nome: 'Marina', camposCustom: {} });
    (f.tx.agendaCompromisso.findFirst as jest.Mock).mockResolvedValue(compromissoFuturo(5));
    const data = proximoDiaDaSemana(1, 10);
    const inicio = new Date(instanteLocal(data, 9 * 60, SP)).toISOString();
    const r = await f.svc.executar('remarcar_agendamento', { inicio }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(true);
    expect(f.agenda.atualizar).toHaveBeenCalledWith(TENANT, 'ag1', 'cp1', expect.objectContaining({ inicio }), 'nyro');
    expect(f.crm.updateContact).toHaveBeenCalledWith(TENANT, 'c1', expect.objectContaining({ camposCustom: expect.objectContaining({ carol_quantidade_remarcacoes: 1 }) }));
  });

  it('remarcar para horário fora da disponibilidade é recusado', async () => {
    const f = ferramentas({ nome: 'Marina', camposCustom: {} });
    (f.tx.agendaCompromisso.findFirst as jest.Mock).mockResolvedValue(compromissoFuturo(5));
    const data = proximoDiaDaSemana(1, 10);
    const inicio = new Date(instanteLocal(data, 7 * 60, SP)).toISOString(); // 07:00, antes de abrir
    const r = await f.svc.executar('remarcar_agendamento', { inicio }, { ...CTX, horario: horarioPadrao() }, TODAS);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('disponibilidade');
  });

  it('cancelar exige compromisso DO contato e registra o motivo', async () => {
    const f = ferramentas();
    (f.tx.agendaCompromisso.findFirst as jest.Mock).mockResolvedValue(null);
    expect(await f.svc.executar('cancelar_agendamento', { motivo: 'não poderei ir' }, CTX, TODAS)).toMatchObject({ ok: false });

    (f.tx.agendaCompromisso.findFirst as jest.Mock).mockResolvedValue(compromissoFuturo(3));
    const r = await f.svc.executar('cancelar_agendamento', { motivo: 'não poderei ir' }, CTX, TODAS);
    expect(r.ok).toBe(true);
    expect(f.agenda.atualizarStatus).toHaveBeenCalledWith(TENANT, 'ag1', 'cp1', 'cancelado', 'nyro');
  });
});

// ------------------------------------------------------------------ sinal Pix

describe('sinal Pix — registrar e verificar (sem gateway: conciliação autorizada)', () => {
  const tenantComPix = { settings: { operacao: { sinalCentavos: 10000, consultaParticularCentavos: 40000, consultaConvenioCentavos: 30000, pix: { chave: 'pix@clinica.com', recebedor: 'da clínica', instrucoes: 'Envie o comprovante aqui.' } } } };

  it('registra a cobrança enviada e devolve os dados oficiais da conta', async () => {
    const f = ferramentas();
    (f.tx.tenant.findUnique as jest.Mock).mockResolvedValue(tenantComPix);
    const r = await f.svc.executar('registrar_sinal_pix', {}, CTX, TODAS);
    expect(r.ok).toBe(true);
    expect(f.financeiro.criar).toHaveBeenCalledWith(TENANT, 'ag1', expect.objectContaining({ valorCentavos: 10000, contactId: 'c1', enviar: true }), 'nyro');
    const d = r.dados as { pix: { chave: string } | null; cobrancaId: string };
    expect(d.pix?.chave).toBe('pix@clinica.com');
    expect(f.crm.updateContact).toHaveBeenCalledWith(TENANT, 'c1', expect.objectContaining({ camposCustom: expect.objectContaining({ carol_sinal_status: 'aguardando', carol_sinal_transacao_id: 'cb1' }) }));
  });

  it('sem chave Pix configurada, a cobrança existe mas NENHUMA chave é inventada', async () => {
    const f = ferramentas();
    (f.tx.tenant.findUnique as jest.Mock).mockResolvedValue({ settings: { operacao: { sinalCentavos: 10000 } } });
    const r = await f.svc.executar('registrar_sinal_pix', {}, CTX, TODAS);
    expect(r.ok).toBe(true);
    const d = r.dados as { pix: null; aviso: string };
    expect(d.pix).toBeNull();
    expect(d.aviso).toContain('NÃO configurados');
  });

  it('sem valor de sinal configurado, recusa em vez de inventar valor', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('registrar_sinal_pix', {}, CTX, TODAS);
    expect(r.ok).toBe(false);
    expect(r.erro).toContain('não configurado');
    expect(f.financeiro.criar).not.toHaveBeenCalled();
  });

  it('verificar_sinal sem cobrança responde nao_iniciado', async () => {
    const f = ferramentas();
    const r = await f.svc.executar('verificar_sinal', {}, CTX, TODAS);
    expect(r.dados).toMatchObject({ status: 'nao_iniciado' });
  });

  it('sinal aguardando NÃO confirma: comprovante do contato não vale', async () => {
    const f = ferramentas({ nome: 'Marina', camposCustom: { carol_sinal_transacao_id: 'cb1' } });
    (f.tx.financeiroCobranca.findFirst as jest.Mock).mockResolvedValue({ id: 'cb1', status: 'enviada', pagoEm: null });
    const r = await f.svc.executar('verificar_sinal', {}, CTX, TODAS);
    expect(r.dados).toMatchObject({ status: 'aguardando' });
    expect((r.dados as { aviso: string }).aviso).toContain('NÃO identificado');
  });

  it('sinal pago libera o agendamento e informa o saldo do dia', async () => {
    const f = ferramentas({ nome: 'Marina', camposCustom: { carol_sinal_transacao_id: 'cb1', carol_tem_plano_saude: 'true' } });
    (f.tx.tenant.findUnique as jest.Mock).mockResolvedValue(tenantComPix);
    (f.tx.financeiroCobranca.findFirst as jest.Mock).mockResolvedValue({ id: 'cb1', status: 'paga', pagoEm: new Date() });
    const r = await f.svc.executar('verificar_sinal', {}, CTX, TODAS);
    expect(r.dados).toMatchObject({ status: 'paga', saldoNoDiaCentavos: 20000 }); // convênio 300,00 − 100,00
    expect(f.crm.updateContact).toHaveBeenCalledWith(TENANT, 'c1', expect.objectContaining({ camposCustom: expect.objectContaining({ carol_sinal_status: 'confirmado' }) }));
  });
});

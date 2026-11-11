import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import { ExecutorService, type Contexto } from './executor.service';
import { ConfigService } from '../config/config.service';
import { RunsService, type PassoJob } from './runs.service';
import { PassosProcessor } from './automations.processor';
import { validarConfig, noRamificado, type Grafo, type No } from './catalogo';
import { eventoBate } from './eventos-espera';
import { converterValorCampo, lerNumero, ESPERA_META_MS } from './nos-motor';
import { agoraNoFuso, alvoComDeslocamento, instanteNoFuso, lerData, proximaJanela } from './tempo';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { TasksService } from '../crm/tasks.service';
import type { NotesService } from '../crm/notes.service';
import type { MailerService } from '../common/mailer.service';
import type { AiService } from '../ai/ai.service';
import type { CustomFieldsService } from '../crm/custom-fields.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { Queue } from 'bullmq';

const T = '11111111-1111-1111-1111-111111111111';
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const U2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const U3 = 'aaaaaaaa-0000-4000-8000-000000000003';
const WF = 'bbbbbbbb-0000-4000-8000-000000000001';
const WF2 = 'bbbbbbbb-0000-4000-8000-000000000002';
const STAGE = 'cccccccc-0000-4000-8000-000000000001';
const MOTIVO = 'dddddddd-0000-4000-8000-000000000001';

const no = (tipo: string, config: Record<string, unknown>, id = 'n1'): No => ({ id, tipo: tipo as No['tipo'], posicao: { x: 0, y: 0 }, config });
const GRAFO: Grafo = { nos: [], arestas: [] };
const contato = (extra: Partial<NonNullable<Contexto['contato']>> = {}): NonNullable<Contexto['contato']> => ({
  id: 'c1', nome: 'Ana Souza', email: 'ana@x.com', telefone: '5511999990000', empresa: null, tag: 'Lead', tags: ['vip'], valor: 0, ...extra,
});

/** tx mutável: cada teste ajusta só o que usa. */
function ambiente(tx: Record<string, unknown> = {}) {
  const base = {
    contact: { findUnique: jest.fn(async () => ({ id: 'c1', ownerId: null, tags: ['vip', 'lead'], optedOutAt: null })), update: jest.fn(async () => ({})) },
    deal: { findUnique: jest.fn(async () => null), findFirst: jest.fn(async () => null), update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'd1', titulo: 'Plano', valor: data.valor ?? 100, stageId: data.stageId ?? 's0', origem: null, status: data.status ?? 'aberto', ownerId: data.ownerId ?? null, camposCustom: data.camposCustom ?? {} })) },
    membership: { findMany: jest.fn(async () => [{ identityId: U1 }, { identityId: U2 }]), findUnique: jest.fn(async () => ({ id: 'm' })) },
    workflowRun: { updateMany: jest.fn(async () => ({ count: 2 })) },
    user: { findFirst: jest.fn(async () => ({ nome: 'Bia' })) },
    activity: { create: jest.fn(async () => ({})) },
    stage: { findUnique: jest.fn(async () => ({ id: STAGE, pipelineId: 'p1' })) },
    lostReason: { findUnique: jest.fn(async () => ({ id: MOTIVO, ativo: true })), count: jest.fn(async () => 0) },
    customFieldDef: { findMany: jest.fn(async () => [{ chave: 'plano', rotulo: 'Plano', tipo: 'text', opcoes: [], obrigatorio: false, arquivadoEm: null }]) },
    $queryRaw: jest.fn(async () => [{ contador: BigInt(1) }]),
    $executeRaw: jest.fn(async () => 1),
    ...tx,
  };
  const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(base)) } as unknown as PrismaService;
  const crm = { updateContact: jest.fn(async () => ({ ok: true })) } as unknown as CrmService;
  const camposCustom = {
    list: jest.fn(async () => [{ chave: 'interesses', tipo: 'multiselect' }, { chave: 'aniversario', tipo: 'date' }, { chave: 'ativo', tipo: 'boolean' }]),
    atualizarCamposContato: jest.fn(async (_t: string, _id: string, v: Record<string, unknown>) => ({ ok: true as const, alterados: Object.keys(v) })),
  } as unknown as CustomFieldsService;
  const mailer = { send: jest.fn(async () => ({ sent: true })) } as unknown as MailerService;
  const vazio = <X,>() => ({} as X);
  const svc = new ExecutorService(prisma, new ConfigService(), crm, vazio<MessagesService>(), vazio<TasksService>(), vazio<NotesService>(), mailer, vazio<AiService>(), camposCustom);
  return { svc, tx: base, crm, camposCustom, mailer };
}

// ---------------------------------------------------------------- catálogo
describe('Q3.1/Q3.2 · catálogo: configs tipadas validam no publish', () => {
  it('esperar até: data/campo/evento com defaults; campo de data fora da lista é recusado', () => {
    expect(validarConfig('controle.esperar_ate', { modo: 'data', data: '2026-12-01' })).toEqual({ ok: true, dados: { modo: 'data', data: '2026-12-01', hora: '09:00', seJaPassou: 'seguir' } });
    expect(validarConfig('controle.esperar_ate', { modo: 'campo', campo: 'agendamento.data' }).ok).toBe(true);
    expect(validarConfig('controle.esperar_ate', { modo: 'campo', campo: 'contato.campos.aniversario', deslocamento: 1, direcao: 'antes', hora: '08:30' }).ok).toBe(true);
    expect(validarConfig('controle.esperar_ate', { modo: 'campo', campo: 'contato.nome' }).ok).toBe(false);
    expect(validarConfig('controle.esperar_ate', { modo: 'evento', evento: 'tag_adicionada', tag: 'pagou', duracao: 2, unidade: 'dias' }).ok).toBe(true);
    expect(validarConfig('controle.esperar_ate', { modo: 'evento', evento: 'x', duracao: 2, unidade: 'dias' }).ok).toBe(false);
  });

  it('esperar até só é ramificado no modo evento', () => {
    expect(noRamificado(no('controle.esperar_ate', { modo: 'evento' }))).toBe(true);
    expect(noRamificado(no('controle.esperar_ate', { modo: 'data' }))).toBe(false);
  });

  it('refinamentos: atribuir sem usuário, rodízio repetido, negócio sem mudança, segmento sem filtro', () => {
    expect(validarConfig('acao.atribuir_usuario', { modo: 'fixo' }).ok).toBe(false);
    expect(validarConfig('acao.atribuir_usuario', { modo: 'rodizio', usuarios: [U1, U1] }).ok).toBe(false);
    expect(validarConfig('acao.atribuir_usuario', { modo: 'rodizio', usuarios: [U1, U2] }).ok).toBe(true);
    expect(validarConfig('acao.atualizar_negocio', {}).ok).toBe(false);
    expect(validarConfig('acao.atualizar_negocio', { status: 'ganho', motivoPerdaId: MOTIVO }).ok).toBe(false);
    expect(validarConfig('acao.atualizar_negocio', { status: 'perdido', motivoPerdaId: MOTIVO }).ok).toBe(true);
    expect(validarConfig('acao.remover_de_fluxo', { alvo: 'outros' }).ok).toBe(false);
    expect(validarConfig('gatilho.agendado', { alvo: 'segmento' }).ok).toBe(false);
    expect(validarConfig('gatilho.agendado', { frequencia: 'semanal', diasSemana: [] }).ok).toBe(false);
    expect(validarConfig('gatilho.agendado', { fuso: 'Marte/Olympus' }).ok).toBe(false);
    expect(validarConfig('gatilho.data_contato', { campo: 'contato.campos.aniversario', quando: 'antes', dias: 0 }).ok).toBe(false);
    expect(validarConfig('gatilho.data_contato', { campo: 'contato.campos.aniversario' }).ok).toBe(true);
  });

  it('atualizar contato: config legada (campo+valor) continua válida; vazio não', () => {
    expect(validarConfig('acao.atualizar_contato', { campo: 'tag', valor: 'Cliente' }).ok).toBe(true);
    expect(validarConfig('acao.atualizar_contato', {}).ok).toBe(false);
    expect(validarConfig('acao.atualizar_contato', { tagsAdicionar: ['x'] }).ok).toBe(true);
  });
});

// ------------------------------------------------------------------ tempo
describe('tempo no fuso do fluxo', () => {
  it('instanteNoFuso converte relógio de parede de São Paulo (UTC-3) para UTC', () => {
    expect(instanteNoFuso(2026, 11, 15, 9, 0, 'America/Sao_Paulo').toISOString()).toBe('2026-11-15T12:00:00.000Z');
  });

  it('próxima janela: diária, semanal e mensal com dia 31 em fevereiro', () => {
    const fuso = 'America/Sao_Paulo';
    const depois = new Date('2026-11-11T13:00:00Z'); // quarta 10:00 em SP
    expect(proximaJanela({ frequencia: 'diario', hora: '09:00', diasSemana: [], diaMes: 1 }, fuso, depois).toISOString()).toBe('2026-11-12T12:00:00.000Z');
    expect(proximaJanela({ frequencia: 'semanal', hora: '09:00', diasSemana: [1], diaMes: 1 }, fuso, depois).toISOString()).toBe('2026-11-16T12:00:00.000Z');
    expect(proximaJanela({ frequencia: 'mensal', hora: '09:00', diasSemana: [], diaMes: 31 }, fuso, new Date('2027-02-01T00:00:00Z')).toISOString()).toBe('2027-02-28T12:00:00.000Z');
  });

  it('1 dia antes do agendamento mantém a hora; com hora fixa, usa a hora', () => {
    const base = lerData('2026-11-15T17:30:00.000Z', 'America/Sao_Paulo')!; // 14:30 em SP
    expect(alvoComDeslocamento(base, { deslocamento: 1, unidade: 'dias', direcao: 'antes' }, 'America/Sao_Paulo').toISOString()).toBe('2026-11-14T17:30:00.000Z');
    expect(alvoComDeslocamento(base, { deslocamento: 1, unidade: 'dias', direcao: 'antes', hora: '09:00' }, 'America/Sao_Paulo').toISOString()).toBe('2026-11-14T12:00:00.000Z');
    expect(alvoComDeslocamento(base, { deslocamento: 2, unidade: 'horas', direcao: 'antes' }, 'America/Sao_Paulo').toISOString()).toBe('2026-11-15T15:30:00.000Z');
  });

  it('lerData aceita AAAA-MM-DD e DD/MM/AAAA; data impossível é null', () => {
    expect(lerData('2026-02-30', 'UTC')).toBeNull();
    expect(lerData('15/11/2026', 'UTC')?.instante.toISOString()).toBe('2026-11-15T00:00:00.000Z');
    expect(lerData('', 'UTC')).toBeNull();
  });

  it('agora.* no fuso', () => {
    const quarta = new Date('2026-11-11T02:00:00Z'); // ainda terça 23:00 em SP
    expect(agoraNoFuso('agora.diaSemana', 'America/Sao_Paulo', quarta)).toBe(2);
    expect(agoraNoFuso('agora.hora', 'America/Sao_Paulo', quarta)).toBe(23);
    expect(agoraNoFuso('agora.data', 'America/Sao_Paulo', quarta)).toBe('2026-11-10');
  });
});

// --------------------------------------------------------- eventos/filtros
describe('eventoBate (meta e esperar até por evento)', () => {
  it('casa evento + filtro; vazio casa qualquer', () => {
    expect(eventoBate({ evento: 'tag_adicionada', tag: 'Pagou' }, 'tag_adicionada', { tag: 'pagou' })).toBe(true);
    expect(eventoBate({ evento: 'tag_adicionada', tag: 'Pagou' }, 'tag_adicionada', { tag: 'lead' })).toBe(false);
    expect(eventoBate({ evento: 'tag_adicionada' }, 'etapa_mudou', { stageId: STAGE })).toBe(false);
    expect(eventoBate({ evento: 'etapa_mudou', stageId: STAGE }, 'etapa_mudou', { stageId: STAGE })).toBe(true);
    expect(eventoBate({ evento: 'mensagem_recebida', contem: 'sim' }, 'mensagem_recebida', { de: 'contato', texto: 'SIM, quero' })).toBe(true);
    expect(eventoBate({ evento: 'negocio_status' }, 'negocio_status', { status: 'aberto' })).toBe(false);
    expect(eventoBate({ evento: 'negocio_status', status: 'ganho' }, 'negocio_status', { status: 'ganho' })).toBe(true);
    expect(eventoBate({ evento: 'pagamento_recebido', valorMinimo: 100 }, 'pagamento_recebido', { valorCentavos: 9_999 })).toBe(false);
    expect(eventoBate({ evento: 'pagamento_recebido', valorMinimo: 100 }, 'pagamento_recebido', { valorCentavos: 10_000 })).toBe(true);
    expect(eventoBate({ evento: 'formulario_enviado', formId: U1 }, 'formulario_enviado', { formId: U2 })).toBe(false);
  });
});

// -------------------------------------------------------------- controle
describe('controle.esperar_ate', () => {
  const ctxBase: Contexto = { contato: contato(), fuso: 'America/Sao_Paulo' };

  it('data futura vira espera persistida; data passada segue (ou encerra)', async () => {
    const { svc } = ambiente();
    const r = await svc.executar(T, no('controle.esperar_ate', { modo: 'data', data: '2099-01-01', hora: '09:00' }), ctxBase, GRAFO);
    expect(r.esperarMs).toBeGreaterThan(0);
    expect(r.mesmoNo).toBeUndefined();
    const passado = await svc.executar(T, no('controle.esperar_ate', { modo: 'data', data: '2020-01-01' }), ctxBase, GRAFO);
    expect(passado.esperarMs).toBeUndefined();
    expect(passado.saida).toMatchObject({ jaPassou: true });
    const enc = await svc.executar(T, no('controle.esperar_ate', { modo: 'data', data: '2020-01-01', seJaPassou: 'encerrar' }), ctxBase, GRAFO);
    expect(enc.encerrar).toBe(true);
  });

  it('campo do agendamento ± deslocamento; contato sem a data não espera', async () => {
    const { svc } = ambiente();
    const inicio = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const ctx = { ...ctxBase, agendamento: { inicio } as unknown as Contexto['agendamento'] };
    const r = await svc.executar(T, no('controle.esperar_ate', { modo: 'campo', campo: 'agendamento.data', deslocamento: 1, unidade: 'dias', direcao: 'antes' }), ctx, GRAFO);
    expect(Math.abs((r.esperarMs ?? 0) - 2 * 86_400_000)).toBeLessThan(2 * 3_600_000); // ~2 dias (horário de verão tolerado)
    const sem = await svc.executar(T, no('controle.esperar_ate', { modo: 'campo', campo: 'contato.campos.aniversario' }), ctxBase, GRAFO);
    expect(sem.saida).toMatchObject({ semData: true });
  });

  it('evento: 1ª passada marca e reagenda o próprio nó; acordado → "aconteceu"; prazo → "expirou"', async () => {
    const { svc } = ambiente();
    const n = no('controle.esperar_ate', { modo: 'evento', evento: 'agendamento_confirmado', duracao: 2, unidade: 'dias' }, 'ea');
    const r1 = await svc.executar(T, n, ctxBase, GRAFO);
    expect(r1).toMatchObject({ esperarMs: 172_800_000, mesmoNo: true, contexto: { aguardandoEvento: 'ea' } });
    const r2 = await svc.executar(T, n, { ...ctxBase, aguardandoEvento: 'ea', eventoOcorreu: true }, GRAFO);
    expect(r2.ramo).toBe('aconteceu');
    const r3 = await svc.executar(T, n, { ...ctxBase, aguardandoEvento: 'ea' }, GRAFO);
    expect(r3.ramo).toBe('expirou');
  });
});

describe('controle.meta', () => {
  it('atingida segue; não atingida: seguir / encerrar / esperar', async () => {
    const { svc } = ambiente();
    const cfg = { evento: 'agendamento_criado' };
    expect((await svc.executar(T, no('controle.meta', cfg, 'm'), { metasAtingidas: ['m'] }, GRAFO)).saida).toMatchObject({ atingida: true });
    expect((await svc.executar(T, no('controle.meta', cfg, 'm'), {}, GRAFO)).saida).toMatchObject({ atingida: false, seguiu: true });
    expect((await svc.executar(T, no('controle.meta', { ...cfg, seNaoAtingida: 'encerrar' }, 'm'), {}, GRAFO)).encerrar).toBe(true);
    expect(await svc.executar(T, no('controle.meta', { ...cfg, seNaoAtingida: 'esperar' }, 'm'), {}, GRAFO)).toMatchObject({ esperarMs: ESPERA_META_MS, mesmoNo: true });
  });
});

describe('controle.condicao · operandos novos', () => {
  const regra = (campo: string, operador: string, valor?: string) => no('controle.condicao', { ramos: [{ id: 'sim', juncao: 'AND', regras: [{ campo, operador, valor }] }] });
  const vivo = { id: 'c1', nome: 'Ana', email: null, telefone: null, empresa: null, tag: 'Lead', tags: ['VIP', 'vipgold'], valorEstimado: 0, camposCustom: { plano: 'ouro', aniversario: '1990-05-20' }, ownerId: U1, optedOutAt: new Date(), origem: 'Meta Ads' };

  it('lê o contato ATUAL do banco: campo personalizado, dono, não perturbe, origem', async () => {
    const { svc } = ambiente({ contact: { findUnique: jest.fn(async () => vivo) } });
    const ctx: Contexto = { contato: contato({ tags: [] }) };
    expect((await svc.executar(T, regra('contato.campos.plano', 'igual', 'Ouro'), ctx, GRAFO)).ramo).toBe('sim');
    expect((await svc.executar(T, regra('contato.ownerId', 'igual', U1), ctx, GRAFO)).ramo).toBe('sim');
    expect((await svc.executar(T, regra('contato.naoPerturbe', 'igual', 'true'), ctx, GRAFO)).ramo).toBe('sim');
    expect((await svc.executar(T, regra('contato.origem', 'contem', 'meta'), ctx, GRAFO)).ramo).toBe('sim');
    expect((await svc.executar(T, regra('contato.campos.aniversario', 'menor', '2000-01-01'), ctx, GRAFO)).ramo).toBe('sim');
  });

  it('tags: "contém" é por item (vip não casa só por estar dentro de vipgold)', async () => {
    const { svc } = ambiente({ contact: { findUnique: jest.fn(async () => ({ ...vivo, tags: ['vipgold'] })) } });
    const ctx: Contexto = { contato: contato() };
    expect((await svc.executar(T, regra('contato.tags', 'contem', 'vip'), ctx, GRAFO)).ramo).toBeUndefined();
    expect((await svc.executar(T, regra('contato.tags', 'nao_contem', 'vip'), ctx, GRAFO)).ramo).toBe('sim');
  });

  it('dia da semana e hora atuais no fuso do fluxo', async () => {
    const { svc } = ambiente();
    const hoje = agoraNoFuso('agora.diaSemana', 'America/Sao_Paulo');
    expect((await svc.executar(T, regra('agora.diaSemana', 'igual', String(hoje)), { fuso: 'America/Sao_Paulo' }, GRAFO)).ramo).toBe('sim');
    expect((await svc.executar(T, regra('agora.hora', 'maior', '24'), { fuso: 'America/Sao_Paulo' }, GRAFO)).ramo).toBeUndefined();
  });
});

// ------------------------------------------------------------------ ações
describe('acao.remover_de_fluxo', () => {
  it('"este": cancela as outras execuções do contato neste fluxo (nunca a própria) e encerra', async () => {
    const a = ambiente();
    const r = await a.svc.executar(T, no('acao.remover_de_fluxo', { alvo: 'este' }), { contato: contato(), runId: 'r1', workflowId: WF }, GRAFO);
    expect(r).toMatchObject({ encerrar: true, saida: { cancelados: 2 } });
    expect(a.tx.workflowRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ contactId: 'c1', workflowId: WF, id: { not: 'r1' } }) }));
  });

  it('"outros" filtra pelos fluxos escolhidos e segue; "todos" sem filtro de fluxo', async () => {
    const a = ambiente();
    const r = await a.svc.executar(T, no('acao.remover_de_fluxo', { alvo: 'outros', workflowIds: [WF2] }), { contato: contato(), runId: 'r1', workflowId: WF }, GRAFO);
    expect(r.encerrar).toBeUndefined();
    expect(a.tx.workflowRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ workflowId: { in: [WF2] } }) }));
    await a.svc.executar(T, no('acao.remover_de_fluxo', { alvo: 'todos' }), { contato: contato(), runId: 'r1' }, GRAFO);
    const where = (a.tx.workflowRun.updateMany as jest.Mock).mock.calls[1][0].where;
    expect(where.workflowId).toBeUndefined();
  });

  it('sem contato no contexto: erro sem retry', async () => {
    const a = ambiente();
    await expect(a.svc.executar(T, no('acao.remover_de_fluxo', {}), {}, GRAFO)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('acao.atribuir_usuario', () => {
  it('fixo: grava o dono do contato e registra atividade', async () => {
    const a = ambiente();
    const r = await a.svc.executar(T, no('acao.atribuir_usuario', { modo: 'fixo', usuarioId: U1 }), { contato: contato(), workflowId: WF }, GRAFO);
    expect(a.tx.contact.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: U1 }) }));
    expect(r.contexto?.contato?.ownerId).toBe(U1);
    expect(a.tx.activity.create).toHaveBeenCalled();
  });

  it('rodízio: usa o contador atômico e pula quem saiu da conta (U3 não é membro)', async () => {
    const a = ambiente({ $queryRaw: jest.fn(async () => [{ contador: BigInt(2) }]) });
    const r = await a.svc.executar(T, no('acao.atribuir_usuario', { modo: 'rodizio', usuarios: [U1, U3, U2] }), { contato: contato(), workflowId: WF }, GRAFO);
    // ativos = [U1, U2]; contador 2 → índice 1 → U2
    expect(r.saida).toMatchObject({ ownerId: U2, posicaoRodizio: 2 });
  });

  it('"só se sem dono" não mexe em quem já tem dono nem gasta a vez do rodízio', async () => {
    const a = ambiente({ contact: { findUnique: jest.fn(async () => ({ id: 'c1', ownerId: U2 })), update: jest.fn() } });
    const r = await a.svc.executar(T, no('acao.atribuir_usuario', { modo: 'rodizio', usuarios: [U1, U2], soSemDono: true }), { contato: contato(), workflowId: WF }, GRAFO);
    expect(r.saida).toMatchObject({ pulado: true });
    expect(a.tx.$queryRaw).not.toHaveBeenCalled();
    expect(a.tx.contact.update).not.toHaveBeenCalled();
  });

  it('também grava o dono do negócio aberto; nenhum membro ativo é erro sem retry', async () => {
    const a = ambiente({ deal: { findFirst: jest.fn(async () => ({ id: 'd1' })), update: jest.fn(async () => ({})) } });
    const r = await a.svc.executar(T, no('acao.atribuir_usuario', { modo: 'fixo', usuarioId: U1, negocio: true }), { contato: contato(), workflowId: WF }, GRAFO);
    expect(r.saida).toMatchObject({ dealId: 'd1' });
    const b = ambiente({ membership: { findMany: jest.fn(async () => []) } });
    await expect(b.svc.executar(T, no('acao.atribuir_usuario', { modo: 'fixo', usuarioId: U3 }), { contato: contato(), workflowId: WF }, GRAFO)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('acao.nao_perturbe + envio respeita o opt-out', () => {
  it('liga/desliga pelo serviço do CRM', async () => {
    const a = ambiente();
    const r = await a.svc.executar(T, no('acao.nao_perturbe', { ativar: true }), { contato: contato() }, GRAFO);
    expect(a.crm.updateContact).toHaveBeenCalledWith(T, 'c1', { naoPerturbe: true });
    expect(r.contexto?.contato?.naoPerturbe).toBe(true);
    await a.svc.executar(T, no('acao.nao_perturbe', { ativar: false }), { contato: contato() }, GRAFO);
    expect(a.crm.updateContact).toHaveBeenLastCalledWith(T, 'c1', { naoPerturbe: false });
  });

  it('e-mail para contato com não perturbe NÃO sai (lido do banco, não do contexto)', async () => {
    const a = ambiente({ contact: { findUnique: jest.fn(async () => ({ optedOutAt: new Date() })) } });
    const r = await a.svc.executar(T, no('acao.enviar_email', { assunto: 'Oi', corpo: 'Olá' }), { contato: contato({ naoPerturbe: false }) }, GRAFO);
    expect(a.mailer.send).not.toHaveBeenCalled();
    expect(r.saida).toMatchObject({ status: 'cancelled', motivo: 'nao_perturbe' });
  });

  it('e-mail sem opt-out sai normalmente', async () => {
    const a = ambiente();
    await a.svc.executar(T, no('acao.enviar_email', { assunto: 'Oi', corpo: 'Olá' }), { contato: contato() }, GRAFO);
    expect(a.mailer.send).toHaveBeenCalled();
  });
});

describe('acao.atualizar_negocio', () => {
  const ctx: Contexto = { contato: contato(), negocio: { id: 'd1', titulo: 'Plano', valor: 100, stageId: 's0', origem: null }, variaveis: { total: '1.500,50' } };
  const atual = { id: 'd1', titulo: 'Plano', status: 'aberto', stageId: 's0', contactId: 'c1', camposCustom: {}, ownerId: null };

  it('valor com {{...}} em formato BR, status perdido com motivo, etapa (com funil) e dono do contato', async () => {
    const a = ambiente({ deal: { findUnique: jest.fn(async () => atual), update: ambiente().tx.deal.update } });
    (a.tx.contact.findUnique as jest.Mock).mockResolvedValue({ ownerId: U2 });
    const r = await a.svc.executar(T, no('acao.atualizar_negocio', { valor: '{{variaveis.total}}', status: 'perdido', motivoPerdaId: MOTIVO, stageId: STAGE, dono: 'contato' }), ctx, GRAFO);
    const data = (a.tx.deal.update as jest.Mock).mock.calls[0][0].data;
    expect(data).toMatchObject({ valor: 1500.5, status: 'perdido', motivoPerdaId: MOTIVO, stageId: STAGE, pipelineId: 'p1', ownerId: U2 });
    expect(r.contexto?.negocio).toMatchObject({ status: 'perdido', stageId: STAGE });
  });

  it('campo personalizado do negócio validado pelo tipo; chave desconhecida vai à DLQ sem retry', async () => {
    const a = ambiente({ deal: { findUnique: jest.fn(async () => atual), update: ambiente().tx.deal.update } });
    await a.svc.executar(T, no('acao.atualizar_negocio', { campos: [{ chave: 'plano', valor: 'Ouro' }] }), ctx, GRAFO);
    expect((a.tx.deal.update as jest.Mock).mock.calls[0][0].data.camposCustom).toEqual({ plano: 'Ouro' });
    await expect(a.svc.executar(T, no('acao.atualizar_negocio', { campos: [{ chave: 'naoexiste', valor: 'x' }] }), ctx, GRAFO)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('sem negócio no contexto, valor que não é número ou motivo desativado: erro sem retry', async () => {
    const a = ambiente({ deal: { findUnique: jest.fn(async () => atual), update: jest.fn() }, lostReason: { findUnique: jest.fn(async () => ({ id: MOTIVO, ativo: false })) } });
    await expect(a.svc.executar(T, no('acao.atualizar_negocio', { status: 'ganho' }), { contato: contato() }, GRAFO)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(a.svc.executar(T, no('acao.atualizar_negocio', { valor: 'abc' }), ctx, GRAFO)).rejects.toBeInstanceOf(UnrecoverableError);
    await expect(a.svc.executar(T, no('acao.atualizar_negocio', { status: 'perdido', motivoPerdaId: MOTIVO }), ctx, GRAFO)).rejects.toBeInstanceOf(UnrecoverableError);
  });
});

describe('acao.atualizar_contato · campos personalizados e tags', () => {
  it('converte pelo tipo (lista, sim/não, data BR) e grava pelo helper validado do CRM', async () => {
    const a = ambiente();
    const r = await a.svc.executar(T, no('acao.atualizar_contato', {
      campos: [{ chave: 'interesses', valor: 'Implante, Clareamento' }, { chave: 'ativo', valor: 'Sim' }, { chave: 'aniversario', valor: '20/05/1990' }],
    }), { contato: contato() }, GRAFO);
    expect(a.camposCustom.atualizarCamposContato).toHaveBeenCalledWith(T, 'c1', { interesses: ['Implante', 'Clareamento'], ativo: true, aniversario: '1990-05-20' });
    expect(r.saida).toMatchObject({ camposAlterados: ['interesses', 'ativo', 'aniversario'] });
  });

  it('tags: adiciona e remove sobre o estado do banco, sem duplicar', async () => {
    const a = ambiente();
    await a.svc.executar(T, no('acao.atualizar_contato', { tagsAdicionar: ['VIP', 'cliente'], tagsRemover: ['lead'] }), { contato: contato() }, GRAFO);
    expect(a.crm.updateContact).toHaveBeenCalledWith(T, 'c1', { tags: ['vip', 'cliente'] });
  });

  it('campo fixo legado continua funcionando', async () => {
    const a = ambiente();
    await a.svc.executar(T, no('acao.atualizar_contato', { campo: 'empresa', valor: 'Clínica {{contato.nome}}' }), { contato: contato() }, GRAFO);
    expect(a.crm.updateContact).toHaveBeenCalledWith(T, 'c1', { empresa: 'Clínica Ana Souza' });
  });

  it('helpers de conversão', () => {
    expect(converterValorCampo('boolean', 'não')).toBe(false);
    expect(converterValorCampo('date', '2026-05-01T10:00:00Z')).toBe('2026-05-01');
    expect(converterValorCampo('text', '  ')).toBe('');
    expect(lerNumero('R$ 2.500,00')).toBe(2500);
    expect(lerNumero('12.5')).toBe(12.5);
    expect(lerNumero('doze')).toBeNull();
  });
});

// ------------------------------------------------------------ orquestração
const GRAFO_META: Grafo = {
  nos: [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} },
    { id: 'espera', tipo: 'controle.esperar', posicao: { x: 1, y: 0 }, config: { duracao: 3, unidade: 'dias' } },
    { id: 'sms', tipo: 'acao.enviar_sms', posicao: { x: 2, y: 0 }, config: { texto: 'lembrete' } },
    { id: 'meta', tipo: 'controle.meta', posicao: { x: 3, y: 0 }, config: { evento: 'agendamento_criado' } },
    { id: 'obg', tipo: 'acao.criar_nota', posicao: { x: 4, y: 0 }, config: { corpo: 'agendou' } },
    { id: 'ea', tipo: 'controle.esperar_ate', posicao: { x: 5, y: 0 }, config: { modo: 'evento', evento: 'tag_adicionada', tag: 'pagou', duracao: 1, unidade: 'dias' } },
  ],
  arestas: [
    { id: 'a1', de: 'g', para: 'espera' }, { id: 'a2', de: 'espera', para: 'sms' },
    { id: 'a3', de: 'sms', para: 'meta' }, { id: 'a4', de: 'meta', para: 'obg' }, { id: 'a5', de: 'obg', para: 'ea' },
  ],
};

function ambienteRuns(runs: Record<string, unknown>[], unico?: Record<string, unknown>) {
  const enfileirados: unknown[] = [];
  const updates: Record<string, unknown>[] = [];
  const tx = {
    workflowRun: {
      findMany: jest.fn(async () => runs),
      findUnique: jest.fn(async () => unico ?? { noAtual: 'meta', generation: 1, scheduledAt: new Date() }),
      updateMany: jest.fn(async (args: Record<string, unknown>) => { updates.push(args); return { count: unico && 'claim' in unico ? 0 : 1 }; }),
    },
  };
  const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
  const fila = { add: jest.fn(async (_n: string, dados: unknown) => { enfileirados.push(dados); }) } as unknown as Queue<PassoJob>;
  const svc = new RunsService(prisma, {} as ExecutorService, { publicar: jest.fn() } as unknown as DomainEventsService, fila);
  return { svc, tx, enfileirados, updates };
}

describe('RunsService.avisarEvento · meta e esperar até', () => {
  const run = (noAtual: string, estado: Contexto = {}) => ({ id: 'r1', noAtual, estado, grafoTeste: null, version: { grafo: GRAFO_META } });

  it('meta à frente do run (esperando no "Esperar 3 dias"): pula para a meta e cancela a espera (geração sobe)', async () => {
    const a = ambienteRuns([run('espera', { aguardandoResposta: null })]);
    const r = await a.svc.avisarEvento(T, 'c1', 'agendamento_criado', { id: 'ag1' });
    expect(r.metas).toBe(1);
    const up = a.updates[0] as { where: Record<string, unknown>; data: Record<string, unknown> };
    expect(up.where).toMatchObject({ id: 'r1', noAtual: 'espera' });
    expect(up.data).toMatchObject({ noAtual: 'meta', status: 'rodando', generation: { increment: 1 } });
    expect((up.data.estado as Contexto).metasAtingidas).toEqual(['meta']);
    expect(a.enfileirados).toHaveLength(1);
  });

  it('meta que já ficou para trás não puxa o run de volta; evento de outro tipo não faz nada', async () => {
    const a = ambienteRuns([run('ea', { aguardandoEvento: 'ea' })]);
    expect(await a.svc.avisarEvento(T, 'c1', 'agendamento_criado', {})).toEqual({ metas: 0, acordados: 0 });
    expect(a.updates).toHaveLength(0);
  });

  it('"Esperar até" (evento) acorda no evento certo, no mesmo nó, marcando eventoOcorreu', async () => {
    const a = ambienteRuns([run('ea', { aguardandoEvento: 'ea' })]);
    expect((await a.svc.avisarEvento(T, 'c1', 'tag_adicionada', { tag: 'lead' })).acordados).toBe(0); // filtro não bate
    const r = await a.svc.avisarEvento(T, 'c1', 'tag_adicionada', { tag: 'Pagou' });
    expect(r.acordados).toBe(1);
    const up = a.updates[0] as { data: { noAtual: string; estado: Contexto } };
    expect(up.data.noAtual).toBe('ea');
    expect(up.data.estado.eventoOcorreu).toBe(true);
  });
});

describe('job adiantado (pendência da Q1): reagenda, nunca descarta', () => {
  const job: PassoJob = { tenantId: T, runId: 'r1', noId: 'meta', generation: 1 };

  it('claim recusado + run ainda neste nó/geração + scheduledAt no futuro → devolve o tempo que falta', async () => {
    const a = ambienteRuns([], { claim: true, noAtual: 'meta', generation: 1, status: 'esperando', scheduledAt: new Date(Date.now() + 60_000) });
    const r = await a.svc.processarPasso(job, 1);
    expect(r.adiantadoMs).toBeGreaterThan(50_000);
  });

  it('job velho (outra geração ou run encerrado) continua descartado', async () => {
    const velho = ambienteRuns([], { claim: true, noAtual: 'meta', generation: 2, status: 'esperando', scheduledAt: new Date(Date.now() + 60_000) });
    expect(await velho.svc.processarPasso(job, 1)).toEqual({});
    const fim = ambienteRuns([], { claim: true, noAtual: 'meta', generation: 1, status: 'concluido', scheduledAt: new Date(Date.now() + 60_000) });
    expect(await fim.svc.processarPasso(job, 1)).toEqual({});
  });

  it('processor move o MESMO job para a fila atrasada e sinaliza DelayedError (sem falha, sem DLQ)', async () => {
    const runs = { processarPasso: jest.fn(async () => ({ adiantadoMs: 30_000 })) } as unknown as RunsService;
    const p = new PassosProcessor(runs);
    const moveToDelayed = jest.fn(async () => undefined);
    const j = { data: job, attemptsMade: 0, moveToDelayed } as unknown as Job<PassoJob>;
    await expect(p.process(j, 'tok')).rejects.toBeInstanceOf(DelayedError);
    expect(moveToDelayed).toHaveBeenCalledWith(expect.any(Number), 'tok');
    const quando = (moveToDelayed.mock.calls[0] as unknown as [number])[0];
    expect(quando - Date.now()).toBeGreaterThan(25_000);
  });

  it('processor: passo normal não reagenda', async () => {
    const runs = { processarPasso: jest.fn(async () => ({})) } as unknown as RunsService;
    const moveToDelayed = jest.fn();
    await new PassosProcessor(runs).process({ data: job, attemptsMade: 0, moveToDelayed } as unknown as Job<PassoJob>, 'tok');
    expect(moveToDelayed).not.toHaveBeenCalled();
  });
});

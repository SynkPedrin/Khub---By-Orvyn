import { TriggersService, normalizarTermo } from './triggers.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RunsService } from './runs.service';

// filtroBate é a lógica pura de "este evento casa com o filtro do gatilho?".
// Testável isolada, sem fila nem banco.
const svc = new TriggersService({} as PrismaService, {} as RunsService);
const bate = (tipo: string, config: Record<string, unknown>, dados: Record<string, unknown>, ctx: Record<string, unknown> = {}): boolean =>
  (svc as unknown as { filtroBate: (g: unknown, j: unknown, c: unknown) => boolean }).filtroBate(
    { id: 'g', tipo, posicao: { x: 0, y: 0 }, config },
    { tenantId: 't', evento: 'x', dados, dedupeKey: 'd' },
    ctx,
  );

describe('TriggersService.filtroBate', () => {
  it('negócio ganho/perdido: vazio casa qualquer; configurado casa só o igual', () => {
    expect(bate('gatilho.negocio_status', {}, { status: 'ganho' })).toBe(true);
    expect(bate('gatilho.negocio_status', {}, { status: 'perdido' })).toBe(true);
    expect(bate('gatilho.negocio_status', { status: 'ganho' }, { status: 'ganho' })).toBe(true);
    expect(bate('gatilho.negocio_status', { status: 'ganho' }, { status: 'perdido' })).toBe(false);
  });

  it('mudou de etapa: vazio = qualquer etapa; configurado casa a etapa certa', () => {
    expect(bate('gatilho.etapa_mudou', {}, { stageId: 's1' })).toBe(true);
    expect(bate('gatilho.etapa_mudou', { stageId: 's1' }, { stageId: 's1' })).toBe(true);
    expect(bate('gatilho.etapa_mudou', { stageId: 's1' }, { stageId: 's2' })).toBe(false);
  });

  it('tag adicionada: casa ignorando maiúscula/minúscula', () => {
    expect(bate('gatilho.tag_adicionada', { tag: 'VIP' }, { tag: 'vip' })).toBe(true);
    expect(bate('gatilho.tag_adicionada', { tag: 'VIP' }, { tag: 'lead' })).toBe(false);
  });

  it('mensagem recebida: filtra por texto contido', () => {
    expect(bate('gatilho.mensagem_recebida', { contem: 'preço' }, { texto: 'qual o PREÇO?' })).toBe(true);
    expect(bate('gatilho.mensagem_recebida', { contem: 'preço' }, { texto: 'bom dia' })).toBe(false);
  });
});

describe('BUG-029 — "Contato criado" com filtro de origem', () => {
  it('normaliza: caixa, acento, espaço e hífen não importam', () => {
    expect(normalizarTermo('Meta Ads')).toBe('metaads');
    expect(normalizarTermo('meta-ads')).toBe('metaads');
    expect(normalizarTermo(' META_ADS ')).toBe('metaads');
    expect(normalizarTermo('Indicação')).toBe('indicacao');
  });

  it('origem do outbox (coluna/lead_origem) casa com o filtro mesmo escrita diferente', () => {
    expect(bate('gatilho.contato_criado', { origem: 'Meta Ads' }, { origem: 'metaads' })).toBe(true);
    expect(bate('gatilho.contato_criado', { origem: 'meta-ads' }, { origem: 'Meta Ads' })).toBe(true);
    expect(bate('gatilho.contato_criado', { origem: 'Indicacao' }, { origem: 'Indicação' })).toBe(true);
  });

  it('origem diferente não casa; filtro vazio casa qualquer origem', () => {
    expect(bate('gatilho.contato_criado', { origem: 'Meta Ads' }, { origem: 'Google Ads' })).toBe(false);
    expect(bate('gatilho.contato_criado', { origem: 'Meta Ads' }, { origem: 'Manual' })).toBe(false);
    expect(bate('gatilho.contato_criado', {}, { origem: 'Manual' })).toBe(true);
    expect(bate('gatilho.contato_criado', { origem: '  ' }, { origem: 'Manual' })).toBe(true);
  });
});

describe('Q1.2 — "Mensagem recebida" filtra pelo canal da conversa', () => {
  const msg = (canal: string) => ({ mensagem: { id: 'm', texto: 'oi', de: 'contato', canal } });

  it('canal configurado casa só o canal da conversa (normalizado)', () => {
    expect(bate('gatilho.mensagem_recebida', { canal: 'Instagram' }, { texto: 'oi' }, msg('Instagram'))).toBe(true);
    expect(bate('gatilho.mensagem_recebida', { canal: 'instagram' }, { texto: 'oi' }, msg('Instagram'))).toBe(true);
    expect(bate('gatilho.mensagem_recebida', { canal: 'Instagram' }, { texto: 'oi' }, msg('WhatsApp'))).toBe(false);
  });

  it('sem canal na config vale o padrão do catálogo (WhatsApp)', () => {
    expect(bate('gatilho.mensagem_recebida', {}, { texto: 'oi' }, msg('WhatsApp'))).toBe(true);
    expect(bate('gatilho.mensagem_recebida', {}, { texto: 'oi' }, msg('Instagram'))).toBe(false);
  });

  it('"qualquer" aceita todo canal', () => {
    expect(bate('gatilho.mensagem_recebida', { canal: 'qualquer' }, { texto: 'oi' }, msg('Instagram'))).toBe(true);
  });

  it('canal + texto: os dois filtros precisam bater', () => {
    expect(bate('gatilho.mensagem_recebida', { canal: 'WhatsApp', contem: 'preço' }, { texto: 'qual o preço?' }, msg('WhatsApp'))).toBe(true);
    expect(bate('gatilho.mensagem_recebida', { canal: 'WhatsApp', contem: 'preço' }, { texto: 'qual o preço?' }, msg('Instagram'))).toBe(false);
  });

  it('processar: o canal vem da conversa (banco), não do payload', async () => {
    const grafo = {
      nos: [
        { id: 'g', tipo: 'gatilho.mensagem_recebida', posicao: { x: 0, y: 0 }, config: { canal: 'Instagram' } },
        { id: 'n', tipo: 'acao.criar_nota', posicao: { x: 1, y: 0 }, config: { corpo: 'x' } },
      ],
      arestas: [{ id: 'a', de: 'g', para: 'n' }],
    };
    const ambiente = (canal: string) => {
      const tx = {
        workflow: { findMany: jest.fn(async () => [{ id: 'w1', versaoAtivaId: 'v1', versaoAtiva: { id: 'v1', grafo } }]) },
        conversation: { findUnique: jest.fn(async () => ({ contactId: 'c1', canal })) },
        contact: { findUnique: jest.fn(async () => ({ id: 'c1', nome: 'Ana', email: null, telefone: null, empresa: null, tag: 'Lead', tags: [], valorEstimado: 0 })) },
      };
      const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
      const runs = { iniciar: jest.fn(async () => ({ runId: 'r1' })), avisarResposta: jest.fn(async () => undefined), avisarEvento: jest.fn(async () => undefined) } as unknown as RunsService;
      return { svc: new TriggersService(prisma, runs), runs };
    };
    const job = { tenantId: 't', evento: 'message.created' as const, dados: { id: 'm1', conversationId: 'conv1', de: 'contato', texto: 'oi' }, dedupeKey: 'e1' };

    const insta = ambiente('Instagram');
    await insta.svc.processar(job);
    expect(insta.runs.iniciar).toHaveBeenCalledWith(expect.objectContaining({ contexto: expect.objectContaining({ mensagem: expect.objectContaining({ canal: 'Instagram' }) }) }));

    const whats = ambiente('WhatsApp');
    await whats.svc.processar(job);
    expect(whats.runs.iniciar).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Gatilhos de agenda (Q2.4 / RV-05.2): appointment.* do outbox da migration 054.
// ---------------------------------------------------------------------------
describe('TriggersService · gatilhos de agenda', () => {
  const AG = {
    id: 'ag1', titulo: 'Consulta inicial', inicio: new Date('2026-11-15T17:30:00Z'), fim: new Date('2026-11-15T18:30:00Z'),
    local: 'Rua das Flores, 10', tipo: 'reuniao', status: 'agendado', responsavelId: 'u1', contactId: 'c1',
  };
  const grafoDe = (tipo: string, config: Record<string, unknown> = {}) => ({
    nos: [{ id: 'g', tipo, posicao: { x: 0, y: 0 }, config }, { id: 'a', tipo: 'acao.adicionar_tag', posicao: { x: 1, y: 0 }, config: { tag: 'x' } }],
    arestas: [{ id: 'e', de: 'g', para: 'a' }],
  });
  const ambiente = (grafo: unknown, compromisso: typeof AG | null = AG, timezone?: string) => {
    const tx = {
      workflow: { findMany: jest.fn(async () => [{ id: 'w1', versaoAtivaId: 'v1', versaoAtiva: { id: 'v1', grafo } }]) },
      agendaCompromisso: { findUnique: jest.fn(async () => compromisso) },
      tenant: { findUnique: jest.fn(async () => ({ settings: timezone ? { timezone } : {} })) },
      contact: { findUnique: jest.fn(async () => ({ id: 'c1', nome: 'Ana', email: null, telefone: '5511999990000', empresa: null, tag: 'Lead', tags: [], valorEstimado: 0 })) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
    const runs = { iniciar: jest.fn(async () => ({ runId: 'r1' })), avisarResposta: jest.fn(async () => undefined), avisarEvento: jest.fn(async () => undefined) } as unknown as RunsService;
    return { svc: new TriggersService(prisma, runs), runs, tx };
  };
  const job = (evento: string, dados: Record<string, unknown> = {}) =>
    ({ tenantId: 't', evento, dados: { id: 'ag1', contactId: 'c1', responsavelId: 'u1', tipo: 'reuniao', status: 'agendado', ...dados }, dedupeKey: 'ev1' }) as never;

  it.each([
    ['appointment.created', 'gatilho.agendamento_criado'],
    ['appointment.confirmed', 'gatilho.agendamento_confirmado'],
    ['appointment.no_show', 'gatilho.faltou'],
    ['appointment.cancelled', 'gatilho.agendamento_cancelado'],
    ['appointment.reminder_due', 'gatilho.lembrete_agendamento'],
  ])('%s abre o fluxo com gatilho %s', async (evento, tipo) => {
    const { svc: s, runs } = ambiente(grafoDe(tipo));
    await s.processar(job(evento));
    expect(runs.iniciar).toHaveBeenCalledWith(expect.objectContaining({ gatilho: tipo, dedupeKey: 'ev1:g' }));
  });

  it('evento de agenda não aciona gatilho de outro tipo', async () => {
    const { svc: s, runs } = ambiente(grafoDe('gatilho.faltou'));
    await s.processar(job('appointment.confirmed'));
    expect(runs.iniciar).not.toHaveBeenCalled();
  });

  it('contexto expõe agendamento.data/hora/titulo/local no fuso da conta', async () => {
    const { svc: s, runs } = ambiente(grafoDe('gatilho.agendamento_criado'), AG, 'America/Sao_Paulo');
    await s.processar(job('appointment.created'));
    const ctx = (runs.iniciar as jest.Mock).mock.calls[0][0].contexto;
    expect(ctx.agendamento).toEqual(expect.objectContaining({ titulo: 'Consulta inicial', data: '15/11/2026', hora: '14:30', horaFim: '15:30', local: 'Rua das Flores, 10' }));
    expect(ctx.contato).toEqual(expect.objectContaining({ id: 'c1', nome: 'Ana' }));
  });

  it('fuso inválido na conta cai no padrão (São Paulo) em vez de quebrar', async () => {
    const { svc: s, runs } = ambiente(grafoDe('gatilho.agendamento_criado'), AG, 'Marte/Olympus');
    await s.processar(job('appointment.created'));
    expect((runs.iniciar as jest.Mock).mock.calls[0][0].contexto.agendamento.hora).toBe('14:30');
  });

  it('compromisso apagado ou sem contato não abre run', async () => {
    const apagado = ambiente(grafoDe('gatilho.agendamento_criado'), null);
    await apagado.svc.processar(job('appointment.created'));
    expect(apagado.runs.iniciar).not.toHaveBeenCalled();

    const semContato = ambiente(grafoDe('gatilho.agendamento_criado'), { ...AG, contactId: null as unknown as string });
    await semContato.svc.processar(job('appointment.created', { contactId: null }));
    expect(semContato.runs.iniciar).not.toHaveBeenCalled();
  });

  it('filtro por tipo e por responsável: vazio casa qualquer; configurado casa só o igual', () => {
    expect(bate('gatilho.agendamento_criado', {}, { tipo: 'demo', responsavelId: 'u2' })).toBe(true);
    expect(bate('gatilho.agendamento_criado', { tipo: 'demo' }, { tipo: 'demo' })).toBe(true);
    expect(bate('gatilho.agendamento_criado', { tipo: 'demo' }, { tipo: 'call' })).toBe(false);
    expect(bate('gatilho.faltou', { responsavelId: 'u1' }, { responsavelId: 'u1' })).toBe(true);
    expect(bate('gatilho.faltou', { responsavelId: 'u1' }, { responsavelId: 'u2' })).toBe(false);
    expect(bate('gatilho.lembrete_agendamento', { tipo: 'visita', responsavelId: 'u1' }, { tipo: 'visita', responsavelId: null })).toBe(false);
  });
});

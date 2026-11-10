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

describe('BUG-027 — "Contato criado" com filtro de origem', () => {
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
      const runs = { iniciar: jest.fn(async () => ({ runId: 'r1' })), avisarResposta: jest.fn(async () => undefined) } as unknown as RunsService;
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

import { TriggersService } from './triggers.service';
import { AgendadorService, dataAlvo, diasMesQueCasam, proximoDoNo, sincronizarAgendas, type CfgAgendado } from './agendador.service';
import { WorkflowsService } from './workflows.service';
import { validarReferencias } from './validacao-referencias';
import type { Grafo } from './catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { RunsService } from './runs.service';
import type { ConfigService } from '../config/config.service';
import type { Prisma } from '@prisma/client';

const T = '11111111-1111-1111-1111-111111111111';
const FORM = 'eeeeeeee-0000-4000-8000-000000000001';
const U1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const SP = 'America/Sao_Paulo';

const grafoDe = (tipo: string, config: Record<string, unknown> = {}): Grafo => ({
  nos: [{ id: 'g', tipo: tipo as Grafo['nos'][number]['tipo'], posicao: { x: 0, y: 0 }, config }, { id: 'a', tipo: 'acao.criar_nota', posicao: { x: 1, y: 0 }, config: { corpo: 'x' } }],
  arestas: [{ id: 'e', de: 'g', para: 'a' }],
});
const CONTATO = { id: 'c1', nome: 'Ana', email: null, telefone: null, empresa: null, tag: 'Lead', tags: [], valorEstimado: 0, camposCustom: {}, ownerId: null, optedOutAt: null, origem: null };

// ------------------------------------------------------------- gatilhos de evento
describe('Q3.2 · formulário enviado e pagamento recebido', () => {
  const ambiente = (grafo: Grafo, extra: Record<string, unknown> = {}) => {
    const tx = {
      workflow: { findMany: jest.fn(async () => [{ id: 'w1', versaoAtivaId: 'v1', versaoAtiva: { id: 'v1', grafo } }]) },
      contact: { findUnique: jest.fn(async () => CONTATO) },
      deal: { findUnique: jest.fn(async () => null) },
      financeiroCobranca: { findUnique: jest.fn(async () => ({ id: 'cob1', status: 'paga', valorCentavos: 25_000, moeda: 'BRL', descricao: 'Consulta', pagoEm: new Date('2026-11-10T12:00:00Z'), contactId: 'c1' })) },
      ...extra,
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const runs = { iniciar: jest.fn(async () => ({ runId: 'r1' })), avisarResposta: jest.fn(), avisarEvento: jest.fn(async () => ({ metas: 0, acordados: 0 })) } as unknown as RunsService;
    return { svc: new TriggersService(prisma, runs), runs, tx };
  };

  it('form.submitted abre o fluxo com {{formulario.<campo>}} e avisa metas do contato', async () => {
    const a = ambiente(grafoDe('gatilho.formulario_enviado', { formId: FORM }));
    await a.svc.processar({ tenantId: T, evento: 'form.submitted', dados: { formId: FORM, contactId: 'c1', respostas: { interesse: 'Implante' } }, dedupeKey: 'ev1' });
    const ctx = (a.runs.iniciar as jest.Mock).mock.calls[0][0].contexto;
    expect(ctx.formulario).toEqual({ interesse: 'Implante', id: FORM });
    expect(ctx.contato).toMatchObject({ id: 'c1', naoPerturbe: false });
    expect(a.runs.avisarEvento).toHaveBeenCalledWith(T, 'c1', 'formulario_enviado', expect.objectContaining({ formId: FORM }));
  });

  it('filtro de formulário: outro formulário não dispara', async () => {
    const a = ambiente(grafoDe('gatilho.formulario_enviado', { formId: FORM }));
    await a.svc.processar({ tenantId: T, evento: 'form.submitted', dados: { formId: U1, contactId: 'c1', respostas: {} }, dedupeKey: 'ev2' });
    expect(a.runs.iniciar).not.toHaveBeenCalled();
  });

  it('payment.received: contexto com o pagamento do banco; valor mínimo filtra', async () => {
    const a = ambiente(grafoDe('gatilho.pagamento_recebido', { valorMinimo: 200 }));
    await a.svc.processar({ tenantId: T, evento: 'payment.received', dados: { id: 'cob1', contactId: 'c1', valorCentavos: 25_000 }, dedupeKey: 'ev3' });
    const ctx = (a.runs.iniciar as jest.Mock).mock.calls[0][0].contexto;
    expect(ctx.pagamento).toMatchObject({ valor: 250, valorCentavos: 25_000, descricao: 'Consulta' });
    expect(ctx.pagamento.valorFormatado).toMatch(/250,00/);

    const b = ambiente(grafoDe('gatilho.pagamento_recebido', { valorMinimo: 300 }));
    await b.svc.processar({ tenantId: T, evento: 'payment.received', dados: { id: 'cob1', contactId: 'c1', valorCentavos: 25_000 }, dedupeKey: 'ev4' });
    expect(b.runs.iniciar).not.toHaveBeenCalled();
  });

  it('cobrança que deixou de estar paga no banco não abre run', async () => {
    const a = ambiente(grafoDe('gatilho.pagamento_recebido'), { financeiroCobranca: { findUnique: jest.fn(async () => ({ id: 'cob1', status: 'cancelada' })) } });
    await a.svc.processar({ tenantId: T, evento: 'payment.received', dados: { id: 'cob1', contactId: 'c1', valorCentavos: 100 }, dedupeKey: 'ev5' });
    expect(a.runs.iniciar).not.toHaveBeenCalled();
  });

  it('contact.tagged avisa metas/esperas do contato mesmo sem fluxo novo para abrir', async () => {
    const a = ambiente(grafoDe('gatilho.contato_criado'));
    await a.svc.processar({ tenantId: T, evento: 'contact.tagged', dados: { id: 'c1', tag: 'pagou' }, dedupeKey: 'ev6' });
    expect(a.runs.avisarEvento).toHaveBeenCalledWith(T, 'c1', 'tag_adicionada', { id: 'c1', tag: 'pagou' });
  });
});

// ------------------------------------------------------------- gatilhos por tempo
describe('Q3.2 · agenda dos gatilhos por tempo', () => {
  const agendado = (extra: Partial<CfgAgendado> = {}): CfgAgendado => ({ frequencia: 'diario', hora: '09:00', diasSemana: [1], diaMes: 1, alvo: 'sem_contato', tags: [], ...extra });

  it('data do contato: varredura diária na hora; alvo antes/depois; 29/02 cai em 28/02 fora do bissexto', () => {
    const agora = new Date('2026-11-11T13:00:00Z');
    expect(proximoDoNo('gatilho.data_contato', { campo: 'contato.criadoEm', quando: 'no_dia', dias: 0, hora: '08:00', anual: true }, SP, agora).toISOString()).toBe('2026-11-12T11:00:00.000Z');
    expect(dataAlvo({ quando: 'antes', dias: 3 }, agora, SP)).toEqual({ ano: 2026, mes: 11, dia: 14 });
    expect(dataAlvo({ quando: 'depois', dias: 11 }, agora, SP)).toEqual({ ano: 2026, mes: 10, dia: 31 });
    expect(diasMesQueCasam({ ano: 2027, mes: 2, dia: 28 })).toEqual(['02-28', '02-29']);
    expect(diasMesQueCasam({ ano: 2028, mes: 2, dia: 28 })).toEqual(['02-28']);
  });

  it('sincronizar: fluxo ativo grava uma linha por gatilho de tempo; pausado não grava (despublicar remove)', async () => {
    const criados: unknown[] = [];
    const tx = (status: string) => ({
      workflowSchedule: { deleteMany: jest.fn(async () => ({ count: 1 })), create: jest.fn(async ({ data }: { data: unknown }) => { criados.push(data); return data; }) },
      workflow: { findUnique: jest.fn(async () => ({ status, timezone: SP, versaoAtiva: { id: 'v1', grafo: grafoDe('gatilho.agendado', { hora: '07:30' }) } })) },
    });
    const ativo = tx('ativo');
    expect(await sincronizarAgendas(ativo as unknown as Prisma.TransactionClient, T, 'w1', new Date('2026-11-11T13:00:00Z'))).toBe(1);
    expect(criados[0]).toMatchObject({ workflowId: 'w1', versionId: 'v1', nodeId: 'g', tipo: 'agendado', proximoEm: new Date('2026-11-12T10:30:00.000Z') });
    const pausado = tx('pausado');
    expect(await sincronizarAgendas(pausado as unknown as Prisma.TransactionClient, T, 'w1')).toBe(0);
    expect(pausado.workflowSchedule.deleteMany).toHaveBeenCalledWith({ where: { workflowId: 'w1' } });
  });

  const ambienteVarredura = (opts: { proximo: Date; status?: string; grafo?: Grafo; contatos?: unknown[] }) => {
    const tx = {
      $queryRaw: jest.fn()
        .mockResolvedValueOnce([{ workflow_id: 'w1', version_id: 'v1', node_id: 'g', tipo: 'agendado', proximo_em: opts.proximo }])
        .mockResolvedValue((opts.contatos ?? []).map((c) => ({ id: (c as { id: string }).id }))),
      workflow: { findUnique: jest.fn(async () => ({ status: opts.status ?? 'ativo', timezone: SP, versaoAtivaId: 'v1', versaoAtiva: { id: 'v1', grafo: opts.grafo ?? grafoDe('gatilho.agendado') } })) },
      workflowSchedule: { updateMany: jest.fn(async () => ({ count: 1 })), deleteMany: jest.fn(async () => ({ count: 1 })) },
      contact: { findMany: jest.fn(async () => opts.contatos ?? []) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, w: (t: unknown) => Promise<unknown>) => w(tx)) } as unknown as PrismaService;
    const runs = { iniciar: jest.fn(async () => ({ runId: 'r' })) } as unknown as RunsService;
    return { svc: new AgendadorService(prisma, runs), runs, tx };
  };

  it('janela vencida: abre UM run sem contato com dedupe por janela e avança para a próxima', async () => {
    const janela = new Date('2026-11-11T12:00:00Z');
    const a = ambienteVarredura({ proximo: janela });
    const r = await a.svc.varrer(T, new Date('2026-11-11T12:00:30Z'));
    expect(r).toEqual({ janelas: 1, runs: 1 });
    expect(a.runs.iniciar).toHaveBeenCalledWith(expect.objectContaining({ gatilho: 'gatilho.agendado', dedupeKey: `agendado:g:${janela.toISOString()}` }));
    expect(a.tx.workflowSchedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ proximoEm: new Date('2026-11-12T12:00:00.000Z'), ultimaJanela: janela, leaseUntil: null }) }));
  });

  it('segmento: um run por contato, dedupe por janela + contato', async () => {
    const a = ambienteVarredura({ proximo: new Date('2026-11-11T12:00:00Z'), grafo: grafoDe('gatilho.agendado', { alvo: 'segmento', tags: ['vip'] }), contatos: [CONTATO, { ...CONTATO, id: 'c2' }] });
    const r = await a.svc.varrer(T, new Date('2026-11-11T12:01:00Z'));
    expect(r.runs).toBe(2);
    expect((a.runs.iniciar as jest.Mock).mock.calls[1][0].dedupeKey).toMatch(/:c2$/);
  });

  it('janela perdida há mais de 6h (worker parado) não dispara, só avança', async () => {
    const a = ambienteVarredura({ proximo: new Date('2026-11-10T12:00:00Z') });
    const r = await a.svc.varrer(T, new Date('2026-11-11T12:00:00Z'));
    expect(r.runs).toBe(0);
    expect(a.runs.iniciar).not.toHaveBeenCalled();
    expect(a.tx.workflowSchedule.updateMany).toHaveBeenCalled();
  });

  it('linha órfã (fluxo pausado) sai da agenda sem disparar', async () => {
    const a = ambienteVarredura({ proximo: new Date('2026-11-11T12:00:00Z'), status: 'pausado' });
    await a.svc.varrer(T, new Date('2026-11-11T12:00:10Z'));
    expect(a.runs.iniciar).not.toHaveBeenCalled();
    expect(a.tx.workflowSchedule.deleteMany).toHaveBeenCalled();
  });

  it('falha no disparo devolve o lease (a próxima varredura refaz a MESMA janela)', async () => {
    const a = ambienteVarredura({ proximo: new Date('2026-11-11T12:00:00Z') });
    (a.runs.iniciar as jest.Mock).mockRejectedValueOnce(new Error('redis fora'));
    await a.svc.varrer(T, new Date('2026-11-11T12:00:10Z'));
    expect(a.tx.workflowSchedule.updateMany).toHaveBeenCalledWith({ where: { workflowId: 'w1', nodeId: 'g' }, data: { leaseUntil: null } });
  });
});

// ------------------------------------------------------------- publicação
describe('Q3.1 · validação de publicação dos nós novos', () => {
  const svc = new WorkflowsService({} as PrismaService, {} as RunsService, { get: () => undefined } as unknown as ConfigService);
  const base = (meio: Grafo['nos'][number], arestas: Grafo['arestas']): Grafo => ({
    nos: [{ id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} }, meio, { id: 'fim', tipo: 'controle.encerrar', posicao: { x: 2, y: 0 }, config: {} }],
    arestas: [{ id: 'a0', de: 'g', para: meio.id }, ...arestas],
  });

  it('"Esperar até" no modo evento exige as duas saídas; no modo data, saída única', () => {
    const evento = base({ id: 'ea', tipo: 'controle.esperar_ate', posicao: { x: 1, y: 0 }, config: { modo: 'evento', evento: 'mensagem_recebida', duracao: 1, unidade: 'dias' } }, [{ id: 'a1', de: 'ea', para: 'fim', ramo: 'aconteceu' }]);
    expect(svc.validar(evento).map((p) => p.problema).join(' ')).toMatch(/Prazo expirou/);
    const data = base({ id: 'ea', tipo: 'controle.esperar_ate', posicao: { x: 1, y: 0 }, config: { modo: 'data', data: '2027-01-01' } }, [{ id: 'a1', de: 'ea', para: 'fim' }]);
    expect(svc.validar(data)).toEqual([]);
  });

  it('referências no banco: campo personalizado inexistente/sem tipo data e usuário fora da conta', async () => {
    const grafo: Grafo = {
      nos: [
        { id: 'g', tipo: 'gatilho.data_contato', posicao: { x: 0, y: 0 }, config: { campo: 'contato.campos.plano' } },
        { id: 'u', tipo: 'acao.atualizar_contato', posicao: { x: 1, y: 0 }, config: { campos: [{ chave: 'sumiu', valor: 'x' }] } },
        { id: 'r', tipo: 'acao.atribuir_usuario', posicao: { x: 2, y: 0 }, config: { modo: 'fixo', usuarioId: U1 } },
      ],
      arestas: [],
    };
    const tx = {
      customFieldDef: { findMany: jest.fn(async () => [{ chave: 'plano', tipo: 'text' }]) },
      membership: { findMany: jest.fn(async () => []) },
    } as unknown as Prisma.TransactionClient;
    const problemas = (await validarReferencias(tx, T, grafo)).map((p) => `${p.noId}:${p.problema}`);
    expect(problemas).toEqual(expect.arrayContaining([
      expect.stringMatching(/^g:.*não é do tipo data/),
      expect.stringMatching(/^u:.*"sumiu".*não existe/),
      expect.stringMatching(/^r:.*não é membro/),
    ]));
  });
});

import { RunsService, idDeJob } from './runs.service';
import type { ExecutorService } from './executor.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Grafo } from './catalogo';
import type { Queue } from 'bullmq';

const TENANT = '11111111-1111-1111-1111-111111111111';

/** gatilho → sms → espera 1 dia → condição (ramo vip | else) */
const GRAFO: Grafo = {
  nos: [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} },
    { id: 'sms', tipo: 'acao.enviar_sms', posicao: { x: 1, y: 0 }, config: { texto: 'oi' } },
    { id: 'wait', tipo: 'controle.esperar', posicao: { x: 2, y: 0 }, config: { duracao: 1, unidade: 'dias' } },
    { id: 'cond', tipo: 'controle.condicao', posicao: { x: 3, y: 0 }, config: { ramos: [{ id: 'vip', juncao: 'AND', rotulo: 'VIP', regras: [] }] } },
    { id: 'tag', tipo: 'acao.adicionar_tag', posicao: { x: 4, y: 0 }, config: { tag: 'x' } },
  ],
  arestas: [
    { id: 'a1', de: 'g', para: 'sms' },
    { id: 'a2', de: 'sms', para: 'wait' },
    { id: 'a3', de: 'wait', para: 'cond' },
    { id: 'a4', de: 'cond', para: 'tag', ramo: 'vip' },
  ],
};

function ambiente(runInicial: Record<string, unknown> = {}) {
  const run: Record<string, unknown> = {
    id: 'run1', workflowId: 'wf1', versionId: 'v1', status: 'rodando', noAtual: 'sms',
    estado: { contato: { id: 'c1', nome: 'Ana', tags: [] } }, passos: 0,
    startedAt: new Date('2026-01-01T12:00:00Z'), scheduledAt: new Date('2026-01-01T12:00:00Z'),
    version: { grafo: GRAFO }, ...runInicial,
  };
  const steps: any[] = [];
  const dlq: any[] = [];
  const enfileirados: any[] = [];

  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        workflowRun: {
          findUnique: jest.fn(async () => run),
          create: jest.fn(async ({ data }: any) => { if (data.dedupeKey === 'DUPLICADO') { const e: any = new Error('unique'); e.code = 'P2002'; throw e; } return { id: 'run-novo' }; }),
          update: jest.fn(async ({ data }: any) => { Object.assign(run, data, data.passos ? { passos: (run.passos as number) + 1 } : {}); return run; }),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        workflow: { findUnique: jest.fn(async () => ({ reentrada: 'sempre' })) },
        workflowRunStep: { create: jest.fn(async ({ data }: any) => { steps.push(data); return data; }) },
        workflowDlq: { create: jest.fn(async ({ data }: any) => { dlq.push(data); return data; }) },
      }),
    ),
  } as unknown as PrismaService;

  const fila = { add: jest.fn(async (_n: string, dados: unknown, opts: unknown) => { enfileirados.push({ dados, opts }); }) } as unknown as Queue;
  const eventos = { publicar: jest.fn() } as unknown as DomainEventsService;
  return { run, steps, dlq, enfileirados, prisma, fila, eventos };
}

const executorQue = (r: unknown) => ({ executar: jest.fn(async () => r) } as unknown as ExecutorService);

describe('RunsService (Sprint E — orquestração)', () => {
  it('executa o nó, loga o passo e enfileira o próximo', async () => {
    const a = ambiente();
    const svc = new RunsService(a.prisma, executorQue({ saida: { ok: 1 } }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);

    expect(a.steps[0]).toMatchObject({ noId: 'sms', tipo: 'acao.enviar_sms', status: 'ok' });
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'wait' }); // seguiu a aresta
    expect(a.run.noAtual).toBe('wait');
  });

  it('espera de 1 dia vira delay na fila — nada de timer na memória (relógio real)', async () => {
    // BUG-021: sem relógio congelado. O delay pedido é o piso do job; antes, o
    // recálculo `scheduledAt - agora` encolhia alguns ms sob carga.
    const a = ambiente({ noAtual: 'wait' });
    const svc = new RunsService(a.prisma, executorQue({ esperarMs: 86_400_000 }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'wait' }, 1);

    expect(a.enfileirados[0].opts).toMatchObject({ delay: 86_400_000 });
    expect(a.run.status).toBe('esperando'); // o estado está no banco: sobrevive a restart
  });

  it('REGRESSÃO BUG-021: latência entre agendar e enfileirar não encolhe o delay', async () => {
    const a = ambiente({ noAtual: 'wait' });
    // simula 250 ms de latência do banco entre `avancar` e `enfileirar`
    const real = Date.now;
    let desvio = 0;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => real() + desvio);
    try {
      const executor = { executar: jest.fn(async () => ({ esperarMs: 86_400_000 })) } as unknown as ExecutorService;
      const fila = { add: jest.fn(async (_n: string, dados: unknown, opts: unknown) => { a.enfileirados.push({ dados, opts }); }) } as unknown as Queue;
      const svc = new RunsService(a.prisma, executor, a.eventos, fila);
      const update = (a.prisma.withTenant as jest.Mock).getMockImplementation()!;
      (a.prisma.withTenant as jest.Mock).mockImplementation(async (t: string, work: (tx: unknown) => Promise<unknown>) => {
        const r = await update(t, work);
        if (a.run.status === 'esperando') desvio = 250; // depois de gravar scheduledAt
        return r;
      });
      await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'wait' }, 1);
      expect(a.enfileirados[0].opts.delay).toBe(86_400_000);
    } finally {
      spy.mockRestore();
    }
  });

  it('run de teste do rascunho executa o grafo congelado nele (Q1.3), não a versão', async () => {
    const rascunho: Grafo = {
      nos: [...GRAFO.nos, { id: 'nota', tipo: 'acao.criar_nota', posicao: { x: 5, y: 0 }, config: { corpo: 'só no rascunho' } }],
      arestas: [{ id: 'a1', de: 'g', para: 'sms' }, { id: 'ax', de: 'sms', para: 'nota' }],
    };
    const a = ambiente({ teste: true, grafoTeste: rascunho });
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'nota' }); // aresta que só existe no rascunho
  });

  it('iniciar com teste + grafoTeste grava o grafo congelado no run', async () => {
    const a = ambiente();
    const criados: any[] = [];
    const withTenant = (a.prisma.withTenant as jest.Mock).getMockImplementation()!;
    (a.prisma.withTenant as jest.Mock).mockImplementation(async (t: string, work: (tx: any) => Promise<unknown>) =>
      withTenant(t, async (tx: any) => {
        tx.workflowRun.create = jest.fn(async ({ data }: any) => { criados.push(data); return { id: 'run-novo' }; });
        return work(tx);
      }),
    );
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    await svc.iniciar({ tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'teste', grafo: GRAFO, noInicial: 'g', contexto: {}, teste: true, grafoTeste: GRAFO });
    expect(criados[0]).toMatchObject({ teste: true, grafoTeste: GRAFO });
  });

  it('condição sem ramo casado e só saídas de ramo: encerra (não segue o 1º ramo)', async () => {
    const a = ambiente({ noAtual: 'cond' });
    const svc = new RunsService(a.prisma, executorQue({ ramo: undefined }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'cond' }, 1);
    expect(a.enfileirados).toHaveLength(0);
    expect(a.run.status).toBe('concluido');
  });

  it('IDEMPOTÊNCIA: job reentregue para um nó que já passou é ignorado', async () => {
    const a = ambiente({ noAtual: 'wait' }); // o run já avançou
    const executor = executorQue({});
    const svc = new RunsService(a.prisma, executor, a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1); // job antigo
    expect(executor.executar).not.toHaveBeenCalled();
    expect(a.enfileirados).toHaveLength(0);
  });

  it('run concluído/cancelado não executa mais nada', async () => {
    for (const status of ['concluido', 'cancelado', 'falhou']) {
      const a = ambiente({ status });
      const executor = executorQue({});
      await new RunsService(a.prisma, executor, a.eventos, a.fila).processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
      expect(executor.executar).not.toHaveBeenCalled();
    }
  });

  it('condição segue a aresta DO RAMO que casou', async () => {
    const a = ambiente({ noAtual: 'cond' });
    const svc = new RunsService(a.prisma, executorQue({ ramo: 'vip' }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'cond' }, 1);
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'tag' });
  });

  it('condição sem ramo casado encerra o fluxo (não segue caminho errado)', async () => {
    const a = ambiente({ noAtual: 'cond' });
    const svc = new RunsService(a.prisma, executorQue({ ramo: 'nao-existe' }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'cond' }, 1);
    expect(a.run.status).toBe('concluido');
    expect(a.enfileirados).toHaveLength(0);
  });

  it('fim do grafo conclui a execução', async () => {
    const a = ambiente({ noAtual: 'tag' });
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'tag' }, 1);
    expect(a.run.status).toBe('concluido');
    expect(a.run.finishedAt).toBeTruthy();
  });

  it('nó que falha propaga (o BullMQ faz o retry) e loga a tentativa', async () => {
    const a = ambiente();
    const executor = { executar: jest.fn(async () => { throw new Error('STEVO fora do ar'); }) } as unknown as ExecutorService;
    const svc = new RunsService(a.prisma, executor, a.eventos, a.fila);
    await expect(svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 2)).rejects.toThrow('STEVO fora do ar');
    expect(a.steps[0]).toMatchObject({ status: 'falhou', tentativa: 2, erro: 'STEVO fora do ar' });
  });

  it('aoFalhar="seguir" é o fallback do PRD: pula o nó quebrado e continua', async () => {
    const a = ambiente();
    (a.run.version as { grafo: Grafo }).grafo = { ...GRAFO, nos: GRAFO.nos.map((n) => (n.id === 'sms' ? { ...n, aoFalhar: 'seguir' as const } : n)) };
    const executor = { executar: jest.fn(async () => { throw new Error('caiu'); }) } as unknown as ExecutorService;
    const svc = new RunsService(a.prisma, executor, a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'wait' }); // seguiu mesmo com falha
    expect(a.run.status).toBe('rodando');
  });

  it('retry esgotado vai para o DLQ e marca a run como falha', async () => {
    const a = ambiente();
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    await svc.paraDlq({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 'STEVO 500', 4);
    expect(a.dlq[0]).toMatchObject({ noId: 'sms', tipo: 'acao.enviar_sms', erro: 'STEVO 500', tentativas: 4 });
    expect(a.run.status).toBe('falhou');
  });

  it('LOOP: ir_para em círculo para no limite de passos, não roda para sempre', async () => {
    const a = ambiente({ passos: 200 });
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect(a.run.status).toBe('falhou');
    expect(a.dlq[0].erro).toMatch(/limite de 200 passos/);
  });

  it('gatilho duplicado não abre uma segunda execução', async () => {
    const a = ambiente();
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    const r = await svc.iniciar({
      tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'gatilho.contato_criado',
      grafo: GRAFO, noInicial: 'g', contexto: {}, dedupeKey: 'DUPLICADO',
    });
    expect(r).toEqual({ duplicado: true });
    expect(a.enfileirados).toHaveLength(0);
  });

  it('iniciar enfileira o nó SEGUINTE ao gatilho (gatilho não executa)', async () => {
    const a = ambiente();
    const svc = new RunsService(a.prisma, executorQue({}), a.eventos, a.fila);
    const r = await svc.iniciar({
      tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'gatilho.contato_criado',
      grafo: GRAFO, noInicial: 'g', contexto: { contato: { id: 'c1' } as never },
    });
    expect(r).toEqual({ runId: 'run-novo' });
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'sms' });
  });

  it('jobId é determinístico: reentrega do mesmo passo não duplica trabalho', async () => {
    const a = ambiente();
    const svc = new RunsService(a.prisma, executorQue({ saida: {} }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    const primeiro = (a.enfileirados[0].opts as { jobId: string }).jobId;

    const b = ambiente();
    const svc2 = new RunsService(b.prisma, executorQue({ saida: {} }), b.eventos, b.fila);
    await svc2.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect((b.enfileirados[0].opts as { jobId: string }).jobId).toBe(primeiro);
  });

  /**
   * Regressão do BUG-010: o BullMQ recusa ':' no jobId ("Custom Id cannot
   * contain :") e o `add()` lançava — nenhum passo era enfileirado, nenhuma
   * automação rodava. O mock aceitava qualquer string e o teste passava.
   */
  it('jobId NUNCA contém ":" — nem quando o id do nó vem torto do usuário', async () => {
    const a = ambiente({ noAtual: 'sms' });
    const svc = new RunsService(a.prisma, executorQue({ saida: {} }), a.eventos, a.fila);
    await svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect((a.enfileirados[0].opts as { jobId: string }).jobId).not.toContain(':');

    // id de nó com caracteres proibidos não pode derrubar o enfileiramento
    expect(idDeJob('run1', 'nó:com:dois-pontos e espaço', '0')).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(idDeJob('a'.repeat(300), 'b', '0').length).toBeLessThanOrEqual(200);
  });
});

describe('RunsService — resposta do contato no meio do fluxo (importação do GHL)', () => {
  it('avisarResposta leva o TEXTO da resposta e marca a base da trava', async () => {
    const atualizacoes: any[] = [];
    const run = { id: 'r9', noAtual: 'esp', estado: { contato: { id: 'c1', nome: 'Ana', tags: [] }, aguardandoResposta: 'esp' }, workflow: { id: 'wf1', pararNoReply: false } };
    const prisma = {
      withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
        work({ workflowRun: { findMany: jest.fn(async () => [run]), findUnique: jest.fn(async () => ({ ...run, generation: 1, scheduledAt: new Date() })), update: jest.fn(async ({ data }: any) => { atualizacoes.push(data); return data; }) } }),
      ),
    } as unknown as PrismaService;
    const fila = { add: jest.fn(async () => undefined), getJob: jest.fn(async () => null) } as unknown as Queue;
    const svc = new RunsService(prisma, executorQue({}), { publicar: jest.fn() } as unknown as DomainEventsService, fila);
    await svc.avisarResposta(TENANT, 'c1', { id: 'm7', texto: 'Vi no Instagram' });
    const estado = atualizacoes[0].estado;
    expect(estado).toMatchObject({ respondeu: true, mensagem: { id: 'm7', texto: 'Vi no Instagram', de: 'contato' } });
    expect(typeof estado.baseResposta).toBe('string');
  });

  it('depois da resposta consumida, a trava de envio conta a partir dela (boas-vindas pós-resposta não são canceladas)', async () => {
    const a = ambiente({ estado: { contato: { id: 'c1', nome: 'Ana', tags: [] }, baseResposta: '2026-01-02T09:00:00.000Z' } });
    const executor = executorQue({ saida: { ok: 1 } });
    await new RunsService(a.prisma, executor, a.eventos, a.fila).processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect((executor.executar as jest.Mock).mock.calls[0][2].runStartedAt).toBe('2026-01-02T09:00:00.000Z');
  });
});

describe('RunsService — duas mensagens rápidas do contato (importação do GHL)', () => {
  it('a segunda mensagem NÃO sobrescreve a resposta que a condição ainda vai ler', async () => {
    const atualizacoes: any[] = [];
    const run = { id: 'r10', noAtual: 'esp', estado: { contato: { id: 'c1', nome: 'Ana', tags: [] }, aguardandoResposta: 'esp', respondeu: true, mensagem: { id: 'm1', texto: 'Instagram', de: 'contato' } }, workflow: { id: 'wf1', pararNoReply: false } };
    const prisma = {
      withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
        work({ workflowRun: { findMany: jest.fn(async () => [run]), findUnique: jest.fn(async () => ({ ...run, generation: 1, scheduledAt: new Date() })), update: jest.fn(async ({ data }: any) => { atualizacoes.push(data); return data; }) } }),
      ),
    } as unknown as PrismaService;
    const fila = { add: jest.fn(async () => undefined), getJob: jest.fn(async () => null) } as unknown as Queue;
    const svc = new RunsService(prisma, executorQue({}), { publicar: jest.fn() } as unknown as DomainEventsService, fila);
    await svc.avisarResposta(TENANT, 'c1', { id: 'm2', texto: 'Quero progressiva' });
    expect(atualizacoes).toHaveLength(0);
  });
});

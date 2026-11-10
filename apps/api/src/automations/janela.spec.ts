import { RunsService } from './runs.service';
import type { ExecutorService } from './executor.service';
import type { DomainEventsService } from '../events/domain-events.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { Queue } from 'bullmq';
import type { Grafo } from './catalogo';

const TENANT = '11111111-1111-1111-1111-111111111111';

const GRAFO: Grafo = {
  nos: [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} },
    { id: 'sms', tipo: 'acao.enviar_sms', posicao: { x: 1, y: 0 }, config: { texto: 'oi' } },
    { id: 'tag', tipo: 'acao.adicionar_tag', posicao: { x: 2, y: 0 }, config: { tag: 'x' } },
    { id: 'espera', tipo: 'controle.esperar_resposta', posicao: { x: 3, y: 0 }, config: { duracao: 1, unidade: 'dias' } },
    { id: 'email', tipo: 'acao.enviar_email', posicao: { x: 4, y: 0 }, config: { assunto: 'Oi', corpo: 'Olá' } },
    { id: 'equipe', tipo: 'acao.notificar_equipe', posicao: { x: 5, y: 0 }, config: { telefone: '5511999990000', texto: 'novo lead' } },
  ],
  arestas: [
    { id: 'a1', de: 'g', para: 'sms' },
    { id: 'a2', de: 'sms', para: 'tag' },
  ],
};

const JANELA_COMERCIAL = { janelaAtiva: true, janelaDias: [1, 2, 3, 4, 5], janelaInicio: 9, janelaFim: 18, timezone: 'America/Sao_Paulo' };
const SEM_JANELA = { janelaAtiva: false, janelaDias: [], janelaInicio: 9, janelaFim: 18, timezone: 'America/Sao_Paulo' };

function ambiente(noAtual: string, workflow: Record<string, unknown>) {
  const run: Record<string, unknown> = {
    id: 'run1', workflowId: 'wf1', versionId: 'v1', status: 'rodando', noAtual,
    estado: { contato: { id: 'c1', nome: 'Ana', tags: [] } }, passos: 0,
    startedAt: new Date('2026-01-01T12:00:00Z'), scheduledAt: new Date('2026-01-01T12:00:00Z'),
    version: { grafo: GRAFO }, workflow, contactId: 'c1',
  };
  const enfileirados: any[] = [];
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        workflowRun: {
          findUnique: jest.fn(async () => run),
          findFirst: jest.fn(async () => null),
          findMany: jest.fn(async () => []),
          create: jest.fn(async () => ({ id: 'run-novo' })),
          update: jest.fn(async ({ data }: any) => { Object.assign(run, data); return run; }),
          updateMany: jest.fn(async () => ({ count: 1 })),
        },
        workflow: { findUnique: jest.fn(async () => ({ reentrada: 'uma_vez' })) },
        workflowRunStep: { create: jest.fn(async () => ({})) },
        workflowDlq: { create: jest.fn(async () => ({})) },
      }),
    ),
  } as unknown as PrismaService;
  const fila = { add: jest.fn(async (_n: string, dados: unknown, opts: unknown) => { enfileirados.push({ dados, opts }); }) } as unknown as Queue;
  const eventos = { publicar: jest.fn() } as unknown as DomainEventsService;
  const executor = { executar: jest.fn(async () => ({ saida: {} })) } as unknown as ExecutorService;
  return { run, enfileirados, prisma, fila, eventos, executor, svc: new RunsService(prisma, executor, eventos, fila) };
}

/** Congela "agora" num horário/dia conhecido, no fuso de São Paulo. */
function congelar(iso: string) {
  jest.useFakeTimers().setSystemTime(new Date(iso));
}

describe('Janela de envio (E.2) — não mandar mensagem de madrugada', () => {
  afterEach(() => jest.useRealTimers());

  it('dentro do horário comercial: manda na hora', async () => {
    congelar('2026-07-15T17:00:00Z'); // quarta, 14h em São Paulo
    const a = ambiente('sms', JANELA_COMERCIAL);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect(a.executor.executar).toHaveBeenCalled();
  });

  it('3h da manhã: NÃO executa — adia para a janela abrir', async () => {
    congelar('2026-07-15T06:00:00Z'); // quarta, 3h em São Paulo
    const a = ambiente('sms', JANELA_COMERCIAL);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);

    expect(a.executor.executar).not.toHaveBeenCalled();
    expect(a.run.status).toBe('esperando');
    // reagenda o MESMO nó, com delay até as 9h (~6h)
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'sms' });
    const delayHoras = a.enfileirados[0].opts.delay / 3_600_000;
    expect(delayHoras).toBeGreaterThan(5);
    expect(delayHoras).toBeLessThan(7);
  });

  it('sábado: espera até segunda (dia fora da janela)', async () => {
    congelar('2026-07-18T15:00:00Z'); // sábado, 12h em São Paulo
    const a = ambiente('sms', JANELA_COMERCIAL);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);

    expect(a.executor.executar).not.toHaveBeenCalled();
    const delayHoras = a.enfileirados[0].opts.delay / 3_600_000;
    expect(delayHoras).toBeGreaterThan(24); // pelo menos até domingo passar
  });

  it('a janela só segura MENSAGEM: mexer em tag/etapa roda a qualquer hora', async () => {
    congelar('2026-07-15T06:00:00Z'); // 3h da manhã
    const a = ambiente('tag', JANELA_COMERCIAL);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'tag' }, 1);
    expect(a.executor.executar).toHaveBeenCalled(); // tag não incomoda ninguém às 3h
  });

  it('Q1.2: e-mail ao contato também respeita a janela', async () => {
    congelar('2026-07-15T06:00:00Z'); // 3h da manhã
    const a = ambiente('email', JANELA_COMERCIAL);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'email' }, 1);
    expect(a.executor.executar).not.toHaveBeenCalled();
    expect(a.enfileirados[0].dados).toMatchObject({ noId: 'email' });
  });

  it('Q1.2: "Notificar equipe" roda a qualquer hora por padrão (aviso interno é urgente)', async () => {
    congelar('2026-07-15T06:00:00Z');
    const a = ambiente('equipe', JANELA_COMERCIAL);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'equipe' }, 1);
    expect(a.executor.executar).toHaveBeenCalled();
  });

  it('Q1.2: "Notificar equipe" espera a janela quando o fluxo marca janelaIncluiEquipe', async () => {
    congelar('2026-07-15T06:00:00Z');
    const a = ambiente('equipe', { ...JANELA_COMERCIAL, janelaIncluiEquipe: true });
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'equipe' }, 1);
    expect(a.executor.executar).not.toHaveBeenCalled();
    expect(a.run.status).toBe('esperando');
  });

  it('janela desligada: manda a qualquer hora', async () => {
    congelar('2026-07-15T06:00:00Z');
    const a = ambiente('sms', SEM_JANELA);
    await a.svc.processarPasso({ tenantId: TENANT, runId: 'run1', noId: 'sms' }, 1);
    expect(a.executor.executar).toHaveBeenCalled();
  });
});

describe('Reentrada (E.2) — não queimar a lista', () => {
  it('uma_vez: contato que já rodou não entra de novo', async () => {
    const a = ambiente('sms', JANELA_COMERCIAL);
    (a.prisma.withTenant as jest.Mock).mockImplementation(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        workflow: { findUnique: jest.fn(async () => ({ reentrada: 'uma_vez' })) },
        workflowRun: { findFirst: jest.fn(async () => ({ id: 'run-antigo' })), findUnique: jest.fn(async () => ({ noAtual: 'sms', scheduledAt: new Date() })), create: jest.fn() },
      }),
    );
    const r = await a.svc.iniciar({
      tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'g',
      grafo: GRAFO, noInicial: 'g', contexto: { contato: { id: 'c1' } as never },
    });
    expect(r).toEqual({ duplicado: true });
  });

  it('sempre: entra de novo sem checar histórico', async () => {
    const a = ambiente('sms', JANELA_COMERCIAL);
    const findFirst = jest.fn(async () => ({ id: 'run-antigo' }));
    (a.prisma.withTenant as jest.Mock).mockImplementation(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        workflow: { findUnique: jest.fn(async () => ({ reentrada: 'sempre' })) },
        workflowRun: { findFirst, findUnique: jest.fn(async () => ({ noAtual: 'sms', scheduledAt: new Date() })), create: jest.fn(async () => ({ id: 'run-novo' })) },
      }),
    );
    const r = await a.svc.iniciar({
      tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'g',
      grafo: GRAFO, noInicial: 'g', contexto: { contato: { id: 'c1' } as never },
    });
    expect(r).toEqual({ runId: 'run-novo' });
    expect(findFirst).not.toHaveBeenCalled(); // nem consulta: 'sempre' é sempre
  });

  it('apos_terminar: bloqueia só enquanto está correndo', async () => {
    const a = ambiente('sms', JANELA_COMERCIAL);
    const capturado: any[] = [];
    (a.prisma.withTenant as jest.Mock).mockImplementation(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        workflow: { findUnique: jest.fn(async () => ({ reentrada: 'apos_terminar' })) },
        workflowRun: { findFirst: jest.fn(async (args: any) => { capturado.push(args); return null; }), findUnique: jest.fn(async () => ({ noAtual: 'sms', scheduledAt: new Date() })), create: jest.fn(async () => ({ id: 'run-novo' })) },
      }),
    );
    await a.svc.iniciar({
      tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'g',
      grafo: GRAFO, noInicial: 'g', contexto: { contato: { id: 'c1' } as never },
    });
    expect(capturado[0].where.status).toEqual({ in: ['rodando', 'esperando'] });
  });

  it('teste manual ignora a regra de reentrada (senão não dá para testar 2x)', async () => {
    const a = ambiente('sms', JANELA_COMERCIAL);
    const findFirst = jest.fn(async () => ({ id: 'run-antigo' }));
    (a.prisma.withTenant as jest.Mock).mockImplementation(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        workflow: { findUnique: jest.fn(async () => ({ reentrada: 'uma_vez' })) },
        workflowRun: { findFirst, findUnique: jest.fn(async () => ({ noAtual: 'sms', scheduledAt: new Date() })), create: jest.fn(async () => ({ id: 'run-teste' })) },
      }),
    );
    const r = await a.svc.iniciar({
      tenantId: TENANT, workflowId: 'wf1', versionId: 'v1', gatilho: 'g',
      grafo: GRAFO, noInicial: 'g', contexto: { contato: { id: 'c1' } as never }, teste: true,
    });
    expect(r).toEqual({ runId: 'run-teste' });
  });
});

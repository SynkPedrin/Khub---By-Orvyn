import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EditorService, normalizarDesde, rotuloDoNo } from './editor.service';
import { WorkflowsService } from './workflows.service';
import { grafoSchema, type Grafo } from './catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { RunsService } from './runs.service';
import type { ConfigService } from '../config/config.service';

const TENANT = '11111111-1111-1111-1111-111111111111';
const WF = '33333333-3333-4333-8333-333333333333';

/** Prisma falso: `withTenant` só repassa o tx (a RLS é provada no SQL de db/058). */
function prismaCom(tx: Record<string, unknown>) {
  return { withTenant: jest.fn((_t: string, fn: (x: unknown) => unknown) => fn(tx)) } as unknown as PrismaService;
}

describe('normalizarDesde', () => {
  const agora = new Date('2026-11-10T12:00:00Z');
  it('padrão: 7 dias atrás', () => {
    expect(normalizarDesde(undefined, agora).toISOString()).toBe('2026-11-03T12:00:00.000Z');
  });
  it('data inválida ou no futuro é 400', () => {
    expect(() => normalizarDesde('ontem', agora)).toThrow(BadRequestException);
    expect(() => normalizarDesde('2026-12-01', agora)).toThrow(BadRequestException);
  });
  it('mais de 90 dias vira o piso de 90 dias', () => {
    expect(normalizarDesde('2020-01-01', agora).toISOString()).toBe('2026-08-12T12:00:00.000Z');
  });
});

describe('rotuloDoNo', () => {
  const grafo = { nos: [{ id: 'a', tipo: 'controle.esperar', posicao: { x: 0, y: 0 }, config: {} }, { id: 'b', tipo: 'acao.adicionar_tag', rotulo: 'Marca VIP', posicao: { x: 0, y: 0 }, config: {} }], arestas: [] };
  it('usa o rótulo do usuário, senão o nome do catálogo', () => {
    expect(rotuloDoNo(grafo, 'b')).toBe('Marca VIP');
    expect(rotuloDoNo(grafo, 'a')).toBe('Esperar');
  });
  it('nó inexistente, sem nó ou grafo corrompido: null', () => {
    expect(rotuloDoNo(grafo, 'zz')).toBeNull();
    expect(rotuloDoNo(grafo, null)).toBeNull();
    expect(rotuloDoNo({ nos: 'x' }, 'a')).toBeNull();
  });
});

describe('EditorService.estatisticas', () => {
  it('junta concluídos/erros por nó com quem está parado agora e soma os totais', async () => {
    const queryRaw = jest.fn()
      .mockResolvedValueOnce([{ no_id: 'g', concluidos: 10n, erros: 0n }, { no_id: 'm', concluidos: 7n, erros: 2n }])
      .mockResolvedValueOnce([{ no_atual: 'e', n: 3n }, { no_atual: 'm', n: 1n }])
      .mockResolvedValueOnce([{ entraram: 10n, concluidos: 5n, erros: 2n }]);
    const tx = { workflow: { findUnique: jest.fn().mockResolvedValue({ id: WF }) }, $queryRaw: queryRaw };
    const svc = new EditorService(prismaCom(tx));
    const desde = new Date('2026-11-03T00:00:00Z');

    const r = await svc.estatisticas(TENANT, WF, desde);

    expect(r.desde).toBe('2026-11-03T00:00:00.000Z');
    expect(r.nos).toEqual({
      g: { concluidos: 10, esperando: 0, erros: 0 },
      m: { concluidos: 7, esperando: 1, erros: 2 },
      e: { concluidos: 0, esperando: 3, erros: 0 },
    });
    expect(r.total).toEqual({ entraram: 10, concluidos: 5, esperando: 4, erros: 2 });
    // o período e o fluxo vão como parâmetro (nunca interpolados no SQL)
    const [sql, ...valores] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(sql.join('?')).toContain('r.teste = false');
    expect(valores).toEqual(expect.arrayContaining([WF, desde]));
  });

  it('fluxo de outro tenant (RLS esconde) é 404', async () => {
    const tx = { workflow: { findUnique: jest.fn().mockResolvedValue(null) }, $queryRaw: jest.fn() };
    await expect(new EditorService(prismaCom(tx)).estatisticas(TENANT, WF, new Date())).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('EditorService.versoes', () => {
  it('lista número, data, autor (nome do usuário), nº de nós e marca a ativa', async () => {
    const tx = {
      workflow: { findUnique: jest.fn().mockResolvedValue({ versaoAtivaId: 'v1' }) },
      workflowVersion: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'v2', versao: 2, publicadoEm: new Date('2026-11-09'), publicadoPor: 'ident-1', grafo: { nos: [{ id: 'a', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} }, { id: 'b', tipo: 'controle.encerrar', posicao: { x: 0, y: 0 }, config: {} }], arestas: [] } },
          { id: 'v1', versao: 1, publicadoEm: new Date('2026-11-01'), publicadoPor: null, grafo: { lixo: true } },
        ]),
      },
      user: { findMany: jest.fn().mockResolvedValue([{ identityId: 'ident-1', nome: 'Ana' }]) },
    };
    const r = await new EditorService(prismaCom(tx)).versoes(TENANT, WF);
    expect(r).toEqual([
      { id: 'v2', versao: 2, publicadoEm: new Date('2026-11-09'), autor: { id: 'ident-1', nome: 'Ana' }, nos: 2, ativa: false },
      { id: 'v1', versao: 1, publicadoEm: new Date('2026-11-01'), autor: null, nos: 0, ativa: true },
    ]);
  });
});

describe('EditorService.duplicar', () => {
  it('copia o rascunho e as configurações, nasce em rascunho e SEM credencial de webhook', async () => {
    const original = {
      id: WF, nome: 'Boas-vindas', descricao: 'd', tags: ['vip'], pasta: 'Vendas', reentrada: 'sempre', pararNoReply: true,
      janelaAtiva: true, janelaDias: [1, 2], janelaInicio: 8, janelaFim: 20, timezone: 'America/Recife', janelaIncluiEquipe: true,
      webhookKey: 'chave-original', webhookSegredo: 'whsec_original', versaoAtiva: { grafo: { nos: [], arestas: [], publicado: true } },
    };
    const rascunho = { grafo: { nos: [{ id: 'n1' }], arestas: [] } };
    const tx = {
      workflow: { findUnique: jest.fn().mockResolvedValue(original), create: jest.fn().mockResolvedValue({ id: 'novo', nome: 'Boas-vindas (cópia)' }) },
      workflowVersion: { findFirst: jest.fn().mockResolvedValue(rascunho), create: jest.fn().mockResolvedValue({}) },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const r = await new EditorService(prismaCom(tx)).duplicar(TENANT, 'ident-1', WF);

    expect(r).toEqual({ id: 'novo', nome: 'Boas-vindas (cópia)' });
    const data = (tx.workflow.create.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(data).toMatchObject({ tenantId: TENANT, nome: 'Boas-vindas (cópia)', status: 'rascunho', pasta: 'Vendas', tags: ['vip'], reentrada: 'sempre', janelaIncluiEquipe: true, criadoPor: 'ident-1' });
    expect(data).not.toHaveProperty('webhookKey');
    expect(data).not.toHaveProperty('webhookSegredo');
    expect(tx.workflowVersion.create).toHaveBeenCalledWith({ data: { tenantId: TENANT, workflowId: 'novo', versao: 1, grafo: rascunho.grafo } });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1); // audit log
  });
});

describe('EditorService.runsDoContato', () => {
  it('resolve o passo atual pelo grafo da versão (um SELECT por versão) e pelo grafo de teste', async () => {
    const grafoV = { nos: [{ id: 'esp', tipo: 'controle.esperar', rotulo: 'Espera 1 dia', posicao: { x: 0, y: 0 }, config: {} }], arestas: [] };
    const base = { gatilho: 'g', erro: null, startedAt: new Date(), finishedAt: null, workflow: { nome: 'Fluxo X' } };
    const tx = {
      workflowRun: {
        findMany: jest.fn().mockResolvedValue([
          { ...base, id: 'r1', workflowId: WF, versionId: 'v1', status: 'esperando', noAtual: 'esp', teste: false, grafoTeste: null },
          { ...base, id: 'r2', workflowId: WF, versionId: 'v1', status: 'concluido', noAtual: null, teste: false, grafoTeste: null },
          { ...base, id: 'r3', workflowId: WF, versionId: 'v9', status: 'rodando', noAtual: 't', teste: true, grafoTeste: { nos: [{ id: 't', tipo: 'acao.adicionar_tag', posicao: { x: 0, y: 0 }, config: {} }], arestas: [] } },
        ]),
      },
      workflowVersion: { findMany: jest.fn().mockResolvedValue([{ id: 'v1', grafo: grafoV }]) },
    };
    const r = await new EditorService(prismaCom(tx)).runsDoContato(TENANT, 'contato-1');

    expect(tx.workflowVersion.findMany).toHaveBeenCalledWith({ where: { id: { in: ['v1'] } }, select: { id: true, grafo: true } });
    expect(r.map((x) => [x.id, x.noAtualRotulo, x.ativo, x.workflowNome])).toEqual([
      ['r1', 'Espera 1 dia', true, 'Fluxo X'],
      ['r2', null, false, 'Fluxo X'],
      ['r3', 'Adicionar tag', true, 'Fluxo X'],
    ]);
  });
});

describe('EditorService.cancelarRun ("remover deste fluxo")', () => {
  const montar = (count: number) => ({
    workflowRun: {
      findUnique: jest.fn().mockResolvedValue({ id: 'r1', workflowId: WF, contactId: 'c1' }),
      updateMany: jest.fn().mockResolvedValue({ count }),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
  });

  it('cancela só execução ativa e audita', async () => {
    const tx = montar(1);
    await expect(new EditorService(prismaCom(tx)).cancelarRun(TENANT, 'r1', 'ident-1')).resolves.toEqual({ ok: true, cancelado: true });
    expect(tx.workflowRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'r1', status: { in: ['rodando', 'esperando'] } } }));
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it('execução já terminada: não audita e diz que não havia o que cancelar', async () => {
    const tx = montar(0);
    await expect(new EditorService(prismaCom(tx)).cancelarRun(TENANT, 'r1', 'ident-1')).resolves.toEqual({ ok: true, cancelado: false });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

describe('Notas no canvas (Q3.3): nunca viram passo', () => {
  const grafo = {
    nos: [
      { id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} },
      { id: 't', tipo: 'acao.adicionar_tag', posicao: { x: 0, y: 160 }, config: { tag: 'novo' } },
    ],
    arestas: [{ id: 'a', de: 'g', para: 't' }],
    notas: [{ id: 'nota1', texto: 'Lembrar de revisar o texto', posicao: { x: 300, y: 0 } }],
  };

  it('o schema guarda as notas junto do grafo (versionadas)', () => {
    const g = grafoSchema.parse(grafo);
    expect(g.notas).toEqual([{ id: 'nota1', texto: 'Lembrar de revisar o texto', posicao: { x: 300, y: 0 } }]);
    expect(g.nos.map((n) => n.id)).toEqual(['g', 't']);
  });

  it('publicar/validar ignora a nota: fluxo válido continua válido', () => {
    const svc = new WorkflowsService({} as PrismaService, {} as RunsService, { get: () => undefined } as unknown as ConfigService);
    expect(svc.validar(grafoSchema.parse(grafo) as Grafo)).toEqual([]);
  });

  it('nota com tipo de nó não entra em `nos` nem passa no schema de nó', () => {
    const r = grafoSchema.safeParse({ ...grafo, nos: [...grafo.nos, { id: 'x', tipo: 'nota', posicao: { x: 0, y: 0 }, config: {} }] });
    expect(r.success).toBe(false);
  });
});

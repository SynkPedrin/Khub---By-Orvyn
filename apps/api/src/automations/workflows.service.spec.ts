import { BadRequestException } from '@nestjs/common';
import { WorkflowsService } from './workflows.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RunsService } from './runs.service';
import type { ConfigService } from '../config/config.service';
import type { Grafo, No } from './catalogo';

const TENANT = '11111111-1111-1111-1111-111111111111';
const STAGE = '22222222-2222-4222-8222-222222222222';

const no = (id: string, tipo: string, config: Record<string, unknown> = {}, rotulo?: string): No =>
  ({ id, tipo, posicao: { x: 0, y: 0 }, config, ...(rotulo ? { rotulo } : {}) }) as No;

const svcVazio = () => new WorkflowsService({} as PrismaService, {} as RunsService, { get: () => undefined } as unknown as ConfigService);

describe('WorkflowsService.validar — Q1.5 ramificações na publicação', () => {
  const base = (nos: No[], arestas: Grafo['arestas']): Grafo => ({ nos: [no('g', 'gatilho.contato_criado'), ...nos], arestas: [{ id: 'a0', de: 'g', para: nos[0].id }, ...arestas] });

  it('condição com ramo solto: aponta o nó e o ramo pelo rótulo', () => {
    const g = base(
      [no('c', 'controle.condicao', { ramos: [{ id: 'vip', rotulo: 'VIP', juncao: 'AND', regras: [] }, { id: 'resto', rotulo: 'Resto', juncao: 'NONE', regras: [] }] }, 'É VIP?'), no('t', 'acao.adicionar_tag', { tag: 'vip' })],
      [{ id: 'a1', de: 'c', para: 't', ramo: 'vip' }],
    );
    const p = svcVazio().validar(g);
    expect(p).toEqual([{ noId: 'c', problema: expect.stringContaining('É VIP?: o ramo "Resto" não leva a lugar nenhum') }]);
  });

  it('ramo ligado a "Encerrar" conta como término explícito', () => {
    const g = base(
      [no('c', 'controle.condicao', { ramos: [{ id: 'vip', juncao: 'AND', regras: [] }, { id: 'resto', juncao: 'NONE', regras: [] }] }), no('t', 'acao.adicionar_tag', { tag: 'vip' }), no('fim', 'controle.encerrar')],
      [{ id: 'a1', de: 'c', para: 't', ramo: 'vip' }, { id: 'a2', de: 'c', para: 'fim', ramo: 'resto' }],
    );
    expect(svcVazio().validar(g)).toEqual([]);
  });

  it('split A/B: todas as variantes precisam de caminho', () => {
    const g = base(
      [no('s', 'controle.split', { ramos: [{ id: 'a', rotulo: 'A', peso: 1 }, { id: 'b', rotulo: 'B', peso: 1 }] }), no('t', 'acao.adicionar_tag', { tag: 'a' })],
      [{ id: 'a1', de: 's', para: 't', ramo: 'a' }],
    );
    expect(svcVazio().validar(g)).toEqual([{ noId: 's', problema: expect.stringContaining('Dividir (A/B): o ramo "B" não leva a lugar nenhum') }]);
  });

  it('esperar resposta: "Respondeu" e "Não respondeu" precisam estar ligados', () => {
    const g = base(
      [no('e', 'controle.esperar_resposta', { duracao: 1, unidade: 'dias' }), no('t', 'acao.adicionar_tag', { tag: 'respondeu' })],
      [{ id: 'a1', de: 'e', para: 't', ramo: 'resposta' }],
    );
    expect(svcVazio().validar(g)).toEqual([{ noId: 'e', problema: expect.stringContaining('Esperar resposta: o ramo "Não respondeu" não leva a lugar nenhum') }]);
  });

  it('conexão saindo de ramo apagado é apontada', () => {
    const g = base(
      [no('c', 'controle.condicao', { ramos: [{ id: 'vip', juncao: 'AND', regras: [] }] }), no('t', 'acao.adicionar_tag', { tag: 'vip' }), no('t2', 'acao.adicionar_tag', { tag: 'x' })],
      [{ id: 'a1', de: 'c', para: 't', ramo: 'vip' }, { id: 'a2', de: 'c', para: 't2', ramo: 'fantasma' }],
    );
    expect(svcVazio().validar(g)).toEqual([{ noId: 'c', problema: expect.stringContaining('ramo "fantasma", que não existe mais') }]);
  });

  it('REGRESSÃO RV-05.1: config legada sem `ramos` (ou `ramos` não-array) não estoura "ramos is not iterable"', () => {
    for (const config of [{ condicoes: [{ campo: 'valor', operador: 'maior_que', valor: 1 }] }, { ramos: {} }, { ramos: 'x' }]) {
      const g = base([no('c', 'controle.condicao', config), no('t', 'acao.adicionar_tag', { tag: 'x' })], [{ id: 'a1', de: 'c', para: 't' }]);
      const p = svcVazio().validar(g);
      expect(p).toEqual([expect.objectContaining({ noId: 'c', problema: expect.stringContaining('ramos') })]);
    }
  });
});

describe('WorkflowsService.testar — Q1.3 roda o RASCUNHO, não a versão publicada', () => {
  const publicado: Grafo = { nos: [no('g', 'gatilho.contato_criado'), no('t', 'acao.adicionar_tag', { tag: 'v1' })], arestas: [{ id: 'a', de: 'g', para: 't' }] };
  const rascunho: Grafo = { nos: [no('g', 'gatilho.contato_criado'), no('o', 'acao.criar_oportunidade', { titulo: 'Novo', stageId: STAGE })], arestas: [{ id: 'a', de: 'g', para: 'o' }] };
  const contato = { id: 'c1', nome: 'Ana', email: null, telefone: null, empresa: null, tag: 'Lead', tags: [], valorEstimado: 0 };

  function ambiente(temRascunho: boolean) {
    const tx = {
      workflow: { findUnique: jest.fn(async () => ({ id: 'w1', versaoAtiva: { id: 'v1', versao: 1, grafo: publicado } })) },
      workflowVersion: { findFirst: jest.fn(async () => (temRascunho ? { id: 'v2', versao: 2, grafo: rascunho } : null)) },
      contact: { findUnique: jest.fn(async () => contato) },
    };
    const prisma = { withTenant: jest.fn(async (_t: string, work: (t: unknown) => Promise<unknown>) => work(tx)) } as unknown as PrismaService;
    const runs = { iniciar: jest.fn(async () => ({ runId: 'r1' })) } as unknown as RunsService;
    return { svc: new WorkflowsService(prisma, runs, { get: () => undefined } as unknown as ConfigService), runs, tx };
  }

  it('com rascunho: executa o grafo do rascunho, congelado no run e marcado como teste', async () => {
    const a = ambiente(true);
    const r = await a.svc.testar(TENANT, 'w1', 'c1');
    expect(r).toEqual({ runId: 'r1', versao: 2, rascunho: true });
    expect(a.tx.workflowVersion.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { workflowId: 'w1', publicadoEm: null } }));
    expect(a.runs.iniciar).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'v2', teste: true, grafoTeste: expect.objectContaining({ nos: expect.arrayContaining([expect.objectContaining({ id: 'o' })]) }) }));
  });

  it('sem rascunho: usa a versão ativa (imutável), sem cópia do grafo', async () => {
    const a = ambiente(false);
    const r = await a.svc.testar(TENANT, 'w1', 'c1');
    expect(r).toEqual({ runId: 'r1', versao: 1, rascunho: false });
    expect(a.runs.iniciar).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'v1', teste: true, grafoTeste: undefined }));
  });

  it('rascunho inválido não roda: devolve os problemas', async () => {
    const a = ambiente(true);
    a.tx.workflowVersion.findFirst.mockResolvedValueOnce({ id: 'v2', versao: 2, grafo: { nos: [no('g', 'gatilho.contato_criado')], arestas: [] } } as never);
    await expect(a.svc.testar(TENANT, 'w1', 'c1')).rejects.toBeInstanceOf(BadRequestException);
    expect(a.runs.iniciar).not.toHaveBeenCalled();
  });
});

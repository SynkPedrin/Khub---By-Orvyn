import { NicoMontadorService } from './nico-montador.service';
import { WorkflowsService } from './workflows.service';
import { grafoSchema } from './catalogo';
import type { PrismaService } from '../prisma/prisma.service';
import type { AIProvider } from '../ai/provider.contract';

const TENANT = '11111111-1111-1111-1111-111111111111';
const STAGE = '22222222-2222-2222-2222-222222222222';
const USO = { entrada: 0, saida: 0, cache: 0, custoUsd: 0 };

function ambiente(respostas: string[]) {
  const generate = jest.fn();
  for (const r of respostas) generate.mockResolvedValueOnce({ texto: r, toolCalls: [], pararPor: 'fim', uso: USO, modelo: 'm', provedor: 'p' });
  const llm = { nome: 'p', configured: () => true, missing: () => [], generate } as unknown as AIProvider;
  const audit = jest.fn(async () => 1);
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        pipeline: { findMany: jest.fn(async () => [{ nome: 'Vendas', stages: [{ id: STAGE, nome: 'Novo', ordem: 1 }] }]) },
        $queryRaw: jest.fn(async () => [{ tag: 'vip' }]),
        $executeRaw: audit,
      }),
    ),
  } as unknown as PrismaService;
  // `validar` é puro: usa o validador real do editor, sem banco.
  const real = Object.create(WorkflowsService.prototype) as WorkflowsService;
  const salvarRascunho = jest.fn(async () => ({ ok: true, versao: 1 }));
  const workflows = {
    validar: real.validar.bind(real),
    criar: jest.fn(async () => ({ id: 'wf-novo' })),
    salvarRascunho,
  } as unknown as WorkflowsService;
  return { svc: new NicoMontadorService(prisma, workflows, llm), generate, salvarRascunho, workflows, audit };
}

const conversa = [{ autor: 'usuario' as const, texto: 'Quando entrar lead novo, manda boas-vindas, espera resposta 1 dia e se não responder cria tarefa.' }];

describe('NicoMontadorService — modo simples', () => {
  it('plano com "esperar resposta" vira grafo válido, em rascunho, com os dois caminhos ligados', async () => {
    const plano = {
      nome: 'Boas-vindas',
      resumo: 'Recebe o lead e cobra se ele não responder.',
      gatilho: { tipo: 'gatilho.contato_criado', config: {} },
      passos: [
        { tipo: 'acao.enviar_sms', rotulo: 'Boas-vindas', config: { texto: 'Oi {{contato.nome}}!' } },
        {
          tipo: 'controle.esperar_resposta', config: { duracao: 1, unidade: 'dias' },
          ramos: { timeout: [{ tipo: 'acao.criar_tarefa', config: { titulo: 'Ligar para {{contato.nome}}' } }] },
        },
      ],
    };
    const { svc, salvarRascunho, workflows, audit } = ambiente([`Claro! ${JSON.stringify(plano)}`]);
    const r = await svc.montar(TENANT, 'u1', conversa);

    expect(r).toMatchObject({ tipo: 'pronto', workflowId: 'wf-novo', nome: 'Boas-vindas' });
    const grafo = grafoSchema.parse((salvarRascunho.mock.calls[0] as unknown[])[2]);
    expect(workflows.validar(grafo)).toEqual([]);
    // ramo "resposta" vazio termina num Encerrar, de propósito
    expect(grafo.nos.filter((n) => n.tipo === 'controle.encerrar')).toHaveLength(1);
    expect(grafo.arestas.filter((a) => a.ramo).map((a) => a.ramo).sort()).toEqual(['resposta', 'timeout']);
    expect(audit).toHaveBeenCalled(); // registrado como ação da NICO
  });

  it('plano inválido ganha uma segunda chance com os erros; stageId inventado é recusado', async () => {
    const ruim = { nome: 'X', gatilho: { tipo: 'gatilho.contato_criado' }, passos: [{ tipo: 'acao.criar_oportunidade', config: { titulo: 'Novo', stageId: '99999999-9999-9999-9999-999999999999' } }] };
    const bom = { ...ruim, passos: [{ tipo: 'acao.criar_oportunidade', config: { titulo: 'Novo', stageId: STAGE } }] };
    const { svc, generate } = ambiente([JSON.stringify(ruim), JSON.stringify(bom)]);
    const r = await svc.montar(TENANT, 'u1', conversa);
    expect(r.tipo).toBe('pronto');
    expect(generate).toHaveBeenCalledTimes(2);
    const segunda = generate.mock.calls[1][0] as { mensagens: { content: string }[] };
    expect(segunda.mensagens.at(-1)?.content).toContain('stageId');
  });

  it('faltando o essencial, a NICO pergunta em vez de inventar (nada é criado)', async () => {
    const { svc, workflows } = ambiente([JSON.stringify({ resumo: 'Preciso entender o gatilho.', passos: [], perguntas: ['O que deve disparar o fluxo?'] })]);
    const r = await svc.montar(TENANT, 'u1', [{ autor: 'usuario', texto: 'faz uma automação' }]);
    expect(r).toEqual({ tipo: 'pergunta', perguntas: ['O que deve disparar o fluxo?'], resumo: 'Preciso entender o gatilho.' });
    expect(workflows.criar).not.toHaveBeenCalled();
  });

  it('não usa nó fora da lista permitida (ex.: acionar outro fluxo)', async () => {
    const plano = { nome: 'X', gatilho: { tipo: 'gatilho.contato_criado' }, passos: [{ tipo: 'acao.chamar_workflow', config: { workflowId: STAGE } }] };
    const { svc } = ambiente([JSON.stringify(plano), JSON.stringify(plano)]);
    await expect(svc.montar(TENANT, 'u1', conversa)).rejects.toMatchObject({ response: { title: 'A NICO não conseguiu montar o fluxo' } });
  });
});

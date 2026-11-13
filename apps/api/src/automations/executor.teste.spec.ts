import { ExecutorService, type Contexto } from './executor.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { TasksService } from '../crm/tasks.service';
import type { NotesService } from '../crm/notes.service';
import type { MailerService } from '../common/mailer.service';
import type { AiService } from '../ai/ai.service';
import type { CustomFieldsService } from '../crm/custom-fields.service';
import type { Grafo, No } from './catalogo';

/**
 * Execução de TESTE (botão Testar e modo simples da NICO). Regra do product
 * owner: teste nunca afeta a operação do cliente. Mensagens só no número de
 * teste; CRM, e-mail, webhook e encadeamento simulados.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const NUMERO_TESTE = '5500999990000';

const CTX: Contexto = {
  teste: true,
  executionKey: 'run1:0:n1',
  contato: { id: 'c1', nome: 'Marina Alves', email: 'marina@x.com', telefone: '+5511998124410', empresa: 'Clínica', tag: 'Lead', tags: ['vip'], valor: 0 },
  negocio: { id: 'd1', titulo: 'Plano', valor: 10, stageId: 's1', origem: 'Meta' },
};
const GRAFO: Grafo = { nos: [], arestas: [] };
const no = (tipo: string, config: Record<string, unknown>): No => ({ id: 'n1', tipo: tipo as No['tipo'], posicao: { x: 0, y: 0 }, config });

function ambiente(numero: string | null = NUMERO_TESTE) {
  const proibido = () => jest.fn(async () => { throw new Error('teste tocou a operação'); });
  const crm = { updateContact: proibido(), createDeal: proibido(), moveDeal: proibido() } as unknown as CrmService;
  const notificarNumero = jest.fn(async () => ({ status: 'sent', erro: null }));
  const mensagens = { send: proibido(), notificarNumero } as unknown as MessagesService;
  const tarefas = { create: proibido() } as unknown as TasksService;
  const notas = { create: proibido() } as unknown as NotesService;
  const mailer = { send: proibido() } as unknown as MailerService;
  const prisma = { withTenant: proibido() } as unknown as PrismaService;
  const ai = { configurado: () => true, missing: () => [], executar: jest.fn() } as unknown as AiService;
  const campos = { list: proibido(), atualizarCamposContato: proibido() } as unknown as CustomFieldsService;
  const config = new ConfigService();
  jest.spyOn(config, 'get').mockImplementation((k: string) => (k === 'AUTOMATION_TEST_PHONE' ? numero ?? undefined : undefined));
  const svc = new ExecutorService(prisma, config, crm, mensagens, tarefas, notas, mailer, ai, campos);
  const fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('teste chamou webhook'));
  return { svc, notificarNumero, fetchSpy };
}

afterEach(() => jest.restoreAllMocks());

describe('ExecutorService — execução de teste nunca afeta a operação', () => {
  it('mensagem ao contato vai SÓ para o número de teste, já personalizada com os dados reais', async () => {
    const { svc, notificarNumero } = ambiente();
    const r = await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Oi {{contato.nome}}!' }), CTX, GRAFO);
    expect(notificarNumero).toHaveBeenCalledWith(TENANT, NUMERO_TESTE, 'Oi Marina Alves!', 'run1:0:n1:teste');
    expect(r.saida).toMatchObject({ teste: true, status: 'sent', texto: 'Oi Marina Alves!' });
    expect(JSON.stringify(r.saida)).not.toContain(NUMERO_TESTE); // log mostra o número mascarado
  });

  it('aviso à equipe também vai para o número de teste, não para o da equipe', async () => {
    const { svc, notificarNumero } = ambiente();
    await svc.executar(TENANT, no('acao.notificar_equipe', { telefone: '5511911112222', texto: 'Lead {{contato.nome}}' }), CTX, GRAFO);
    expect(notificarNumero).toHaveBeenCalledWith(TENANT, NUMERO_TESTE, 'Lead Marina Alves', expect.any(String));
  });

  it('sem número de teste configurado, não envia nada e diz o que falta', async () => {
    const { svc, notificarNumero } = ambiente(null);
    const r = await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Oi' }), CTX, GRAFO);
    expect(notificarNumero).not.toHaveBeenCalled();
    expect(r.saida).toMatchObject({ status: 'config_required', missing: ['AUTOMATION_TEST_PHONE'] });
  });

  it.each([
    ['acao.enviar_email', { assunto: 'Oi', corpo: 'Olá {{contato.nome}}' }],
    ['acao.criar_oportunidade', { titulo: '{{contato.nome}}', stageId: '22222222-2222-2222-2222-222222222222' }],
    ['acao.mover_etapa', { stageId: '22222222-2222-2222-2222-222222222222' }],
    ['acao.criar_tarefa', { titulo: 'Ligar' }],
    ['acao.criar_nota', { corpo: 'nota' }],
    ['acao.webhook', { url: 'https://exemplo.com/x' }],
    ['acao.nao_perturbe', { ativar: true }],
    ['acao.remover_de_fluxo', { alvo: 'todos' }],
    ['acao.chamar_workflow', { workflowId: '33333333-3333-3333-3333-333333333333' }],
  ])('%s é simulado (nada no CRM, e-mail ou rede)', async (tipo, config) => {
    const { svc, fetchSpy } = ambiente();
    const r = await svc.executar(TENANT, no(tipo, config), CTX, GRAFO);
    expect(r.saida).toMatchObject({ simulado: true });
    expect(r.saida).not.toHaveProperty('encadear');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('tag simulada muda só o contexto do teste (a condição seguinte enxerga)', async () => {
    const { svc } = ambiente();
    const r = await svc.executar(TENANT, no('acao.adicionar_tag', { tag: 'quente' }), CTX, GRAFO);
    expect(r.contexto?.contato?.tags).toEqual(['vip', 'quente']);
  });

  it('esperas são puladas e "esperar resposta" segue pelo caminho sem resposta', async () => {
    const { svc } = ambiente();
    const espera = await svc.executar(TENANT, no('controle.esperar', { duracao: 2, unidade: 'dias' }), CTX, GRAFO);
    expect(espera.esperarMs).toBeUndefined();
    const resposta = await svc.executar(TENANT, no('controle.esperar_resposta', { duracao: 1, unidade: 'dias' }), CTX, GRAFO);
    expect(resposta.ramo).toBe('timeout');
    expect(resposta.esperarMs).toBeUndefined();
  });
});

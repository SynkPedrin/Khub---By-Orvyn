import { UnrecoverableError } from 'bullmq';
import { ExecutorService, type Contexto } from './executor.service';
import { ConfigService } from '../config/config.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { CrmService } from '../crm/crm.service';
import type { MessagesService } from '../crm/messaging/messages.service';
import type { TasksService } from '../crm/tasks.service';
import type { NotesService } from '../crm/notes.service';
import type { MailerService, MailResult } from '../common/mailer.service';
import type { AiService } from '../ai/ai.service';
import type { CustomFieldsService } from '../crm/custom-fields.service';
import type { Grafo, No } from './catalogo';

const TENANT = '11111111-1111-1111-1111-111111111111';

const CTX: Contexto = {
  contato: { id: 'c1', nome: 'Marina Alves', email: 'marina@x.com', telefone: '+5511998124410', empresa: 'Clínica', tag: 'Lead quente', tags: ['metaads', 'vip'], valor: 2400 },
  negocio: { id: 'd1', titulo: 'Plano anual', valor: 5000, stageId: 's1', origem: 'Meta' },
  mensagem: { id: 'm1', texto: 'Quero saber o preço do google ads', de: 'contato' },
};

const GRAFO: Grafo = { nos: [{ id: 'n1', tipo: 'controle.esperar', posicao: { x: 0, y: 0 }, config: {} }], arestas: [] };

function ambiente(opts?: { dripCount?: number; lastInboundAt?: Date | null; ultimaMsg?: string }) {
  const chamadas: Record<string, unknown[]> = { updateContact: [], createDeal: [], moveDeal: [], send: [], task: [] };
  const crm = {
    updateContact: jest.fn(async (t: string, id: string, patch: unknown) => { chamadas.updateContact.push({ t, id, patch }); return { ok: true }; }),
    createDeal: jest.fn(async (t: string, input: unknown) => { chamadas.createDeal.push({ t, input }); return { id: 'novo-deal' }; }),
    moveDeal: jest.fn(async (t: string, id: string, stageId: string) => { chamadas.moveDeal.push({ t, id, stageId }); return { ok: true }; }),
  } as unknown as CrmService;
  const mensagens = {
    send: jest.fn(async (t: string, conv: string, texto: string) => { chamadas.send.push({ t, conv, texto }); return { id: 'msg1', hora: '10:00', status: 'sent', erro: null, missing: [] }; }),
    notificarNumero: jest.fn(async (_t: string, telefone: string, texto: string, chave: string) => { chamadas.send.push({ equipe: telefone, texto, chave }); return { status: 'sent', erro: null }; }),
  } as unknown as MessagesService;
  const tarefas = {
    create: jest.fn(async (t: string, _u: string, input: unknown) => { chamadas.task.push({ t, input }); return { id: 'task1' }; }),
  } as unknown as TasksService;
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({
        conversation: { findFirst: jest.fn(async () => ({ id: 'conv1' })), create: jest.fn(async () => ({ id: 'conv1' })) },
        contact: { findUnique: jest.fn(async () => ({ lastInboundAt: opts?.lastInboundAt ?? null })) },
        deal: { findUnique: jest.fn(async () => null) },
        message: { findFirst: jest.fn(async () => (opts?.ultimaMsg ? { id: 'm9', corpo: opts.ultimaMsg } : null)) },
        // drip: o UPSERT devolve a nova contagem da janela (controlável no teste)
        $queryRaw: jest.fn(async () => [{ count: opts?.dripCount ?? 1 }]),
      }),
    ),
  } as unknown as PrismaService;
  const notas = { create: jest.fn(async () => ({ id: 'nota1' })) } as unknown as NotesService;
  // por padrão o SMTP está configurado e o envio dá certo; cada teste sobrescreve.
  const mailer = { send: jest.fn(async (): Promise<MailResult> => ({ sent: true })) } as unknown as MailerService;
  // IA configurada por padrão; testes de gating sobrescrevem `configurado`.
  const ai = {
    configurado: jest.fn(() => true),
    missing: jest.fn(() => ['ANTHROPIC_API_KEY']),
    executar: jest.fn(async () => ({ texto: 'quente', uso: { entrada: 0, saida: 0, cache: 0, custoUsd: 0 }, modelo: 'x' })),
  } as unknown as AiService;
  const camposCustom = {
    list: jest.fn(async () => []),
    atualizarCamposContato: jest.fn(async (_t: string, _id: string, valores: Record<string, unknown>) => ({ ok: true as const, alterados: Object.keys(valores) })),
  } as unknown as CustomFieldsService;
  return { svc: new ExecutorService(prisma, new ConfigService(), crm, mensagens, tarefas, notas, mailer, ai, camposCustom), chamadas, camposCustom, crm, mensagens, tarefas, notas, mailer, ai };
}

const no = (tipo: string, config: Record<string, unknown>): No => ({ id: 'n1', tipo: tipo as No['tipo'], posicao: { x: 0, y: 0 }, config });

describe('ExecutorService — controle', () => {
  it('esperar converte unidade para ms (dias não viram segundos)', async () => {
    const { svc } = ambiente();
    expect((await svc.executar(TENANT, no('controle.esperar', { duracao: 10, unidade: 'segundos' }), CTX, GRAFO)).esperarMs).toBe(10_000);
    expect((await svc.executar(TENANT, no('controle.esperar', { duracao: 2, unidade: 'dias' }), CTX, GRAFO)).esperarMs).toBe(172_800_000);
  });

  it('condição AND: só passa se TODAS as regras baterem', async () => {
    const { svc } = ambiente();
    const config = {
      ramos: [{
        id: 'r1', rotulo: 'Meta', juncao: 'AND',
        regras: [
          { campo: 'contato.tags', operador: 'contem', valor: 'metaads' },
          { campo: 'contato.valor', operador: 'maior', valor: '1000' },
        ],
      }],
    };
    expect((await svc.executar(TENANT, no('controle.condicao', config), CTX, GRAFO)).ramo).toBe('r1');

    const semUma = { ramos: [{ ...config.ramos[0], regras: [...config.ramos[0].regras, { campo: 'contato.email', operador: 'contem', valor: 'gmail' }] }] };
    expect((await svc.executar(TENANT, no('controle.condicao', semUma), CTX, GRAFO)).ramo).toBeUndefined();
  });

  it('condição OR: basta uma regra bater', async () => {
    const { svc } = ambiente();
    const config = {
      ramos: [{
        id: 'r1', rotulo: 'Google', juncao: 'OR',
        regras: [
          { campo: 'mensagem.texto', operador: 'contem', valor: 'google' },
          { campo: 'contato.tags', operador: 'contem', valor: 'inexistente' },
        ],
      }],
    };
    expect((await svc.executar(TENANT, no('controle.condicao', config), CTX, GRAFO)).ramo).toBe('r1');
  });

  it('ramo NONE é o "quando nada bate" (else explícito)', async () => {
    const { svc } = ambiente();
    const config = {
      ramos: [
        { id: 'r1', rotulo: 'Tag X', juncao: 'AND', regras: [{ campo: 'contato.tags', operador: 'contem', valor: 'nao-tenho' }] },
        { id: 'else', rotulo: 'Sem identificação', juncao: 'NONE', regras: [] },
      ],
    };
    expect((await svc.executar(TENANT, no('controle.condicao', config), CTX, GRAFO)).ramo).toBe('else');
  });

  it('primeiro ramo que casa vence (ordem importa)', async () => {
    const { svc } = ambiente();
    const config = {
      ramos: [
        { id: 'primeiro', juncao: 'OR', rotulo: 'A', regras: [{ campo: 'contato.tags', operador: 'contem', valor: 'vip' }] },
        { id: 'segundo', juncao: 'OR', rotulo: 'B', regras: [{ campo: 'contato.tags', operador: 'contem', valor: 'metaads' }] },
      ],
    };
    expect((await svc.executar(TENANT, no('controle.condicao', config), CTX, GRAFO)).ramo).toBe('primeiro');
  });

  it('REGRESSÃO: condição em formato legado (`condicoes`, sem `ramos`) falha uma vez, sem retry, com causa legível', async () => {
    const { svc } = ambiente();
    const legado = no('controle.condicao', { condicoes: [{ campo: 'valor_estimado', operador: 'maior_que', valor: 50000 }] });
    const erro = await svc.executar(TENANT, legado, CTX, GRAFO).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(UnrecoverableError);
    expect((erro as Error).message).toContain('config inválida no nó "n1" (controle.condicao)');
    expect((erro as Error).message).toContain('ramos');
  });

  it('drip libera quando a janela ainda tem espaço (count <= limite)', async () => {
    const { svc } = ambiente({ dripCount: 5 });
    const r = await svc.executar(TENANT, no('controle.drip', { porJanela: 10, janela: 'hora' }), CTX, GRAFO);
    expect(r.saida).toMatchObject({ liberado: true, posicaoNaJanela: 5 });
    expect(r.esperarMs).toBeUndefined();
    expect(r.mesmoNo).toBeUndefined();
  });

  it('drip segura e reagenda na próxima janela quando o lote estourou', async () => {
    const { svc } = ambiente({ dripCount: 11 });
    const r = await svc.executar(TENANT, no('controle.drip', { porJanela: 10, janela: 'hora' }), CTX, GRAFO);
    expect(r.saida).toMatchObject({ liberado: false, aguardandoProximaJanela: true });
    expect(r.mesmoNo).toBe(true);
    expect(r.esperarMs).toBeGreaterThan(0);
    expect(r.esperarMs).toBeLessThanOrEqual(3_600_000);
  });

  it('ir_para recusa alvo inexistente em vez de travar a execução', async () => {
    const { svc } = ambiente();
    await expect(svc.executar(TENANT, no('controle.ir_para', { alvoNoId: 'fantasma' }), CTX, GRAFO)).rejects.toThrow(/não existe|inexistente/i);
    expect((await svc.executar(TENANT, no('controle.ir_para', { alvoNoId: 'n1' }), CTX, GRAFO)).irPara).toBe('n1');
  });

  it('split A/B é determinístico: o mesmo contato cai sempre na mesma variante', async () => {
    const { svc } = ambiente();
    const config = { ramos: [{ id: 'a', rotulo: 'A', peso: 1 }, { id: 'b', rotulo: 'B', peso: 1 }] };
    const primeiro = (await svc.executar(TENANT, no('controle.split', config), CTX, GRAFO)).ramo;
    expect(['a', 'b']).toContain(primeiro);
    for (let i = 0; i < 5; i++) {
      expect((await svc.executar(TENANT, no('controle.split', config), CTX, GRAFO)).ramo).toBe(primeiro);
    }
  });

  it('split distribui por peso (3:1 → ~75% no ramo pesado)', async () => {
    const { svc } = ambiente();
    const config = { ramos: [{ id: 'a', rotulo: 'A', peso: 3 }, { id: 'b', rotulo: 'B', peso: 1 }] };
    let a = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) {
      const ctx = { ...CTX, contato: { ...CTX.contato!, id: `c-${i}` } };
      if ((await svc.executar(TENANT, no('controle.split', config), ctx, GRAFO)).ramo === 'a') a++;
    }
    expect(a / N).toBeGreaterThan(0.68);
    expect(a / N).toBeLessThan(0.82);
  });
});

describe('ExecutorService — ações', () => {
  it('enviar SMS interpola {{contato.nome}} e manda pelo MessagesService (auditado)', async () => {
    const { svc, chamadas } = ambiente();
    const r = await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Oi {{contato.nome}}, tudo bem?' }), CTX, GRAFO);
    expect(chamadas.send[0]).toMatchObject({ t: TENANT, conv: 'conv1', texto: 'Oi Marina Alves, tudo bem?' });
    expect(r.saida).toMatchObject({ status: 'sent' });
  });

  it('placeholder sem valor vira vazio, não "undefined" na cara do cliente', async () => {
    const { svc, chamadas } = ambiente();
    await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Oi {{contato.sobrenome}}!' }), CTX, GRAFO);
    expect(chamadas.send[0]).toMatchObject({ texto: 'Oi !' });
  });

  it('enviar e-mail interpola assunto e corpo e manda pro e-mail do contato', async () => {
    const { svc, mailer } = ambiente();
    const r = await svc.executar(TENANT, no('acao.enviar_email', { assunto: 'Olá {{contato.nome}}', corpo: 'Vi seu interesse, {{contato.nome}}.\nFalamos?' }), CTX, GRAFO);
    expect((mailer.send as jest.Mock).mock.calls[0][0]).toMatchObject({ to: 'marina@x.com', subject: 'Olá Marina Alves' });
    // corpo: texto puro interpolado + html com <br> na quebra de linha
    const arg = (mailer.send as jest.Mock).mock.calls[0][0];
    expect(arg.text).toBe('Vi seu interesse, Marina Alves.\nFalamos?');
    expect(arg.html).toContain('Falamos?');
    expect(arg.html).toContain('<br>');
    expect(r.saida).toMatchObject({ status: 'sent', para: 'marina@x.com' });
  });

  it('sem SMTP o e-mail fica pendente (config_required) — não derruba o fluxo', async () => {
    const { svc, mailer } = ambiente();
    (mailer.send as jest.Mock).mockResolvedValueOnce({ sent: false, missing: ['SMTP_URL'] });
    const r = await svc.executar(TENANT, no('acao.enviar_email', { assunto: 'oi', corpo: 'corpo' }), CTX, GRAFO);
    expect(r.saida).toMatchObject({ status: 'config_required', missing: ['SMTP_URL'] });
  });

  it('falha REAL de SMTP levanta erro (deixa o retry/DLQ agir) — não é o mesmo que gating', async () => {
    const { svc, mailer } = ambiente();
    (mailer.send as jest.Mock).mockResolvedValueOnce({ sent: false, erro: 'connection refused' });
    await expect(svc.executar(TENANT, no('acao.enviar_email', { assunto: 'oi', corpo: 'corpo' }), CTX, GRAFO)).rejects.toThrow(/falha ao enviar e-mail/i);
  });

  it('contato sem e-mail falha explícito (não manda pro vazio)', async () => {
    const { svc } = ambiente();
    const semEmail = { ...CTX, contato: { ...CTX.contato!, email: null } };
    await expect(svc.executar(TENANT, no('acao.enviar_email', { assunto: 'oi', corpo: 'c' }), semEmail, GRAFO)).rejects.toThrow(/sem e-mail|destinatário/i);
  });

  it('definir variável guarda o valor JÁ interpolado no contexto', async () => {
    const { svc } = ambiente();
    const r = await svc.executar(TENANT, no('acao.definir_variavel', { nome: 'saudacao', valor: 'Oi {{contato.nome}}' }), CTX, GRAFO);
    expect(r.contexto?.variaveis).toMatchObject({ saudacao: 'Oi Marina Alves' });
  });

  it('variável definida é usável em nós seguintes via {{variaveis.x}}', async () => {
    const { svc, chamadas } = ambiente();
    const ctx = { ...CTX, variaveis: { desconto: '15%' } };
    await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Seu desconto é {{variaveis.desconto}}' }), ctx, GRAFO);
    expect(chamadas.send[0]).toMatchObject({ texto: 'Seu desconto é 15%' });
  });

  it('nó de IA guarda o resultado numa variável (usável depois)', async () => {
    const { svc, ai } = ambiente();
    const r = await svc.executar(TENANT, no('acao.ia', { tarefa: 'classificar', instrucao: 'lead quente ou frio?', salvarEm: 'temperatura' }), CTX, GRAFO);
    expect((ai.executar as jest.Mock)).toHaveBeenCalled();
    expect(r.contexto?.variaveis).toMatchObject({ temperatura: 'quente' });
    expect(r.saida).toMatchObject({ resultado: 'quente', tarefa: 'classificar' });
  });

  it('nó de IA sem chave da Anthropic degrada (config_required) — não quebra o fluxo', async () => {
    const { svc, ai } = ambiente();
    (ai.configurado as jest.Mock).mockReturnValueOnce(false);
    const r = await svc.executar(TENANT, no('acao.ia', { tarefa: 'resumir', instrucao: 'resuma', salvarEm: 'ia' }), CTX, GRAFO);
    expect(r.saida).toMatchObject({ status: 'config_required', missing: ['ANTHROPIC_API_KEY'] });
    expect((ai.executar as jest.Mock)).not.toHaveBeenCalled();
  });

  it('formatar texto: telefone BR legível e moeda em R$', async () => {
    const { svc } = ambiente();
    const tel = await svc.executar(TENANT, no('acao.formatar_texto', { valor: '{{contato.telefone}}', formato: 'telefone', salvarEm: 'tel' }), CTX, GRAFO);
    expect(tel.contexto?.variaveis).toMatchObject({ tel: '(11) 99812-4410' });
    const moeda = await svc.executar(TENANT, no('acao.formatar_texto', { valor: '{{negocio.valor}}', formato: 'moeda', salvarEm: 'v' }), CTX, GRAFO);
    expect(String((moeda.contexto?.variaveis as Record<string, string>).v)).toMatch(/R\$\s?5\.000,00/);
  });

  it('adicionar tag não duplica a que já existe', async () => {
    const { svc, chamadas } = ambiente();
    await svc.executar(TENANT, no('acao.adicionar_tag', { tag: 'vip' }), CTX, GRAFO);
    expect((chamadas.updateContact[0] as { patch: { tags: string[] } }).patch.tags).toEqual(['metaads', 'vip']);
  });

  it('remover tag ignora maiúscula/minúscula', async () => {
    const { svc, chamadas } = ambiente();
    await svc.executar(TENANT, no('acao.remover_tag', { tag: 'VIP' }), CTX, GRAFO);
    expect((chamadas.updateContact[0] as { patch: { tags: string[] } }).patch.tags).toEqual(['metaads']);
  });

  it('criar oportunidade usa o contato do contexto e cai na etapa configurada', async () => {
    const { svc, chamadas } = ambiente();
    const r = await svc.executar(TENANT, no('acao.criar_oportunidade', { titulo: 'Proposta {{contato.nome}}', stageId: '99999999-9999-4999-8999-999999999999', valor: 900 }), CTX, GRAFO);
    expect(chamadas.createDeal[0]).toMatchObject({ input: { titulo: 'Proposta Marina Alves', stageId: '99999999-9999-4999-8999-999999999999', contactId: 'c1', valor: 900 } });
    expect(r.contexto?.negocio?.id).toBe('novo-deal');
  });

  it('ação sem o contato no contexto falha explícito (não escreve em ninguém)', async () => {
    const { svc } = ambiente();
    await expect(svc.executar(TENANT, no('acao.enviar_sms', { texto: 'oi' }), {}, GRAFO)).rejects.toThrow(/sem contato/);
    await expect(svc.executar(TENANT, no('acao.mover_etapa', { stageId: '22222222-2222-4222-8222-222222222222' }), {}, GRAFO)).rejects.toThrow(/sem negócio/);
  });

  it('webhook bloqueia rede interna (SSRF): automação do tenant não alcança metadata/localhost', async () => {
    const { svc } = ambiente();
    for (const url of ['http://localhost:3333/v1/health', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/admin', 'http://192.168.1.1/']) {
      await expect(svc.executar(TENANT, no('acao.webhook', { url }), CTX, GRAFO)).rejects.toThrow(/interno/);
    }
  });
});

describe('ExecutorService — notificar equipe e saudação (importação do GHL)', () => {
  const comChave: Contexto = { ...CTX, executionKey: 'run1:0:n1' };

  it('avisa o número da EQUIPE (não o contato), com chave do passo e variáveis', async () => {
    const { svc, mensagens } = ambiente();
    const r = await svc.executar(TENANT, no('acao.notificar_equipe', { telefone: '+5518999990971', texto: 'O Lead {{contato.nome}} já é cliente\nTELEFONE: {{contato.telefone}}' }), comChave, GRAFO);
    expect(r.saida).toMatchObject({ status: 'sent' });
    expect(mensagens.notificarNumero).toHaveBeenCalledWith(TENANT, '5518999990971', 'O Lead Marina Alves já é cliente\nTELEFONE: +5511998124410', 'run1:0:n1:equipe');
    expect(mensagens.send).not.toHaveBeenCalled();
  });

  it('sem canal ou bloqueado: falha explícita (aviso interno não some em silêncio)', async () => {
    const { svc, mensagens } = ambiente();
    (mensagens.notificarNumero as jest.Mock).mockResolvedValueOnce({ status: 'config_required', erro: null });
    await expect(svc.executar(TENANT, no('acao.notificar_equipe', { telefone: '5518999990971', texto: 'oi' }), comChave, GRAFO)).rejects.toThrow('notificacao_equipe_config_required');
  });

  it('sem chave de execução recusa (não arrisca engolir avisos como repetidos)', async () => {
    const { svc } = ambiente();
    await expect(svc.executar(TENANT, no('acao.notificar_equipe', { telefone: '5518999990971', texto: 'oi' }), CTX, GRAFO)).rejects.toThrow('sem_chave');
  });

  it('{{contato.primeiroNome}}: primeira palavra capitalizada; nome-telefone vira vazio sem pontuação órfã', async () => {
    const { svc, chamadas } = ambiente();
    await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Oii, {{contato.primeiroNome}}! Bem-vinda' }), comChave, GRAFO);
    expect((chamadas.send.at(-1) as { texto: string }).texto).toBe('Oii, Marina! Bem-vinda');
    const semNome: Contexto = { ...comChave, contato: { ...CTX.contato!, nome: '5541999998888' } };
    await svc.executar(TENANT, no('acao.enviar_sms', { texto: 'Oii, {{contato.primeiroNome}}! Bem-vinda' }), semNome, GRAFO);
    expect((chamadas.send.at(-1) as { texto: string }).texto).toBe('Oii! Bem-vinda');
  });
});

describe('ExecutorService — resposta que chegou ANTES da espera marcar (corrida)', () => {
  it('resposta posterior à baseline: ramo "resposta" já na 1ª passada, com o texto', async () => {
    const { svc } = ambiente({ lastInboundAt: new Date('2026-01-01T12:00:10Z'), ultimaMsg: 'Vi no Google' });
    const ctx: Contexto = { ...CTX, runStartedAt: '2026-01-01T12:00:00.000Z' };
    const r = await svc.executar(TENANT, no('controle.esperar_resposta', { duracao: 2, unidade: 'horas' }), ctx, GRAFO);
    expect(r.ramo).toBe('resposta');
    expect(r.contexto?.mensagem).toMatchObject({ texto: 'Vi no Google', de: 'contato' });
    expect(typeof (r.contexto as { baseResposta?: string })?.baseResposta).toBe('string');
  });

  it('sem resposta depois da baseline: comportamento de antes (marca a espera)', async () => {
    const { svc } = ambiente({ lastInboundAt: new Date('2026-01-01T11:00:00Z') });
    const ctx: Contexto = { ...CTX, runStartedAt: '2026-01-01T12:00:00.000Z' };
    const r = await svc.executar(TENANT, no('controle.esperar_resposta', { duracao: 2, unidade: 'horas' }), ctx, GRAFO);
    expect(r.ramo).toBeUndefined();
    expect(r.esperarMs).toBe(7_200_000);
  });
});

// ------------------------------------------------------------------ Ativar IA / Passar para humano

import { BadRequestException } from '@nestjs/common';
import type { AtendimentoService } from '../crm/messaging/atendimento.service';

function montarAtendimento(atendimento: Record<string, jest.Mock>, semConversa = false) {
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) =>
      work({ conversation: { findFirst: jest.fn(async () => (semConversa ? null : { id: 'conv1' })) } }),
    ),
  } as unknown as PrismaService;
  const svc = new ExecutorService(prisma, new ConfigService(), {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, undefined, atendimento as unknown as AtendimentoService);
  return { svc, atendimento };
}

const NO_ATIVAR: No = { id: 'n1', tipo: 'acao.ativar_ia', posicao: { x: 0, y: 0 }, config: {} };
const NO_HUMANO: No = { id: 'n2', tipo: 'acao.passar_humano', posicao: { x: 0, y: 0 }, config: {} };

describe('nó Ativar IA na conversa', () => {
  it('liga o agente padrão na conversa mais recente do contato', async () => {
    const at = { ativarIaSistema: jest.fn(async () => ({ id: 'conv1', atendimento: 'ia', agentId: 'ag1', assigneeId: null, handoffMotivo: null })) };
    const { svc } = montarAtendimento(at);
    const r = await svc.executar(TENANT, NO_ATIVAR, CTX, GRAFO);
    expect(at.ativarIaSistema).toHaveBeenCalledWith(TENANT, 'conv1', undefined);
    expect(r.saida).toMatchObject({ atendimento: 'ia', agentId: 'ag1', conversationId: 'conv1' });
  });

  it('respeita o agente escolhido na config', async () => {
    const AG = '99999999-9999-4999-8999-999999999999';
    const at = { ativarIaSistema: jest.fn(async () => ({ id: 'conv1', atendimento: 'ia', agentId: AG, assigneeId: null, handoffMotivo: null })) };
    const { svc } = montarAtendimento(at);
    await svc.executar(TENANT, { ...NO_ATIVAR, config: { agentId: AG } }, CTX, GRAFO);
    expect(at.ativarIaSistema).toHaveBeenCalledWith(TENANT, 'conv1', AG);
  });

  it('contato sem conversa é erro de configuração (DLQ direta, sem retentar)', async () => {
    const at = { ativarIaSistema: jest.fn() };
    const { svc } = montarAtendimento(at, true);
    await expect(svc.executar(TENANT, NO_ATIVAR, CTX, GRAFO)).rejects.toThrow(UnrecoverableError);
    expect(at.ativarIaSistema).not.toHaveBeenCalled();
  });

  it('agente inexistente/inativo é erro de configuração (não transitório)', async () => {
    const at = { ativarIaSistema: jest.fn(async () => { throw new BadRequestException('não há agente padrão ativo para este canal'); }) };
    const { svc } = montarAtendimento(at);
    await expect(svc.executar(TENANT, NO_ATIVAR, CTX, GRAFO)).rejects.toThrow(UnrecoverableError);
  });

  it('passar para humano tira a IA com o motivo e o ator sistema', async () => {
    const at = { transferirParaHumano: jest.fn(async () => ({ id: 'conv1', atendimento: 'humano', agentId: null, assigneeId: 'u1', handoffMotivo: 'automação passou para a equipe' })) };
    const { svc } = montarAtendimento(at);
    const r = await svc.executar(TENANT, NO_HUMANO, CTX, GRAFO);
    expect(at.transferirParaHumano).toHaveBeenCalledWith(TENANT, 'conv1', 'automação passou para a equipe', { tipo: 'sistema' });
    expect(r.saida).toMatchObject({ atendimento: 'humano', assigneeId: 'u1' });
  });

  it('no modo teste é só simulado (não muda o atendimento de verdade)', async () => {
    const at = { ativarIaSistema: jest.fn(), transferirParaHumano: jest.fn() };
    const { svc } = montarAtendimento(at);
    const r1 = await svc.executar(TENANT, NO_ATIVAR, { ...CTX, teste: true }, GRAFO);
    const r2 = await svc.executar(TENANT, NO_HUMANO, { ...CTX, teste: true }, GRAFO);
    expect(r1.saida).toMatchObject({ simulado: true });
    expect(r2.saida).toMatchObject({ simulado: true });
    expect(at.ativarIaSistema).not.toHaveBeenCalled();
    expect(at.transferirParaHumano).not.toHaveBeenCalled();
  });
});

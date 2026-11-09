#!/usr/bin/env node
/**
 * Recria no KHUB as automações do GHL do Studio da Beleza (a partir dos prints
 * dos fluxos + TEXTOS REAIS tirados do histórico importado — 532 mensagens
 * enviadas por automação). Usa o mesmo serviço do editor (WorkflowsService):
 * criar, configurar, salvar rascunho e a MESMA validação da publicação.
 *
 *   cd apps/api && pnpm build
 *   node --env-file=.env scripts/operar/ghl-automacoes.mjs --tenant UUID [--location ID] [--publicar]
 *
 * Padrão: cria como RASCUNHO (não dispara nada). Enquanto o GHL estiver ativo
 * para o mesmo cliente, ativar aqui faria cada cliente receber em dobro — o
 * dono ativa no editor na hora da virada. `--publicar` existe para o QA.
 * Idempotente: fluxo com o mesmo nome no tenant é pulado.
 */
import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TENANT = arg('--tenant');
const LOC = arg('--location') ?? process.env.GHL_MIGRATION_LOCATION_ID ?? '4UVfJ6m5F0B7eCDAsKVY';
const PUBLICAR = process.argv.includes('--publicar');
const FONE_EQUIPE = arg('--telefone-equipe'); // opcional: senão vem do histórico do GHL
if (!TENANT) {
  console.error('uso: --tenant UUID [--location ID] [--telefone-equipe 55...] [--publicar]');
  process.exit(1);
}

/** Número da equipe = destino das "Notificações internas" no histórico do GHL. */
function telefoneEquipe() {
  if (FONE_EQUIPE) return FONE_EQUIPE.replace(/\D/g, '');
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/revenue-audit/evidence/ghl', LOC);
  const msgs = JSON.parse(readFileSync(join(dir, 'messages.json'), 'utf8'));
  const cont = new Map();
  for (const m of msgs) {
    if (m.source !== 'workflow' || m.direction !== 'outbound') continue;
    if (!/já é cliente|LEAD QUE/.test(m.body ?? '')) continue;
    const t = (m.to ?? '').replace(/\D/g, '');
    if (t) cont.set(t, (cont.get(t) ?? 0) + 1);
  }
  const top = [...cont.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) throw new Error('não achei o número da equipe no histórico; passe --telefone-equipe');
  return top[0];
}

// ---------------------------------------------------------------- textos reais
const T = {
  identificar:
    'Oii, {{contato.primeiroNome}}! Seja muito bem-vinda ao Studio da Beleza! 💕\n\nAntes de continuarmos, conta pra gente: você já é nossa cliente ou conheceu o nosso Studio pelo Google ou pelo Instagram?\n\nResponda com: Google, Instagram ou Já sou cliente.\n\nÉ um prazer ter você por aqui!',
  boasVindas: 'Olá, {{contato.primeiroNome}}! 💖\nSeja muito bem-vinda ao Studio da Beleza! ✨',
  procedimento: 'Queremos entender como podemos te ajudar!\nQual procedimento ou serviço você gostaria de realizar? 💕',
  fl1: 'Oi, {{contato.primeiroNome}}! 💕\n\nPassando para saber se você conseguiu ver nossa mensagem anterior! ✨\nAqui no Studio da Beleza, queremos que você tenha uma experiência especial desde o primeiro contato.\n\nMe conta, qual procedimento você está pensando em fazer? 💖\nVou adorar te ajudar!',
  fl2: 'Oi, {{contato.primeiroNome}} 🌷\nJá imaginou reservar um tempinho só para você? ✨\n\nAqui acreditamos que cuidar da beleza também é uma forma de cuidar de si mesma.\n\nVocê já tem algum procedimento em mente ou gostaria de conhecer nossas opções? 💕',
  jaCliente: 'O Lead {{contato.nome}} já é cliente e está solicitando atendimento💬\n\nNOME: {{contato.nome}}\nTELEFONE: {{contato.telefone}}',
  pagamento: '+1 LEAD QUE REALIZOU O PAGAMENTO💸\n\n*Verificar os horários disponíveis e realizar o agendamento! *\n\nNOME: {{contato.nome}}\nTELEFONE: {{contato.telefone}}',
  servico: '+1 LEAD QUE JÁ ESCOLHEU O SERVIÇO E VAI AGENDAR 🔥\n\n*Verificar os horários disponíveis e realizar o agendamento! *\n\nNOME: {{contato.nome}}\nTELEFONE: {{contato.telefone}}',
};

// ---------------------------------------------------------------- construtor
function grafo() {
  const nos = [];
  const arestas = [];
  const no = (id, tipo, rotulo, x, y, config = {}) => nos.push({ id, tipo, rotulo, posicao: { x: x * 280, y: y * 150 }, config });
  const liga = (de, para, ramo) => arestas.push({ id: `${de}->${para}${ramo ? `:${ramo}` : ''}`, de, para, ...(ramo ? { ramo } : {}) });
  return { nos, arestas, no, liga };
}
const regra = (valor) => ({ campo: 'mensagem.texto', operador: 'contem', valor });

function novoLead(st, foneEquipe) {
  const g = grafo();
  g.no('gatilho', 'gatilho.contato_criado', 'Contato criado', 0, 2);
  g.no('espera1', 'controle.esperar', 'Espera inicial (conferir tempo)', 1, 2, { duracao: 1, unidade: 'minutos' });
  g.no('identificar', 'acao.enviar_sms', 'SMS · identificar origem', 2, 2, { texto: T.identificar });
  g.no('aguarda_origem', 'controle.esperar_resposta', 'Aguarda resposta (conferir tempo)', 3, 2, { duracao: 1, unidade: 'dias' });
  g.no('origem', 'controle.condicao', 'Origem', 4, 2, {
    ramos: [
      { id: 'google', rotulo: 'Google', juncao: 'OR', regras: [regra('google'), regra('site')] },
      { id: 'metaads', rotulo: 'Metaads', juncao: 'OR', regras: [regra('insta')] },
      { id: 'cliente', rotulo: 'Já sou cliente', juncao: 'OR', regras: [regra('já sou cliente'), regra('ja sou cliente')] },
      { id: 'indicacao', rotulo: 'Indicação', juncao: 'OR', regras: [regra('indica')] },
      { id: 'nenhum', rotulo: 'Nenhuma', juncao: 'NONE', regras: [] },
    ],
  });
  g.no('tag_google', 'acao.adicionar_tag', 'Tag · googleads', 5, 0, { tag: 'googleads' });
  g.no('tag_meta', 'acao.adicionar_tag', 'Tag · metaads', 5, 1, { tag: 'metaads' });
  g.no('avisa_cliente', 'acao.notificar_equipe', 'Notificação interna · já é cliente', 5, 3, { telefone: foneEquipe, texto: T.jaCliente });
  g.no('oportunidade', 'acao.criar_oportunidade', 'Criar oportunidade', 6, 1, { titulo: '{{contato.nome}}', stageId: st['Novo Lead'], origem: 'WhatsApp' });
  g.no('boas_vindas', 'acao.enviar_sms', 'Boas-vindas', 7, 1, { texto: T.boasVindas });
  g.no('espera2s', 'controle.esperar', 'Espera 2s', 8, 1, { duracao: 2, unidade: 'segundos' });
  g.no('procedimento', 'acao.enviar_sms', 'SMS · qual procedimento', 9, 1, { texto: T.procedimento });
  g.no('aguarda_2h', 'controle.esperar_resposta', 'Aguarda resposta · 2h', 10, 1, { duracao: 2, unidade: 'horas' });
  g.no('em_atendimento', 'acao.mover_etapa', 'Respondeu · Em Atendimento', 11, 0, { stageId: st['Em Atendimento'] });
  g.no('fl1', 'acao.enviar_sms', 'FL-1', 11, 2, { texto: T.fl1 });
  g.no('aguarda_1d', 'controle.esperar_resposta', 'Aguarda resposta · 1 dia', 12, 2, { duracao: 1, unidade: 'dias' });
  g.no('fl2', 'acao.enviar_sms', 'FL-2', 13, 3, { texto: T.fl2 });
  g.no('aguarda_3d', 'controle.esperar_resposta', 'Aguarda resposta · 3 dias', 14, 3, { duracao: 3, unidade: 'dias' });
  g.no('sem_resposta', 'acao.mover_etapa', 'Sem resposta · etapa', 15, 4, { stageId: st['Sem Resposta'] });
  g.no('volta_atendimento_1', 'controle.ir_para', 'Respondeu → Em Atendimento', 13, 1, { alvoNoId: 'em_atendimento' });
  g.no('volta_atendimento_2', 'controle.ir_para', 'Respondeu → Em Atendimento', 15, 2, { alvoNoId: 'em_atendimento' });

  g.liga('gatilho', 'espera1');
  g.liga('espera1', 'identificar');
  g.liga('identificar', 'aguarda_origem');
  g.liga('aguarda_origem', 'origem', 'resposta');
  g.liga('aguarda_origem', 'oportunidade', 'timeout');
  g.liga('origem', 'tag_google', 'google');
  g.liga('origem', 'tag_meta', 'metaads');
  g.liga('origem', 'avisa_cliente', 'cliente');
  g.liga('origem', 'oportunidade', 'indicacao');
  g.liga('origem', 'oportunidade', 'nenhum');
  g.liga('tag_google', 'oportunidade');
  g.liga('tag_meta', 'oportunidade');
  g.liga('oportunidade', 'boas_vindas');
  g.liga('boas_vindas', 'espera2s');
  g.liga('espera2s', 'procedimento');
  g.liga('procedimento', 'aguarda_2h');
  g.liga('aguarda_2h', 'em_atendimento', 'resposta');
  g.liga('aguarda_2h', 'fl1', 'timeout');
  g.liga('fl1', 'aguarda_1d');
  g.liga('aguarda_1d', 'volta_atendimento_1', 'resposta');
  g.liga('aguarda_1d', 'fl2', 'timeout');
  g.liga('fl2', 'aguarda_3d');
  g.liga('aguarda_3d', 'volta_atendimento_2', 'resposta');
  g.liga('aguarda_3d', 'sem_resposta', 'timeout');
  return { nos: g.nos, arestas: g.arestas };
}

function notificacaoInterna(foneEquipe) {
  const g = grafo();
  g.no('tag_servico', 'gatilho.tag_adicionada', 'Tag · serviço escolhido', 0, 1, { tag: 'serviço escolhido' });
  g.no('tag_pagamento', 'gatilho.tag_adicionada', 'Tag · pagamento feito', 0, 3, { tag: 'pagamento feito' });
  g.no('condicao', 'controle.condicao', 'Condição', 1, 2, {
    ramos: [
      { id: 'pagamento', rotulo: 'Pagamento feito', juncao: 'OR', regras: [{ campo: 'contato.tags', operador: 'igual', valor: 'pagamento feito' }] },
      { id: 'servico', rotulo: 'Serviço escolhido', juncao: 'AND', regras: [{ campo: 'contato.tags', operador: 'igual', valor: 'serviço escolhido' }] },
      { id: 'nenhum', rotulo: 'Nenhuma', juncao: 'NONE', regras: [] },
    ],
  });
  g.no('avisa_pagamento', 'acao.notificar_equipe', 'Notificação interna · pagamento', 2, 1, { telefone: foneEquipe, texto: T.pagamento });
  g.no('avisa_servico', 'acao.notificar_equipe', 'Notificação interna · serviço', 2, 3, { telefone: foneEquipe, texto: T.servico });
  g.no('fim', 'controle.encerrar', 'Fim', 2, 4, { motivo: 'sem tag de aviso' });
  g.liga('tag_servico', 'condicao');
  g.liga('tag_pagamento', 'condicao');
  g.liga('condicao', 'avisa_pagamento', 'pagamento');
  g.liga('condicao', 'avisa_servico', 'servico');
  g.liga('condicao', 'fim', 'nenhum');
  return { nos: g.nos, arestas: g.arestas };
}

// ---------------------------------------------------------------- execução
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { WorkflowsService } = require('../../dist/automations/workflows.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const wf = app.get(WorkflowsService);
  const dono = await prisma.withTenant(TENANT, (tx) => tx.membership.findFirst({ where: { tenantId: TENANT, role: { in: ['owner', 'admin'] } }, orderBy: { createdAt: 'asc' }, select: { identityId: true } }));
  if (!dono) throw new Error('tenant sem dono/admin');
  // Etapas do funil importado do GHL (por nome); cai no funil com essas etapas.
  const etapas = await prisma.withTenant(TENANT, (tx) => tx.stage.findMany({ select: { id: true, nome: true, pipelineId: true } }));
  const porFunil = new Map();
  for (const e of etapas) porFunil.set(e.pipelineId, { ...(porFunil.get(e.pipelineId) ?? {}), [e.nome]: e.id });
  const st = [...porFunil.values()].find((m) => m['Novo Lead'] && m['Em Atendimento'] && m['Sem Resposta']);
  if (!st) throw new Error('funil com as etapas "Novo Lead", "Em Atendimento" e "Sem Resposta" não encontrado (importe o funil do GHL antes)');
  const fone = telefoneEquipe();

  const definicoes = [
    {
      nome: 'Novo Lead 🚀 (importado do GHL v14)',
      descricao:
        'Recriado do GHL. Diferenças: a pergunta de origem tinha botões (Stevo não envia botões pelo motor; virou "Responda com: Google, Instagram ou Já sou cliente"); tempos da espera inicial (1 min) e da resposta de origem (1 dia) não aparecem no print, confira; FL-3 nunca foi enviado no GHL (sem texto), então quem não responde ao FL-2 vai para "Sem Resposta"; "Update conversation AI bot" não tem equivalente.',
      tags: ['importado-ghl'],
      grafo: novoLead(st, fone),
    },
    {
      nome: 'Notificação Interna 🔔 (importado do GHL)',
      descricao: 'Recriado do GHL: tag "pagamento feito" ou "serviço escolhido" avisa a equipe no WhatsApp (mesmo número e textos do GHL).',
      tags: ['importado-ghl'],
      grafo: notificacaoInterna(fone),
    },
  ];

  const existentes = await prisma.withTenant(TENANT, (tx) => tx.workflow.findMany({ select: { id: true, nome: true } }));
  for (const d of definicoes) {
    if (existentes.some((e) => e.nome === d.nome)) {
      console.log(`= já existe, pulado: ${d.nome}`);
      continue;
    }
    const criado = await wf.criar(TENANT, dono.identityId, { nome: d.nome, descricao: d.descricao });
    const id = criado.id;
    await wf.renomear(TENANT, id, { tags: d.tags });
    await wf.configurar(TENANT, id, dono.identityId, { reentrada: 'uma_vez', pararNoReply: false });
    await wf.salvarRascunho(TENANT, id, d.grafo);
    const problemas = wf.validar(d.grafo);
    if (problemas.length) {
      console.log(`! ${d.nome}: rascunho salvo, mas a validação acusou: ${JSON.stringify(problemas)}`);
      continue;
    }
    if (PUBLICAR) {
      await wf.publicar(TENANT, id, dono.identityId);
      console.log(`+ publicado (ATIVO): ${d.nome} · ${d.grafo.nos.length} nós`);
    } else {
      console.log(`+ rascunho válido: ${d.nome} · ${d.grafo.nos.length} nós (ative no editor na virada do GHL)`);
    }
  }
} catch (e) {
  console.error('ERRO:', e?.response?.message ?? e?.message ?? e);
  process.exitCode = 1;
} finally {
  await app.close();
}

#!/usr/bin/env node
/**
 * Reconstrói no motor do KHUB as 6 automações que a Studio da Beleza operava
 * no GHL (docs/revenue-audit/evidence/ghl/4UVfJ6m5F0B7eCDAsKVY/workflows.json).
 *
 * A API do GHL não exporta a LÓGICA dos workflows — só nome/status/versão.
 * Os textos abaixo vêm de evidência REAL: 8.093 mensagens exportadas
 * (messages.json), onde mensagens com source='workflow' mostram os templates
 * exatos que a operação usava. Nada foi inventado; o que não tinha evidência
 * ficou como RASCUNHO com anotação na descrição.
 *
 * Adaptações honestas (anotadas em cada descrição):
 *  - botões interativos do WhatsApp (#bt ... Google*id1/Instagram*id2) viraram
 *    pergunta em texto puro — o canal Stevo não envia botões interativos;
 *  - "Resposta na Dm" era Instagram DM no GHL; o KHUB opera WhatsApp;
 *  - "Disparo de Mensagem" é um mecanismo por campanha: a mensagem é de cada
 *    disparo, então o texto fica para o usuário preencher antes de publicar.
 *
 * Uso: node --env-file=.env scripts/operar/criar-automacoes-studio.mjs
 * Idempotente por nome: workflow existente com o mesmo nome é pulado.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const TENANT = '1cc7e839-f72c-414b-9d3f-a8b4131008c8'; // Studio da Beleza
const IDENTITY = '1ee9b3b8-51ab-4438-b9f6-ea998d9deb87'; // pedro.gabriel@conteudo.orvyn.app

// Marketing Pipeline (já existente no tenant)
const STAGE = {
  novoLead: '4ac212e3-02a9-4a48-846e-7b838d7b906f',
  emAtendimento: '0fd815e1-a540-4779-9c3e-22f8734c0530',
  agendamentoMarcado: '864dcb6d-09f3-4b07-b3b6-340e0e1e4ef3',
  semResposta: '0688f95b-e7e1-4610-844c-353742faa9bc',
};

const no = (id, tipo, config, x, y, extra = {}) => ({ id, tipo, config, posicao: { x, y }, ...extra });
const ar = (id, de, para, ramo) => ({ id, de, para, ...(ramo ? { ramo } : {}) });

const BOAS_VINDAS = [
  'Oii, {{contato.primeiroNome}}! Seja muito bem-vinda ao Studio da Beleza! 💕',
  '',
  'Antes de continuarmos, conta pra gente: você já é nossa cliente ou conheceu o nosso Studio pelo Google ou pelo Instagram?',
  '',
  'É um prazer ter você por aqui!',
].join('\n');

const QUAL_PROCEDIMENTO = 'Queremos entender como podemos te ajudar!\nQual procedimento ou serviço você gostaria de realizar? 💕';

const CONFIRMACAO_AGENDAMENTO = [
  '`Oie, tudo bem?`💜',
  'Esta mensagem é para confirmação do seu agendamento.',
  '*Seu horário agendado é:* {{gatilho.horario}}',
  ' _Lembrando que a tolerância de atrasos é de no máximo 10 minutos, mais que isso nos impossibilitam de realizar o atendimento. Caso precise desmarcar, pedimos que avise com pelo menos 2 horas de antecedência. No caso de não comparecimento ou cancelamento fora desse prazo, será cobrada uma taxa de 50% do valor do serviço._ ',
  '`Agradecemos a compreensão!`',
  '📍LEMBRANDO QUE ESTAMOS LOCALIZADOS NO ENDEREÇO: *MAESTRO ZICO SEABRA 826*📍',
].join('\n');

const WORKFLOWS = [
  {
    nome: 'Novo Lead 🚀',
    publicar: true,
    reentrada: 'uma_vez',
    descricao:
      'Reconstruída do GHL ("Novo Lead 🚀 - v14") a partir das mensagens reais exportadas (286 envios). ' +
      'No GHL a boas-vindas tinha botões (Google/Instagram/Já sou cliente); aqui a resposta é em texto — a espera de resposta trata o retorno. ' +
      'Sem resposta em 24h: lead vai para "Sem Resposta" com tag follow-up.',
    grafo: {
      nos: [
        no('g1', 'gatilho.contato_criado', {}, 0, 0),
        no('a1', 'acao.enviar_sms', { texto: BOAS_VINDAS }, 0, 160),
        no('c1', 'acao.criar_oportunidade', { titulo: '{{contato.nome}}', stageId: STAGE.novoLead, origem: 'whatsapp' }, 0, 320),
        no('w1', 'controle.esperar_resposta', { duracao: 24, unidade: 'horas' }, 0, 480),
        no('a2', 'acao.enviar_sms', { texto: QUAL_PROCEDIMENTO }, -220, 640),
        no('m1', 'acao.mover_etapa', { stageId: STAGE.emAtendimento }, -220, 800),
        no('m2', 'acao.mover_etapa', { stageId: STAGE.semResposta }, 220, 640),
        no('t1', 'acao.adicionar_tag', { tag: 'follow-up' }, 220, 800),
      ],
      arestas: [
        ar('e1', 'g1', 'a1'), ar('e2', 'a1', 'c1'), ar('e3', 'c1', 'w1'),
        ar('e4', 'w1', 'a2', 'resposta'), ar('e5', 'a2', 'm1'),
        ar('e6', 'w1', 'm2', 'timeout'), ar('e7', 'm2', 't1'),
      ],
    },
  },
  {
    nome: 'MetaAds WhatsApp Lead Tagging',
    publicar: true,
    descricao:
      'Reconstruída do GHL (v7): lead que chega pelos anúncios da Meta é marcado e entra no funil. ' +
      'O gatilho filtra contatos criados com origem "metaads" — se a importação de leads usar outro rótulo de origem, ajuste o filtro no gatilho.',
    grafo: {
      nos: [
        no('g1', 'gatilho.contato_criado', { origem: 'metaads' }, 0, 0),
        no('t1', 'acao.adicionar_tag', { tag: 'metaads' }, 0, 160),
        no('t2', 'acao.adicionar_tag', { tag: 'warm lead' }, 0, 320),
        no('c1', 'acao.criar_oportunidade', { titulo: '{{contato.nome}}', stageId: STAGE.novoLead, origem: 'metaads' }, 0, 480),
      ],
      arestas: [ar('e1', 'g1', 't1'), ar('e2', 't1', 't2'), ar('e3', 't2', 'c1')],
    },
  },
  {
    nome: 'Notificação Interna 🔔',
    publicar: true,
    reentrada: 'sempre',
    descricao:
      'Reconstruída do GHL (v4): avisa a equipe no WhatsApp quando um negócio novo entra no funil. ' +
      'Número da equipe (Marcos) veio do users.json exportado do GHL. Para avisar outro número, edite a ação.',
    grafo: {
      nos: [
        no('g1', 'gatilho.negocio_criado', {}, 0, 0),
        no('n1', 'acao.notificar_equipe', { telefone: '+5518981948549', texto: '📣 Novo lead no funil: {{contato.nome}} ({{contato.telefone}})' }, 0, 160),
      ],
      arestas: [ar('e1', 'g1', 'n1')],
    },
  },
  {
    nome: 'Agendamento Confirmado 📅',
    publicar: false, // rascunho: depende de quem chama o webhook
    reentrada: 'sempre',
    descricao:
      'RASCUNHO — texto real de confirmação recuperado das mensagens exportadas do GHL (323 envios). ' +
      'O GHL disparava pelo calendário dele; aqui o gatilho é um webhook: o sistema de agendamento chama a URL deste fluxo com ' +
      '{"telefone": "55...", "horario": "amanhã as 15h"} e a confirmação sai no WhatsApp. {{gatilho.horario}} vem do payload. Publicar quando o chamador estiver configurado.',
    grafo: {
      nos: [
        no('g1', 'gatilho.webhook', { identificarPor: 'telefone', campo: 'telefone', seNaoAchar: 'ignorar' }, 0, 0),
        no('a1', 'acao.enviar_sms', { texto: CONFIRMACAO_AGENDAMENTO }, 0, 160),
      ],
      arestas: [ar('e1', 'g1', 'a1')],
    },
  },
  {
    nome: 'Disparo de Mensagem📨',
    publicar: false, // rascunho: a mensagem é de cada campanha
    descricao:
      'RASCUNHO — mecanismo de disparo em massa reconstruído do GHL (v2). ' +
      'Como usar: escreva a mensagem da campanha na ação de envio, aplique a tag "disparo" nos contatos da lista e publique. ' +
      'O drip libera 30 contatos por minuto para não queimar o número. No GHL cada disparo tinha seu próprio texto — por isso a mensagem não veio preenchida.',
    grafo: {
      nos: [
        no('g1', 'gatilho.tag_adicionada', { tag: 'disparo' }, 0, 0),
        no('d1', 'controle.drip', { porJanela: 30, janela: 'minuto' }, 0, 160),
        no('a1', 'acao.enviar_sms', { texto: '⚠️ EDITE ESTA MENSAGEM ANTES DE PUBLICAR — escreva aqui o texto deste disparo.' }, 0, 320),
      ],
      arestas: [ar('e1', 'g1', 'd1'), ar('e2', 'd1', 'a1')],
    },
  },
  {
    nome: 'Resposta na Dm',
    publicar: false, // rascunho: era Instagram no GHL
    descricao:
      'RASCUNHO — no GHL respondia DMs de Instagram (183 mensagens IG no export); o KHUB opera WhatsApp. ' +
      'Versão equivalente: primeira mensagem que o contato manda no WhatsApp recebe a boas-vindas real da operação. ' +
      'Reentrada "uma_vez" garante que só dispara na primeira mensagem de cada contato.',
    reentrada: 'uma_vez',
    grafo: {
      nos: [
        no('g1', 'gatilho.mensagem_recebida', { canal: 'WhatsApp' }, 0, 0),
        no('a1', 'acao.enviar_sms', { texto: BOAS_VINDAS }, 0, 160),
      ],
      arestas: [ar('e1', 'g1', 'a1')],
    },
  },
];

// Validação offline dos grafos contra o catálogo REAL (mesmo Zod do executor)
// antes de tocar no banco — erro de grafo aqui custa um workflow quebrado na UI.
{
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { grafoSchema, validarConfig } = require('../../dist/automations/catalogo.js');
  let falhou = false;
  for (const w of WORKFLOWS) {
    const p = grafoSchema.safeParse(w.grafo);
    if (!p.success) { console.error(`GRAFO INVÁLIDO (${w.nome}):`, JSON.stringify(p.error.issues)); falhou = true; continue; }
    for (const n of p.data.nos) {
      const v = validarConfig(n.tipo, n.config);
      if (!v.ok) { console.error(`CONFIG INVÁLIDA (${w.nome} / ${n.tipo}):`, v.erro); falhou = true; }
    }
    const ids = new Set(p.data.nos.map((n) => n.id));
    for (const a of p.data.arestas) if (!ids.has(a.de) || !ids.has(a.para)) { console.error(`ARESTA QUEBRADA (${w.nome}):`, a.id); falhou = true; }
  }
  if (falhou) { console.error('validação falhou — nada foi gravado'); process.exit(1); }
  console.log(`grafos válidos: ${WORKFLOWS.length} workflows`);
}

const criados = [];
const pulados = [];
for (const def of WORKFLOWS) {
  const r = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
    const existe = await tx.workflow.findFirst({ where: { tenantId: TENANT, nome: def.nome }, select: { id: true } });
    if (existe) return { pulado: true };

    const w = await tx.workflow.create({
      data: {
        tenantId: TENANT,
        nome: def.nome,
        descricao: def.descricao,
        tags: ['migracao_ghl'],
        status: 'rascunho',
        criadoPor: IDENTITY,
        ...(def.reentrada ? { reentrada: def.reentrada } : {}),
      },
    });
    const v = await tx.workflowVersion.create({
      data: {
        tenantId: TENANT,
        workflowId: w.id,
        versao: 1,
        grafo: def.grafo,
        ...(def.publicar ? { publicadoEm: new Date(), publicadoPor: IDENTITY } : {}),
      },
    });
    if (def.publicar) {
      await tx.workflow.update({ where: { id: w.id }, data: { versaoAtivaId: v.id, status: 'ativo' } });
    }
    await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${TENANT}::uuid, 'sistema', ${IDENTITY}, 'workflow.migracao_ghl', 'workflow', ${w.id}, ${JSON.stringify({ nome: def.nome, publicado: def.publicar })}::jsonb)`;
    return { id: w.id, publicado: def.publicar };
  });
  if (r.pulado) pulados.push(def.nome);
  else criados.push(`${def.nome} (${def.publicar ? 'PUBLICADO' : 'rascunho'})`);
}

console.log('criados:', criados.length ? criados.join(' | ') : 'nenhum');
console.log('pulados (já existiam):', pulados.length ? pulados.join(' | ') : 'nenhum');
await prisma.$disconnect();

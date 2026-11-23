// Seed do marketplace de automações (db/016) — 6 receitas oficiais.
//
// Uso:
//   cd apps/api && node scripts/seed-marketplace.mjs
//
// Idempotente: INSERT ... ON CONFLICT (slug global) DO UPDATE. Roda como
// superusuário (a RLS de automation_templates só deixa global via orvyn_service).
//
// Convenções do grafo (apps/api/src/automations/catalogo.ts):
//  - esperar_resposta: arestas de saída com ramo 'resposta' | 'timeout';
//  - condicao: config.ramos[{id, rotulo, juncao, regras}], último ramo NONE
//    sem regras ("nenhuma das condições"); arestas com ramo = id do ramo;
//  - {{var.chave}} é ligado na instalação (marketplace.service bindVariaveis);
//  - variáveis de mensagem: {{contato.primeiroNome}}, {{contato.nome}},
//    {{contato.telefone}}, {{agendamento.data|hora|titulo|local}},
//    {{mensagem.texto}} (resposta do contato após "esperar resposta").

import { PrismaClient } from '@prisma/client';

// ATENÇÃO: o @prisma/client carrega apps/api/.env automaticamente e o
// DATABASE_URL de lá aponta para o role da aplicação (sem bypass de RLS —
// a escrita em templates globais falha). Por isso a URL admin local é o
// default fixo; use SEED_DATABASE_URL para apontar outro banco.
const URL_ADMIN = process.env.SEED_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';
const prisma = new PrismaClient({ datasources: { db: { url: URL_ADMIN } } });

// ---------------------------------------------------------------------------
// Variáveis de template reutilizadas
// ---------------------------------------------------------------------------
const V_TEL = {
  chave: 'telefone_equipe',
  label: 'WhatsApp da equipe (recebe os avisos internos)',
  tipo: 'texto',
  obrigatorio: false,
  default: '+5511999990000',
};
const V_STAGE_LEAD = {
  chave: 'stage_id',
  label: 'Etapa do funil onde o lead entra (ID da etapa — ex.: Captação)',
  tipo: 'etapa',
  obrigatorio: true,
};
const V_STAGE_PROPOSTA = {
  chave: 'stage_id',
  label: 'Etapa que dispara o follow-up (ID da etapa — ex.: Proposta)',
  tipo: 'etapa',
  obrigatorio: true,
};

// ---------------------------------------------------------------------------
// Helpers de grafo
// ---------------------------------------------------------------------------
const no = (id, tipo, rotulo, x, y, config = {}) => ({ id, tipo, rotulo, posicao: { x, y }, config });
const ar = (id, de, para, ramo) => (ramo ? { id, de, para, ramo } : { id, de, para });

// ---------------------------------------------------------------------------
// 1 · Novo lead: qualificação por origem (padrão "Novo Lead v14" do GHL)
// ---------------------------------------------------------------------------
const boasVindas =
  'Oii {{contato.primeiroNome}}! 💜 Aqui é da recepção. Que bom te ver por aqui!\n\n' +
  'Pra eu te direcionar certinho, me conta rapidinho: como você conheceu a gente?\n' +
  '1️⃣ Google\n2️⃣ Instagram\n3️⃣ Indicação de alguém\n4️⃣ Já sou cliente';

const fl1 =
  'Oi {{contato.primeiroNome}}, passei rapidinho pra não te deixar sem resposta 😊 ' +
  'Se preferir, é só me dizer como chegou até nós (Google, Instagram, indicação ou se já é cliente) ' +
  'que eu já te passo as informações certas.';

const fl2 =
  '{{contato.primeiroNome}}, ainda posso te ajudar? Temos horários abertos essa semana ' +
  'pra avaliação. Me responde aqui que eu já deixo um reservado pra você.';

const fl3 =
  'Oi {{contato.primeiroNome}}! Vou encerrar nosso contato por aqui pra não encher seu WhatsApp, tá? ' +
  'Quando quiser retomar, é só mandar um "oi" que a gente continua de onde parou. 💜';

const ramoOrigem = (id, rotulo, palavras) => ({
  id,
  rotulo,
  juncao: 'OR',
  regras: palavras.map((valor) => ({ campo: 'mensagem.texto', operador: 'contem', valor })),
});

// Monta um trio tag → oportunidade → aviso para cada origem identificada.
function trioOrigem(id, y, tag, origem, textoAviso) {
  return {
    nos: [
      no(`tag-${id}`, 'acao.adicionar_tag', `Tag '${tag}'`, 1000, y, { tag }),
      no(`opp-${id}`, 'acao.criar_oportunidade', 'Cria oportunidade', 1190, y, {
        titulo: `{{contato.nome}} · ${origem}`,
        stageId: '{{var.stage_id}}',
        origem,
      }),
      no(`aviso-${id}`, 'acao.notificar_equipe', 'Avisa a equipe', 1380, y, {
        telefone: '{{var.telefone_equipe}}',
        texto: textoAviso,
      }),
    ],
    arestas: [
      ar(`e-cond-${id}`, 'cond-origem', `tag-${id}`, id),
      ar(`e-${id}-a`, `tag-${id}`, `opp-${id}`),
      ar(`e-${id}-b`, `opp-${id}`, `aviso-${id}`),
    ],
  };
}

const trios = [
  trioOrigem('google', 620, 'origem-google', 'Google',
    '🆕 Lead novo qualificado: {{contato.nome}} ({{contato.telefone}}) — veio pelo GOOGLE. Oportunidade criada no funil, vale chamar agora enquanto tá quente.'),
  trioOrigem('instagram', 780, 'origem-instagram', 'Instagram',
    '🆕 Lead novo qualificado: {{contato.nome}} ({{contato.telefone}}) — veio pelo INSTAGRAM. Oportunidade criada no funil, vale chamar agora enquanto tá quente.'),
  trioOrigem('indicacao', 940, 'origem-indicacao', 'Indicação',
    '🆕 Lead novo qualificado: {{contato.nome}} ({{contato.telefone}}) — veio por INDICAÇÃO (lead quente!). Oportunidade criada no funil, prioridade alta.'),
  trioOrigem('cliente', 1100, 'cliente-retorno', 'Retorno (já é cliente)',
    '💜 Cliente da base voltou: {{contato.nome}} ({{contato.telefone}}). Oportunidade criada no funil — histórico dele já tá no CRM.'),
  trioOrigem('outro', 1260, 'origem-a-confirmar', 'Origem a confirmar',
    '🆕 Lead novo sem origem clara: {{contato.nome}} ({{contato.telefone}}) — respondeu "{{mensagem.texto}}". Oportunidade criada; confirmar a origem no primeiro contato.'),
];

const novoLeadQualificacao = {
  slug: 'novo-lead-qualificacao',
  name: 'Novo lead: qualificação por origem',
  description:
    'Lead novo esfria em minutos. Este fluxo dá boas-vindas na hora, pergunta a origem (Google, Instagram, indicação ou cliente), ' +
    'marca a tag certa, cria a oportunidade no funil e avisa a equipe — e se o lead não responder, insiste com 3 follow-ups antes de desistir.',
  category: 'vendas',
  difficulty: 'avancada',
  estimated_min: 15,
  tags: ['lead', 'qualificação', 'whatsapp', 'funil', 'follow-up'],
  icon: 'funnel',
  requirements: ['stevo'],
  variables: [V_STAGE_LEAD, V_TEL],
  workflow: {
    nos: [
      no('gatilho', 'gatilho.contato_criado', 'Novo lead entra', 0, 300),
      no('respiro', 'controle.esperar', 'Respiro · 1 min', 190, 300, { duracao: 1, unidade: 'minutos' }),
      no('boasvindas', 'acao.enviar_sms', 'Boas-vindas (pergunta a origem)', 380, 300, { texto: boasVindas }),
      no('aguarda-1', 'controle.esperar_resposta', 'Aguarda resposta · 2h', 600, 300, { duracao: 2, unidade: 'horas' }),
      no('cond-origem', 'controle.condicao', 'Qual a origem?', 810, 300, {
        ramos: [
          ramoOrigem('google', 'Google', ['google']),
          ramoOrigem('instagram', 'Instagram', ['instagram', 'insta']),
          ramoOrigem('indicacao', 'Indicação', ['indicação', 'indicacao', 'indicou']),
          ramoOrigem('cliente', 'Já é cliente', ['já sou', 'ja sou', 'cliente']),
          { id: 'outro', rotulo: 'Nenhuma das condições', juncao: 'NONE', regras: [] },
        ],
      }),
      // Cadeia de follow-ups (ramo "não respondeu")
      no('fl-1', 'acao.enviar_sms', 'FL-1 · +2h', 600, 460, { texto: fl1 }),
      no('aguarda-2', 'controle.esperar_resposta', 'Aguarda · 1 dia', 810, 460, { duracao: 1, unidade: 'dias' }),
      no('fl-2', 'acao.enviar_sms', 'FL-2 · +1 dia', 1010, 460, { texto: fl2 }),
      no('aguarda-3', 'controle.esperar_resposta', 'Aguarda · 3 dias', 1220, 460, { duracao: 3, unidade: 'dias' }),
      no('fl-3', 'acao.enviar_sms', 'FL-3 · despedida', 1430, 460, { texto: fl3 }),
      no('tag-frio', 'acao.adicionar_tag', "Tag 'lead-frio'", 1620, 460, { tag: 'lead-frio' }),
      no('fim-frio', 'controle.encerrar', 'Encerrar', 1810, 460, { motivo: 'sem resposta após 3 follow-ups' }),
      ...trios.flatMap((t) => t.nos),
    ],
    arestas: [
      ar('e-1', 'gatilho', 'respiro'),
      ar('e-2', 'respiro', 'boasvindas'),
      ar('e-3', 'boasvindas', 'aguarda-1'),
      ar('e-4', 'aguarda-1', 'cond-origem', 'resposta'),
      ar('e-5', 'aguarda-1', 'fl-1', 'timeout'),
      ar('e-6', 'fl-1', 'aguarda-2'),
      ar('e-7', 'aguarda-2', 'cond-origem', 'resposta'),
      ar('e-8', 'aguarda-2', 'fl-2', 'timeout'),
      ar('e-9', 'fl-2', 'aguarda-3'),
      ar('e-10', 'aguarda-3', 'cond-origem', 'resposta'),
      ar('e-11', 'aguarda-3', 'fl-3', 'timeout'),
      ar('e-12', 'fl-3', 'tag-frio'),
      ar('e-13', 'tag-frio', 'fim-frio'),
      ...trios.flatMap((t) => t.arestas),
    ],
    notas: [
      {
        id: 'nota-cond',
        texto:
          'Toda resposta do lead cai nesta condição — inclusive as que chegam depois dos follow-ups FL-1 a FL-3. ' +
          'O ramo final cobre o que não casou com nenhuma palavra-chave, pra ninguém sumir do fluxo.',
        posicao: { x: 810, y: 130 },
        tom: 'marca',
      },
      {
        id: 'nota-fl',
        texto: 'Follow-ups espaçados (2h, 1 dia, 3 dias). Quem não responde nem ao 3º vira "lead-frio" e sai do fluxo.',
        posicao: { x: 1430, y: 620 },
        tom: 'neutro',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 2 · Lembrete D-1 com confirmação
// ---------------------------------------------------------------------------
const lembreteD1 = {
  slug: 'lembrete-agendamento-d1',
  name: 'Lembrete D-1 com confirmação',
  description:
    'Falta de véspera derruba o faturamento da agenda. Este fluxo avisa o contato na véspera do horário, ' +
    'marca "confirmado" quando ele responde e chama a equipe quando fica no vácuo.',
  category: 'agenda',
  difficulty: 'facil',
  estimated_min: 3,
  tags: ['agenda', 'lembrete', 'confirmação', 'whatsapp'],
  icon: 'calendar',
  requirements: ['stevo'],
  variables: [V_TEL],
  workflow: {
    nos: [
      no('gatilho', 'gatilho.lembrete_agendamento', 'Falta 1 dia (D-1)', 0, 300),
      no('lembrete', 'acao.enviar_sms', 'Lembrete D-1', 220, 300, {
        texto:
          'Oi {{contato.primeiroNome}}! 💜 Lembrete: amanhã, {{agendamento.data}} às {{agendamento.hora}}, ' +
          'é seu horário de {{agendamento.titulo}} aqui com a gente.\n\nPosso confirmar? Responde SIM pra confirmar 😊',
      }),
      no('aguarda', 'controle.esperar_resposta', 'Aguarda confirmação · 6h', 450, 300, { duracao: 6, unidade: 'horas' }),
      no('cond', 'controle.condicao', 'Confirmou?', 700, 300, {
        ramos: [
          {
            id: 'confirmou', rotulo: 'Confirmou', juncao: 'OR',
            regras: ['sim', 'confirmo', 'confirmado', 'confirmada', 'ok', 'pode deixar'].map((valor) => ({
              campo: 'mensagem.texto', operador: 'contem', valor,
            })),
          },
          { id: 'nao', rotulo: 'Não confirmou', juncao: 'NONE', regras: [] },
        ],
      }),
      no('tag-ok', 'acao.adicionar_tag', "Tag 'confirmado'", 930, 190, { tag: 'confirmado' }),
      no('fim-ok', 'controle.encerrar', 'Encerrar', 1130, 190, { motivo: 'horário confirmado pelo contato' }),
      no('aviso', 'acao.notificar_equipe', 'Pedir confirmação manual', 930, 410, {
        telefone: '{{var.telefone_equipe}}',
        texto:
          '⚠️ {{contato.nome}} ({{contato.telefone}}) ainda NÃO confirmou o horário de amanhã ' +
          '({{agendamento.data}} às {{agendamento.hora}} — {{agendamento.titulo}}). Confirma manualmente com ele?',
      }),
    ],
    arestas: [
      ar('e-1', 'gatilho', 'lembrete'),
      ar('e-2', 'lembrete', 'aguarda'),
      ar('e-3', 'aguarda', 'cond', 'resposta'),
      ar('e-4', 'aguarda', 'aviso', 'timeout'),
      ar('e-5', 'cond', 'tag-ok', 'confirmou'),
      ar('e-6', 'cond', 'aviso', 'nao'),
      ar('e-7', 'tag-ok', 'fim-ok'),
    ],
    notas: [
      {
        id: 'nota-agenda',
        texto: 'Quando o contato responde "sim", a própria agenda já marca o compromisso como confirmado — a tag é o registro no CRM.',
        posicao: { x: 700, y: 90 },
        tom: 'neutro',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 3 · No-show: remarcação em 2 toques
// ---------------------------------------------------------------------------
const msgNoShow1 =
  'Oi {{contato.primeiroNome}}, sentimos sua falta hoje! 😢 Aconteceu algum imprevisto?\n\n' +
  'Sem problemas — a gente remarca. Me diz um dia e horário bons pra você que eu já deixo agendado.';

const msgNoShow2 =
  '{{contato.primeiroNome}}, não quer perder o ritmo do seu tratamento? ' +
  'Consigo te encaixar ainda essa semana. Responde aqui com o melhor dia pra você 😊';

const noShowRecuperacao = {
  slug: 'no-show-recuperacao',
  name: 'No-show: remarcação em 2 toques',
  description:
    'Quem falta sem avisar costuma sumir de vez. Este fluxo acolhe o contato com empatia, abre a remarcação ' +
    'com a equipe quando ele responde e tenta uma segunda vez antes de marcar como frio.',
  category: 'agenda',
  difficulty: 'media',
  estimated_min: 5,
  tags: ['agenda', 'no-show', 'remarcação', 'recuperação'],
  icon: 'refresh',
  requirements: ['stevo'],
  variables: [V_TEL],
  workflow: {
    nos: [
      no('gatilho', 'gatilho.faltou', 'Contato faltou', 0, 300),
      no('msg-1', 'acao.enviar_sms', 'Mensagem empática', 210, 300, { texto: msgNoShow1 }),
      no('aguarda-1', 'controle.esperar_resposta', 'Aguarda · 1 dia', 440, 300, { duracao: 1, unidade: 'dias' }),
      no('pausa', 'controle.esperar', 'Pausa · 2 dias', 440, 470, { duracao: 2, unidade: 'dias' }),
      no('msg-2', 'acao.enviar_sms', '2ª mensagem · remarcação', 650, 470, { texto: msgNoShow2 }),
      no('aguarda-2', 'controle.esperar_resposta', 'Aguarda · 2 dias', 880, 470, { duracao: 2, unidade: 'dias' }),
      no('tarefa', 'acao.criar_tarefa', 'Tarefa: remarcar', 700, 130, {
        titulo: 'Remarcar horário com {{contato.nome}} (no-show)', prioridade: 'alta', emDias: 0,
      }),
      no('tag-remarcar', 'acao.adicionar_tag', "Tag 'remarcar'", 910, 130, { tag: 'remarcar' }),
      no('fim-ok', 'controle.encerrar', 'Encerrar', 1110, 130, { motivo: 'remarcação em andamento com a equipe' }),
      no('tag-frio', 'acao.adicionar_tag', "Tag 'no-show-frio'", 1110, 470, { tag: 'no-show-frio' }),
      no('fim-frio', 'controle.encerrar', 'Encerrar', 1310, 470, { motivo: 'no-show sem retorno em 2 toques' }),
    ],
    arestas: [
      ar('e-1', 'gatilho', 'msg-1'),
      ar('e-2', 'msg-1', 'aguarda-1'),
      ar('e-3', 'aguarda-1', 'tarefa', 'resposta'),
      ar('e-4', 'aguarda-1', 'pausa', 'timeout'),
      ar('e-5', 'pausa', 'msg-2'),
      ar('e-6', 'msg-2', 'aguarda-2'),
      ar('e-7', 'aguarda-2', 'tarefa', 'resposta'),
      ar('e-8', 'aguarda-2', 'tag-frio', 'timeout'),
      ar('e-9', 'tarefa', 'tag-remarcar'),
      ar('e-10', 'tag-remarcar', 'fim-ok'),
      ar('e-11', 'tag-frio', 'fim-frio'),
    ],
    notas: [
      {
        id: 'nota-tarefa',
        texto: 'A tarefa cai na lista da equipe com prioridade alta: a remarcação em si é humana — o fluxo só garante que ela aconteça.',
        posicao: { x: 700, y: 0 },
        tom: 'neutro',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 4 · Proposta enviada: follow-up 1d/3d/7d
// ---------------------------------------------------------------------------
const msgProp1 =
  'Oi {{contato.primeiroNome}}! Passando pra saber se você conseguiu ver a proposta que te enviei. ' +
  'Ficou alguma dúvida sobre valores ou formas de pagamento? Posso te explicar por aqui mesmo 😊';

const msgProp2 =
  '{{contato.primeiroNome}}, a proposta ainda tá valendo! Se ajudar, a gente parcela no cartão ' +
  'e eu consigo segurar essas condições até sexta. Vamos fechar?';

const msgProp3 =
  'Oi {{contato.primeiroNome}}, última vez que te chamo sobre a proposta, prometo! ' +
  'Se o momento mudou ou surgiu outra prioridade, sem problema — me conta aqui que eu ajusto pra você. ' +
  'Se ainda fizer sentido, essa semana é a melhor condição que consigo.';

const propostaFollowup = {
  slug: 'proposta-followup',
  name: 'Proposta enviada: follow-up 1d/3d/7d',
  description:
    'Proposta sem follow-up vira esquecimento. Este fluxo faz 3 toques espaçados (1, 3 e 7 dias) depois que o negócio ' +
    'entra na etapa de proposta — e escala pra equipe quando o contato responde ou quando esgota as tentativas.',
  category: 'vendas',
  difficulty: 'media',
  estimated_min: 8,
  tags: ['proposta', 'follow-up', 'vendas', 'funil'],
  icon: 'briefcase',
  requirements: ['stevo'],
  variables: [V_STAGE_PROPOSTA, V_TEL],
  workflow: {
    nos: [
      no('gatilho', 'gatilho.etapa_mudou', 'Entrou em "Proposta"', 0, 300, { stageId: '{{var.stage_id}}' }),
      no('espera-1', 'controle.esperar', 'Espera · 1 dia', 200, 300, { duracao: 1, unidade: 'dias' }),
      no('toque-1', 'acao.enviar_sms', 'Toque 1 · dia 1', 400, 300, { texto: msgProp1 }),
      no('aguarda-1', 'controle.esperar_resposta', 'Aguarda · 2 dias', 610, 300, { duracao: 2, unidade: 'dias' }),
      no('toque-2', 'acao.enviar_sms', 'Toque 2 · dia 3', 830, 300, { texto: msgProp2 }),
      no('aguarda-2', 'controle.esperar_resposta', 'Aguarda · 2 dias', 1040, 300, { duracao: 2, unidade: 'dias' }),
      no('espera-3', 'controle.esperar', 'Espera · +2 dias', 1250, 300, { duracao: 2, unidade: 'dias' }),
      no('toque-3', 'acao.enviar_sms', 'Toque 3 · dia 7', 1450, 300, { texto: msgProp3 }),
      no('aguarda-3', 'controle.esperar_resposta', 'Aguarda · 3 dias', 1570, 300, { duracao: 3, unidade: 'dias' }),
      no('aviso-resp', 'acao.notificar_equipe', 'Equipe: lead respondeu', 830, 130, {
        telefone: '{{var.telefone_equipe}}',
        texto: '💬 {{contato.nome}} ({{contato.telefone}}) respondeu sobre a proposta: "{{mensagem.texto}}". Retoma o contato agora, enquanto tá quente!',
      }),
      no('fim-resp', 'controle.encerrar', 'Encerrar', 1050, 130, { motivo: 'lead respondeu ao follow-up' }),
      no('aviso-fim', 'acao.notificar_equipe', 'Equipe: 3 toques sem resposta', 1790, 300, {
        telefone: '{{var.telefone_equipe}}',
        texto: '📉 {{contato.nome}} ({{contato.telefone}}) não respondeu aos 3 toques de follow-up da proposta. Hora de ligar ou partir pra outra abordagem.',
      }),
      no('tarefa', 'acao.criar_tarefa', 'Tarefa: follow-up manual', 2010, 300, {
        titulo: 'Follow-up manual: proposta de {{contato.nome}}', prioridade: 'alta', emDias: 0,
      }),
      no('fim-frio', 'controle.encerrar', 'Encerrar', 2220, 300, { motivo: 'follow-up automático esgotado' }),
    ],
    arestas: [
      ar('e-1', 'gatilho', 'espera-1'),
      ar('e-2', 'espera-1', 'toque-1'),
      ar('e-3', 'toque-1', 'aguarda-1'),
      ar('e-4', 'aguarda-1', 'aviso-resp', 'resposta'),
      ar('e-5', 'aguarda-1', 'toque-2', 'timeout'),
      ar('e-6', 'toque-2', 'aguarda-2'),
      ar('e-7', 'aguarda-2', 'aviso-resp', 'resposta'),
      ar('e-8', 'aguarda-2', 'espera-3', 'timeout'),
      ar('e-9', 'espera-3', 'toque-3'),
      ar('e-10', 'toque-3', 'aguarda-3'),
      ar('e-11', 'aguarda-3', 'aviso-resp', 'resposta'),
      ar('e-12', 'aguarda-3', 'aviso-fim', 'timeout'),
      ar('e-13', 'aviso-resp', 'fim-resp'),
      ar('e-14', 'aviso-fim', 'tarefa'),
      ar('e-15', 'tarefa', 'fim-frio'),
    ],
    notas: [
      {
        id: 'nota-ritmo',
        texto: 'Ritmo 1d → 3d → 7d: perto o suficiente pra não esfriar, espaçado o suficiente pra não sufocar.',
        posicao: { x: 400, y: 140 },
        tom: 'neutro',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 5 · Pós-venda: pedido de avaliação Google
// ---------------------------------------------------------------------------
const avaliacaoPosVenda = {
  slug: 'avaliacao-pos-venda',
  name: 'Pós-venda: pedido de avaliação Google',
  description:
    'Cliente feliz raramente avalia sozinho. Este fluxo pede a avaliação no Google 2 horas depois do negócio ganho — ' +
    'o pico da satisfação — usando o link rastreável das Configurações de Avaliações.',
  category: 'reputacao',
  difficulty: 'facil',
  estimated_min: 2,
  tags: ['avaliação', 'google', 'pós-venda', 'reputação'],
  icon: 'star',
  requirements: ['stevo'],
  variables: [],
  workflow: {
    nos: [
      no('gatilho', 'gatilho.negocio_status', 'Negócio marcado como ganho', 0, 300, { status: 'ganho' }),
      no('espera', 'controle.esperar', 'Espera · 2h', 240, 300, { duracao: 2, unidade: 'horas' }),
      no('pedido', 'acao.pedir_avaliacao', 'Pedido de avaliação', 460, 300, {
        canal: 'whatsapp',
        mensagem:
          'Oi {{contato.primeiroNome}}! 💜 Ficamos muito felizes em te atender hoje. ' +
          'Topa avaliar sua experiência no Google? Leva menos de 1 minuto e ajuda demais a gente:',
      }),
      no('fim', 'controle.encerrar', 'Encerrar', 700, 300, { motivo: 'avaliação pedida' }),
    ],
    arestas: [
      ar('e-1', 'gatilho', 'espera'),
      ar('e-2', 'espera', 'pedido'),
      ar('e-3', 'pedido', 'fim'),
    ],
    notas: [
      {
        id: 'nota-link',
        texto: 'O link sai das Configurações > Avaliações. O clique e a nota ficam registrados no contato.',
        posicao: { x: 460, y: 140 },
        tom: 'neutro',
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// 6 · Revival de base fria (30+ dias)
// ---------------------------------------------------------------------------
const msgRevival =
  'Oi {{contato.primeiroNome}}! Faz um tempinho que a gente conversou por aqui 😊\n\n' +
  'Ainda faz sentido pra você aquela avaliação que a gente tinha conversado? ' +
  'Essa semana abriram horários novos — quer que eu reserve um pra você?';

const leadFrioRevival = {
  slug: 'lead-frio-revival',
  name: 'Revival de base fria (30+ dias)',
  description:
    'Lead que não fechou em 30 dias não é lead perdido — é base parada. Este fluxo reativa o contato 30 dias ' +
    'depois do cadastro, devolve quem responde pro funil com tag "revivido" e marca quem ficou mudo.',
  category: 'marketing',
  difficulty: 'media',
  estimated_min: 8,
  tags: ['revival', 'base fria', 'reativação', 'marketing'],
  icon: 'flame',
  requirements: ['stevo'],
  variables: [V_STAGE_LEAD, V_TEL],
  workflow: {
    nos: [
      no('gatilho', 'gatilho.data_contato', '30 dias após o cadastro', 0, 300, {
        campo: 'contato.criadoEm', quando: 'depois', dias: 30, hora: '10:00', anual: false,
      }),
      no('msg', 'acao.enviar_sms', 'Mensagem de reativação', 250, 300, { texto: msgRevival }),
      no('aguarda', 'controle.esperar_resposta', 'Aguarda · 2 dias', 490, 300, { duracao: 2, unidade: 'dias' }),
      no('tag-revivido', 'acao.adicionar_tag', "Tag 'revivido'", 710, 170, { tag: 'revivido' }),
      no('opp', 'acao.criar_oportunidade', 'Cria oportunidade', 910, 170, {
        titulo: '{{contato.nome}} · Revival', stageId: '{{var.stage_id}}', origem: 'Revival base fria',
      }),
      no('aviso', 'acao.notificar_equipe', 'Avisa a equipe', 1120, 170, {
        telefone: '{{var.telefone_equipe}}',
        texto: '🔥 Lead revivido: {{contato.nome}} ({{contato.telefone}}) respondeu à reativação: "{{mensagem.texto}}". Oportunidade criada no funil!',
      }),
      no('fim-ok', 'controle.encerrar', 'Encerrar', 1320, 170, { motivo: 'lead revivido e no funil' }),
      no('tag-mudo', 'acao.adicionar_tag', "Tag 'sem-retorno'", 710, 430, { tag: 'sem-retorno' }),
      no('fim-mudo', 'controle.encerrar', 'Encerrar', 910, 430, { motivo: 'sem retorno na reativação' }),
    ],
    arestas: [
      ar('e-1', 'gatilho', 'msg'),
      ar('e-2', 'msg', 'aguarda'),
      ar('e-3', 'aguarda', 'tag-revivido', 'resposta'),
      ar('e-4', 'tag-revivido', 'opp'),
      ar('e-5', 'opp', 'aviso'),
      ar('e-6', 'aviso', 'fim-ok'),
      ar('e-7', 'aguarda', 'tag-mudo', 'timeout'),
      ar('e-8', 'tag-mudo', 'fim-mudo'),
    ],
    notas: [
      {
        id: 'nota-uma-vez',
        texto: 'Dispara uma vez por contato, 30 dias após o cadastro, às 10h. A varredura é diária — cadastros novos entram sozinhos.',
        posicao: { x: 0, y: 140 },
        tom: 'neutro',
      },
    ],
  },
};

const TEMPLATES = [
  novoLeadQualificacao,
  lembreteD1,
  noShowRecuperacao,
  propostaFollowup,
  avaliacaoPosVenda,
  leadFrioRevival,
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
const CONFLITO = "(COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), slug)";

for (const t of TEMPLATES) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO automation_templates
       (tenant_id, slug, name, description, category, icon, difficulty, estimated_min,
        tags, author, is_official, is_published, requirements, workflow, variables)
     VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8::text[], 'Orvyn', true, true, $9::text[], $10::jsonb, $11::jsonb)
     ON CONFLICT ${CONFLITO} DO UPDATE SET
       name = EXCLUDED.name,
       description = EXCLUDED.description,
       category = EXCLUDED.category,
       icon = EXCLUDED.icon,
       difficulty = EXCLUDED.difficulty,
       estimated_min = EXCLUDED.estimated_min,
       tags = EXCLUDED.tags,
       is_official = EXCLUDED.is_official,
       is_published = EXCLUDED.is_published,
       requirements = EXCLUDED.requirements,
       workflow = EXCLUDED.workflow,
       variables = EXCLUDED.variables,
       updated_at = now()`,
    t.slug, t.name, t.description, t.category, t.icon, t.difficulty, t.estimated_min,
    t.tags, t.requirements, JSON.stringify(t.workflow), JSON.stringify(t.variables),
  );
  console.log(`✔ ${t.slug} (${t.workflow.nos.length} nós, ${t.workflow.arestas.length} arestas)`);
}

const total = await prisma.$queryRawUnsafe(
  "SELECT count(*)::int AS n FROM automation_templates WHERE tenant_id IS NULL AND is_official",
);
console.log(`\nTotal de templates oficiais globais: ${total[0].n}`);
await prisma.$disconnect();

// Seed do Marketplace: templates GLOBAIS (tenant_id NULL), publicados via
// superuser (bypassa RLS — mesma regra das bases globais do RAG). Idempotente.
// Cada `workflow` é um grafo real e publicável ({nos, arestas}) — nada fake.
//
//   node scripts/seed-marketplace.mjs
import { PrismaClient } from '@prisma/client';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';
const prisma = new PrismaClient({ datasources: { db: { url: ADMIN } } });

const pos = (x, y) => ({ x, y });

const TEMPLATES = [
  {
    slug: 'boas-vindas-novo-contato', name: 'Boas-vindas ao novo contato',
    description: 'Assim que um contato entra, espera 2 min, manda uma saudação no WhatsApp e marca como novo lead.',
    category: 'Entrada de Leads', icon: 'contacts', difficulty: 'facil', estimatedMin: 2,
    tags: ['boas-vindas', 'lead', 'whatsapp'], featured: true, requirements: ['stevo'],
    // Variáveis do template: ligadas aos dados do tenant ao instalar ({{var.chave}}).
    variables: [
      { chave: 'saudacao', label: 'Mensagem de boas-vindas', tipo: 'texto', obrigatorio: true, default: 'Olá {{contato.nome}}! Recebemos seu contato e já vamos te atender. 👋' },
      { chave: 'tag_lead', label: 'Tag para marcar o lead', tipo: 'tag', obrigatorio: true, default: 'novo-lead' },
    ],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.contato_criado', posicao: pos(0, 0), config: {} },
        { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 2, unidade: 'minutos' } },
        { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, 0), config: { texto: '{{var.saudacao}}' } },
        { id: 't', tipo: 'acao.adicionar_tag', posicao: pos(780, 0), config: { tag: '{{var.tag_lead}}' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 's' }, { id: 'e3', de: 's', para: 't' },
      ],
    },
  },
  {
    slug: 'follow-up-com-resposta', name: 'Follow-up inteligente (para quem não responde)',
    description: 'Manda a 1ª mensagem e espera a resposta. Quem responde é marcado como engajado; quem some recebe um lembrete.',
    category: 'Follow-up', icon: 'inbox', difficulty: 'medio', estimatedMin: 5,
    tags: ['follow-up', 'sdr', 'whatsapp'], featured: true, requirements: ['stevo'],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.contato_criado', posicao: pos(0, 0), config: {} },
        { id: 's1', tipo: 'acao.enviar_sms', posicao: pos(260, 0), config: { texto: 'Oi {{contato.nome}}, posso te ajudar com alguma coisa?' } },
        { id: 'er', tipo: 'controle.esperar_resposta', posicao: pos(520, 0), config: { duracao: 1, unidade: 'dias' } },
        { id: 't', tipo: 'acao.adicionar_tag', posicao: pos(800, -80), config: { tag: 'engajou' } },
        { id: 's2', tipo: 'acao.enviar_sms', posicao: pos(800, 90), config: { texto: '{{contato.nome}}, ainda por aí? Estou à disposição. 😊' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 's1' }, { id: 'e2', de: 's1', para: 'er' },
        { id: 'e3', de: 'er', para: 't', ramo: 'resposta' }, { id: 'e4', de: 'er', para: 's2', ramo: 'timeout' },
      ],
    },
  },
  {
    slug: 'ab-boas-vindas', name: 'Teste A/B da mensagem de boas-vindas',
    description: 'Divide os novos contatos em dois grupos e envia mensagens diferentes — para descobrir qual converte mais.',
    category: 'Marketing', icon: 'marketing', difficulty: 'medio', estimatedMin: 4,
    tags: ['a/b', 'teste', 'marketing'], requirements: ['stevo'],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.contato_criado', posicao: pos(0, 0), config: {} },
        { id: 'sp', tipo: 'controle.split', posicao: pos(260, 0), config: { ramos: [{ id: 'a', rotulo: 'Variante A', peso: 1 }, { id: 'b', rotulo: 'Variante B', peso: 1 }] } },
        { id: 's1', tipo: 'acao.enviar_sms', posicao: pos(540, -80), config: { texto: 'Oi {{contato.nome}}! Que bom te ver por aqui. 🚀' } },
        { id: 's2', tipo: 'acao.enviar_sms', posicao: pos(540, 90), config: { texto: 'Olá {{contato.nome}}, seja muito bem-vindo(a)! ✨' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 'sp' },
        { id: 'e2', de: 'sp', para: 's1', ramo: 'a' }, { id: 'e3', de: 'sp', para: 's2', ramo: 'b' },
      ],
    },
  },
  {
    slug: 'reativacao-perdido', name: 'Reativação de negócio perdido',
    description: 'Quando um negócio é marcado como perdido, espera 7 dias e envia um e-mail com uma condição especial.',
    category: 'Processo Comercial', icon: 'pipeline', difficulty: 'facil', estimatedMin: 3,
    tags: ['reativação', 'perdido', 'e-mail', 'pós-venda'], requirements: ['email'],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.negocio_status', posicao: pos(0, 0), config: { status: 'perdido' } },
        { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 7, unidade: 'dias' } },
        { id: 'e', tipo: 'acao.enviar_email', posicao: pos(520, 0), config: { assunto: 'Uma condição especial pra você, {{contato.nome}}', corpo: 'Olá {{contato.nome}},\n\nNotamos que não seguimos adiante da última vez. Preparamos uma condição especial — quer conversar de novo?' } },
        { id: 't', tipo: 'acao.adicionar_tag', posicao: pos(800, 0), config: { tag: 'reativacao' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 'e' }, { id: 'e3', de: 'e', para: 't' },
      ],
    },
  },
  {
    slug: 'qualificacao-ia', name: 'Qualificação de lead por IA',
    description: 'Quando o contato manda mensagem, a IA classifica se está quente ou frio e marca os quentes automaticamente.',
    category: 'IA', icon: 'sparkles', difficulty: 'avancado', estimatedMin: 6,
    tags: ['ia', 'score', 'qualificação'], isPremium: true, requirements: ['anthropic'],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.mensagem_recebida', posicao: pos(0, 0), config: { canal: 'WhatsApp' } },
        { id: 'ia', tipo: 'acao.ia', posicao: pos(260, 0), config: { tarefa: 'classificar', instrucao: "O contato está quente (pronto para comprar) ou frio? Responda só 'quente' ou 'frio'.", salvarEm: 'temperatura' } },
        { id: 'c', tipo: 'controle.condicao', posicao: pos(520, 0), config: { ramos: [{ id: 'quente', rotulo: 'Quente', juncao: 'AND', regras: [{ campo: 'variaveis.temperatura', operador: 'contem', valor: 'quente' }] }] } },
        { id: 't', tipo: 'acao.adicionar_tag', posicao: pos(800, 0), config: { tag: 'lead-quente' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 'ia' }, { id: 'e2', de: 'ia', para: 'c' },
        { id: 'e3', de: 'c', para: 't', ramo: 'quente' },
      ],
    },
  },
  {
    slug: 'disparo-em-lote-drip', name: 'Disparo em lote sem queimar o número',
    description: 'Para campanhas grandes: libera no máximo 50 mensagens por hora, para o WhatsApp não bloquear.',
    category: 'Marketing', icon: 'marketing', difficulty: 'medio', estimatedMin: 3,
    tags: ['drip', 'lote', 'campanha', 'whatsapp'], requirements: ['stevo'],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.tag_adicionada', posicao: pos(0, 0), config: { tag: 'campanha' } },
        { id: 'd', tipo: 'controle.drip', posicao: pos(260, 0), config: { porJanela: 50, janela: 'hora' } },
        { id: 's', tipo: 'acao.enviar_sms', posicao: pos(520, 0), config: { texto: '{{contato.nome}}, temos uma novidade pra você! Responda aqui para saber mais.' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 'd' }, { id: 'e2', de: 'd', para: 's' },
      ],
    },
  },
  // ---- Agenda (Q2.4 / RV-07.1 / RV-07.2) ----
  {
    slug: 'lembrete-agendamento-d1', name: 'Lembrete D-1 com confirmação',
    description: 'Na véspera do compromisso, manda um lembrete no WhatsApp. Se o contato responder "sim", "ok" ou 👍, a agenda confirma sozinha; se pedir para remarcar ou não responder, a equipe recebe uma tarefa.',
    category: 'Agenda', icon: 'calendar', difficulty: 'facil', estimatedMin: 3,
    tags: ['agenda', 'lembrete', 'confirmação', 'no-show', 'whatsapp'], featured: true, requirements: ['stevo'],
    variables: [
      { chave: 'mensagem', label: 'Mensagem do lembrete', tipo: 'texto', obrigatorio: true, default: 'Oi {{contato.primeiroNome}}! Passando para lembrar do seu horário: {{agendamento.titulo}}, {{agendamento.dataExtenso}} às {{agendamento.hora}}. Responda SIM para confirmar ou avise aqui se precisar remarcar.' },
    ],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.lembrete_agendamento', posicao: pos(0, 0), config: {} },
        { id: 's', tipo: 'acao.enviar_sms', posicao: pos(260, 0), config: { texto: '{{var.mensagem}}' } },
        { id: 'er', tipo: 'controle.esperar_resposta', posicao: pos(520, 0), config: { duracao: 12, unidade: 'horas' } },
        { id: 'c', tipo: 'controle.condicao', posicao: pos(800, -90), config: { ramos: [{ id: 'remarcar', rotulo: 'Quer remarcar', juncao: 'OR', regras: [
          { campo: 'mensagem.texto', operador: 'contem', valor: 'remarc' },
          { campo: 'mensagem.texto', operador: 'contem', valor: 'desmarc' },
          { campo: 'mensagem.texto', operador: 'contem', valor: 'cancel' },
          { campo: 'mensagem.texto', operador: 'contem', valor: 'não' },
          { campo: 'mensagem.texto', operador: 'contem', valor: 'nao' },
        ] }] } },
        { id: 'tr', tipo: 'acao.criar_tarefa', posicao: pos(1080, -90), config: { titulo: 'Remarcar {{agendamento.titulo}} com {{contato.nome}} ({{agendamento.data}} às {{agendamento.hora}})', prioridade: 'alta', emDias: 0 } },
        { id: 'tt', tipo: 'acao.criar_tarefa', posicao: pos(800, 100), config: { titulo: 'Confirmar por telefone: {{agendamento.titulo}} com {{contato.nome}} ({{agendamento.data}} às {{agendamento.hora}})', prioridade: 'media', emDias: 0 } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 's' }, { id: 'e2', de: 's', para: 'er' },
        { id: 'e3', de: 'er', para: 'c', ramo: 'resposta' }, { id: 'e4', de: 'er', para: 'tt', ramo: 'timeout' },
        { id: 'e5', de: 'c', para: 'tr', ramo: 'remarcar' },
      ],
    },
  },
  {
    slug: 'recuperacao-de-falta', name: 'Recuperação de falta (reagendar)',
    description: 'Quando o compromisso é marcado como falta, espera 30 min e convida o contato a remarcar. Quem responde vira tarefa de reagendamento; quem some recebe um segundo convite e a tag faltou-sem-retorno.',
    category: 'Agenda', icon: 'calendar', difficulty: 'facil', estimatedMin: 3,
    tags: ['agenda', 'falta', 'no-show', 'reagendar', 'recuperação', 'whatsapp'], featured: true, requirements: ['stevo'],
    variables: [
      { chave: 'convite', label: 'Mensagem de recuperação', tipo: 'texto', obrigatorio: true, default: 'Oi {{contato.primeiroNome}}, sentimos sua falta em {{agendamento.titulo}} hoje. Quer remarcar? Responda com o melhor dia e horário que a gente encaixa.' },
      { chave: 'segundo_convite', label: 'Segundo convite (se não responder)', tipo: 'texto', obrigatorio: true, default: '{{contato.primeiroNome}}, ainda dá para remarcar seu horário. É só responder esta mensagem. 😊' },
    ],
    workflow: {
      nos: [
        { id: 'g', tipo: 'gatilho.faltou', posicao: pos(0, 0), config: {} },
        { id: 'w', tipo: 'controle.esperar', posicao: pos(260, 0), config: { duracao: 30, unidade: 'minutos' } },
        { id: 't1', tipo: 'acao.adicionar_tag', posicao: pos(520, 0), config: { tag: 'faltou' } },
        { id: 's1', tipo: 'acao.enviar_sms', posicao: pos(780, 0), config: { texto: '{{var.convite}}' } },
        { id: 'er', tipo: 'controle.esperar_resposta', posicao: pos(1040, 0), config: { duracao: 2, unidade: 'dias' } },
        { id: 'tr', tipo: 'acao.criar_tarefa', posicao: pos(1320, -90), config: { titulo: 'Reagendar {{contato.nome}} (respondeu à recuperação de falta)', prioridade: 'alta', emDias: 0 } },
        { id: 's2', tipo: 'acao.enviar_sms', posicao: pos(1320, 100), config: { texto: '{{var.segundo_convite}}' } },
        { id: 't2', tipo: 'acao.adicionar_tag', posicao: pos(1580, 100), config: { tag: 'faltou-sem-retorno' } },
      ],
      arestas: [
        { id: 'e1', de: 'g', para: 'w' }, { id: 'e2', de: 'w', para: 't1' }, { id: 'e3', de: 't1', para: 's1' },
        { id: 'e4', de: 's1', para: 'er' },
        { id: 'e5', de: 'er', para: 'tr', ramo: 'resposta' }, { id: 'e6', de: 'er', para: 's2', ramo: 'timeout' },
        { id: 'e7', de: 's2', para: 't2' },
      ],
    },
  },
];

const dry = process.argv.includes('--dry-run');

async function main() {
  const slugs = TEMPLATES.map((t) => t.slug);
  if (dry) {
    console.log(`[dry-run] ${TEMPLATES.length} templates globais prontos:`);
    for (const t of TEMPLATES) console.log(`  · ${t.slug} (${t.category}) — ${t.workflow.nos.length} nós`);
    return;
  }
  // idempotente: remove os globais destes slugs e reinsere
  await prisma.$executeRawUnsafe(`DELETE FROM automation_templates WHERE tenant_id IS NULL AND slug = ANY($1)`, slugs);
  for (const t of TEMPLATES) {
    await prisma.automationTemplate.create({
      data: {
        tenantId: null, slug: t.slug, name: t.name, description: t.description,
        category: t.category, icon: t.icon ?? null, segment: t.segment ?? null,
        difficulty: t.difficulty ?? 'facil', estimatedMin: t.estimatedMin ?? null,
        tags: t.tags ?? [], author: 'KHUB', isOfficial: true, isPremium: !!t.isPremium,
        isPublished: true, featured: !!t.featured, requirements: t.requirements ?? [],
        workflow: t.workflow, variables: t.variables ?? [],
      },
    });
  }
  const total = await prisma.automationTemplate.count({ where: { tenantId: null } });
  console.log(`Seed OK — ${TEMPLATES.length} templates globais inseridos (${total} globais no total).`);
}

main().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => prisma.$disconnect());

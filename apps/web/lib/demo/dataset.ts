import type {
  Campanha,
  CardNegocio,
  Compromisso,
  EtapaPipeline,
  InsightIA,
  ItemTimeline,
  KpiLeads,
  Lead,
  Mensagem,
  Negocio,
  ResumoConversa,
  SerieTemporal,
  Tarefa,
} from '../revenue/types';

/**
 * DATASET DE DEMONSTRAÇÃO
 * =======================
 *
 * Reproduz os valores das referências visuais (R$ 284.500, 432 leads, 92% …).
 * Existe para que a interface possa ser avaliada com densidade realista.
 *
 * **Isto não é dado de produção e nunca deve ser lido sem `modoDemo()`.**
 * Nenhum módulo fora de `lib/demo/` importa este arquivo diretamente — o
 * acesso passa por `lib/revenue/source.ts`, que decide a fonte.
 *
 * As datas são geradas em relação a *agora*, não fixas: a vitrine não pode
 * envelhecer e passar a mostrar "última interação há 8 meses".
 */

/* ------------------------------------------------------------------ */
/* Helpers de tempo relativo                                           */
/* ------------------------------------------------------------------ */

const AGORA = () => new Date();

function haMinutos(n: number): string {
  const d = AGORA();
  d.setMinutes(d.getMinutes() - n);
  return d.toISOString();
}

function haDias(n: number): string {
  const d = AGORA();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function emDias(n: number, hora = 10, minuto = 0): string {
  const d = AGORA();
  d.setDate(d.getDate() + n);
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
}

function hojeAs(hora: number, minuto = 0): string {
  const d = AGORA();
  d.setHours(hora, minuto, 0, 0);
  return d.toISOString();
}

/* ------------------------------------------------------------------ */
/* Equipe                                                              */
/* ------------------------------------------------------------------ */

export const EQUIPE = {
  lucas: { id: 'u1', nome: 'Lucas Mendes' },
  mariana: { id: 'u2', nome: 'Mariana Silva' },
  pedro: { id: 'u3', nome: 'Pedro Almeida' },
  ana: { id: 'u4', nome: 'Ana Ribeiro' },
  carla: { id: 'u5', nome: 'Carla Souza' },
} as const;

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

export const DASHBOARD_KPIS = {
  leadsDoDia: { valor: 247, delta: 12, comparacao: 'vs. ontem' },
  taxaResposta: { valor: 62, delta: 8, comparacao: 'vs. semana passada' },
  followupsPendentes: { valor: 18, delta: 3, comparacao: 'vs. ontem' },
  receitaGerada: { valor: 284_500, delta: 28, comparacao: 'vs. mês passado' },
};

export const FUNIL_RESUMO = [
  { rotulo: 'Leads', valor: 432, cor: '#c4b5fd' },
  { rotulo: 'Qualificação', valor: 278, cor: '#a78bfa' },
  { rotulo: 'Proposta', valor: 156, cor: '#93c5fd' },
  { rotulo: 'Negociação', valor: 89, cor: '#fbbf24' },
  { rotulo: 'Fechamento', valor: 64, cor: '#34d399' },
];

export const VALOR_PIPELINE = 1_845_000;

/** Curva de receita dos últimos 30 dias — crescente, com ruído determinístico. */
export const RECEITA_30D: SerieTemporal[] = Array.from({ length: 30 }, (_, i) => {
  const base = 60_000 + i * 7_800;
  // Ruído por seno: variação sem `Math.random()`, então o gráfico não treme
  // entre renders nem muda a cada refresh.
  const ruido = Math.sin(i * 1.7) * 9_000 + Math.sin(i * 0.6) * 5_000;
  const d = AGORA();
  d.setDate(d.getDate() - (29 - i));
  return { rotulo: d.toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }), valor: Math.round(base + ruido) };
});

export const ATIVIDADE_RECENTE: ItemTimeline[] = [
  { id: 'a1', tipo: 'mensagem', canal: 'whatsapp', titulo: 'Novo lead de WhatsApp', descricao: 'Camila Rocha', quando: haMinutos(2) },
  { id: 'a2', tipo: 'email', canal: 'email', titulo: 'E-mail respondido', descricao: 'BRX Consultoria', quando: haMinutos(12) },
  { id: 'a3', tipo: 'lead_criado', titulo: 'Lead qualificado', descricao: 'João Pedro Lima', quando: haMinutos(28) },
  { id: 'a4', tipo: 'reuniao', titulo: 'Reunião agendada', descricao: 'Tech Solutions', quando: haMinutos(60) },
  { id: 'a5', tipo: 'etapa', titulo: 'Negócio movido para Negociação', descricao: 'R$ 42.000', quando: haMinutos(120) },
];

export const PROXIMAS_TAREFAS: Tarefa[] = [
  { id: 't1', titulo: 'Retornar para Mariana Silva', contexto: 'Lead quente · Responder proposta', quando: hojeAs(10, 0), concluida: false, urgente: true },
  { id: 't2', titulo: 'Reunião com Grupo Alvorada', contexto: 'Apresentação da solução', quando: hojeAs(11, 30), concluida: false },
  { id: 't3', titulo: 'Enviar follow-up para Pedro', contexto: 'Proposta enviada', quando: hojeAs(9, 0), concluida: true },
  { id: 't4', titulo: 'Ligar para novos leads (lista IA)', contexto: '10 contatos', quando: hojeAs(14, 0), concluida: false },
  { id: 't5', titulo: 'Revisar campanha de Abril', contexto: 'Performance e ajustes', quando: hojeAs(16, 0), concluida: false },
];

export const INSIGHTS_DASHBOARD: InsightIA[] = [
  {
    id: 'i1',
    titulo: 'Reduza o tempo de resposta',
    descricao: 'Leads que recebem resposta em até 5 minutos têm 3,2x mais chance de conversão.',
  },
  {
    id: 'i2',
    titulo: 'Reative 42 leads parados',
    descricao: 'Leads da etapa de Proposta estão há mais de 7 dias sem interação. Envie um follow-up automático.',
  },
  {
    id: 'i3',
    titulo: 'Aposte no WhatsApp',
    descricao: 'Sua taxa de conversão via WhatsApp é 47% maior que por e-mail. Considere priorizar este canal nas próximas campanhas.',
  },
];

/* ------------------------------------------------------------------ */
/* Leads                                                               */
/* ------------------------------------------------------------------ */

export const KPIS_LEADS: KpiLeads = {
  novos: { valor: 432, delta: 12 },
  qualificados: { valor: 278, delta: 18 },
  semResposta: { valor: 156, delta: 8 },
  quentes: { valor: 89, delta: 34 },
};

export const LEADS: Lead[] = [
  {
    id: 'l1',
    nome: 'Camila Rocha',
    cargo: 'CEO',
    empresa: 'Tech Solutions',
    email: 'camila@techsolutions.com.br',
    telefone: '+5511987654321',
    localizacao: 'São Paulo, SP',
    linkedin: 'linkedin.com/in/camilarocha',
    origem: 'whatsapp',
    status: 'quente',
    score: 92,
    scoreVersao: 'v0_rules',
    faixa: 'quente',
    responsavel: EQUIPE.lucas,
    tags: ['SaaS', 'Alta receita', 'Decisor'],
    ultimaInteracaoAt: haMinutos(2),
    proximaAcao: { rotulo: 'Responder no WhatsApp', quando: hojeAs(10, 0), tipo: 'responder' },
    criadoEm: haDias(2),
  },
  {
    id: 'l2',
    nome: 'Rafael Lima',
    cargo: 'Head de Growth',
    empresa: 'Nova Mídia',
    email: 'rafael@novamidia.com.br',
    telefone: '+5511976543210',
    origem: 'linkedin',
    status: 'qualificado',
    score: 78,
    scoreVersao: 'v0_rules',
    faixa: 'quente',
    responsavel: EQUIPE.mariana,
    tags: ['Mídia'],
    ultimaInteracaoAt: haMinutos(12),
    proximaAcao: { rotulo: 'Abrir lead', quando: null, tipo: 'abrir' },
    criadoEm: haDias(5),
  },
  {
    id: 'l3',
    nome: 'Juliana Alves',
    cargo: 'Sócia',
    empresa: 'Alfa Consultoria',
    email: 'juliana@alfaconsultoria.com.br',
    origem: 'forms',
    status: 'em_analise',
    score: 65,
    scoreVersao: 'v0_rules',
    faixa: 'morno',
    responsavel: EQUIPE.pedro,
    tags: ['Consultoria'],
    ultimaInteracaoAt: haMinutos(60),
    proximaAcao: { rotulo: 'Responder', quando: null, tipo: 'responder' },
    criadoEm: haDias(7),
  },
  {
    id: 'l4',
    nome: 'Bruno Castro',
    cargo: 'Diretor',
    empresa: 'Castro & Dias',
    email: 'bruno@castrodias.adv.br',
    origem: 'indicacao',
    status: 'quente',
    score: 88,
    scoreVersao: 'v0_rules',
    faixa: 'quente',
    responsavel: EQUIPE.lucas,
    tags: ['Jurídico', 'Indicação'],
    ultimaInteracaoAt: haMinutos(120),
    proximaAcao: { rotulo: 'Abrir lead', quando: null, tipo: 'abrir' },
    criadoEm: haDias(3),
  },
  {
    id: 'l5',
    nome: 'Patrícia Souza',
    cargo: 'Gerente de Marketing',
    empresa: 'Vita Saúde',
    origem: 'instagram',
    status: 'novo',
    score: 56,
    scoreVersao: 'v0_rules',
    faixa: 'morno',
    responsavel: EQUIPE.ana,
    tags: ['Saúde'],
    ultimaInteracaoAt: haMinutos(180),
    proximaAcao: { rotulo: 'Responder', quando: null, tipo: 'responder' },
    criadoEm: haDias(1),
  },
  {
    id: 'l6',
    nome: 'Fernando Mendes',
    cargo: 'CTO',
    empresa: 'Mendes Tech',
    origem: 'site',
    status: 'qualificado',
    score: 73,
    scoreVersao: 'v0_rules',
    faixa: 'morno',
    responsavel: EQUIPE.mariana,
    tags: ['Tecnologia'],
    ultimaInteracaoAt: haMinutos(300),
    proximaAcao: { rotulo: 'Abrir lead', quando: null, tipo: 'abrir' },
    criadoEm: haDias(9),
  },
  {
    id: 'l7',
    nome: 'Larissa Monteiro',
    cargo: 'Sócia-diretora',
    empresa: 'Monteiro Advogados',
    origem: 'google',
    status: 'qualificado',
    score: 81,
    scoreVersao: 'v0_rules',
    faixa: 'quente',
    responsavel: EQUIPE.pedro,
    tags: ['Jurídico'],
    ultimaInteracaoAt: haMinutos(480),
    proximaAcao: { rotulo: 'Responder', quando: null, tipo: 'responder' },
    criadoEm: haDias(11),
  },
  {
    id: 'l8',
    nome: 'Thiago Almeida',
    cargo: 'Head Comercial',
    empresa: 'Almeida Group',
    origem: 'linkedin',
    status: 'sem_resposta',
    score: 47,
    scoreVersao: 'v0_rules',
    faixa: 'morno',
    responsavel: EQUIPE.lucas,
    tags: [],
    ultimaInteracaoAt: haDias(1),
    proximaAcao: { rotulo: 'Reengajar', quando: null, tipo: 'reengajar' },
    criadoEm: haDias(14),
  },
  {
    id: 'l9',
    nome: 'Beatriz Nascimento',
    cargo: 'Diretora de Marketing',
    empresa: 'Bloom Marketing',
    origem: 'parceria',
    status: 'em_analise',
    score: 69,
    scoreVersao: 'v0_rules',
    faixa: 'morno',
    responsavel: EQUIPE.ana,
    tags: ['Marketing'],
    ultimaInteracaoAt: haDias(1),
    proximaAcao: { rotulo: 'Abrir lead', quando: null, tipo: 'abrir' },
    criadoEm: haDias(16),
  },
  {
    id: 'l10',
    nome: 'Gustavo Ferreira',
    cargo: 'Fundador',
    empresa: 'FZ Tecnologia',
    origem: 'whatsapp',
    status: 'quente',
    score: 91,
    scoreVersao: 'v0_rules',
    faixa: 'quente',
    responsavel: EQUIPE.mariana,
    tags: ['Tecnologia', 'Decisor'],
    ultimaInteracaoAt: haDias(2),
    proximaAcao: { rotulo: 'Responder', quando: null, tipo: 'responder' },
    criadoEm: haDias(4),
  },
];

/** Total exibido na paginação — maior que a amostra, como numa base real. */
export const TOTAL_LEADS = 1245;

/* ------------------------------------------------------------------ */
/* Perfil de lead (João Pedro Lima — tela de referência)               */
/* ------------------------------------------------------------------ */

export const LEAD_PERFIL: Lead = {
  id: 'l-joao',
  nome: 'João Pedro Lima',
  cargo: 'Diretor de Marketing',
  empresa: 'BRX Consultoria',
  email: 'joao.lima@brxconsultoria.com',
  telefone: '+5511987654321',
  localizacao: 'São Paulo, SP',
  site: 'www.brxconsultoria.com',
  linkedin: 'linkedin.com/in/joaopedrolima',
  origem: 'site',
  status: 'quente',
  score: 92,
  scoreVersao: 'v0_rules',
  faixa: 'quente',
  responsavel: EQUIPE.lucas,
  tags: ['Lead Quente', 'Tomador de decisão', 'Interesse em IA'],
  ultimaInteracaoAt: hojeAs(10, 24),
  criadoEm: haDias(160),
  segmento: 'Consultoria e Serviços',
  tamanhoEmpresa: '51 – 200 funcionários',
  primeiroContatoEm: haDias(160),
  notas: 'Muito interessado em automação e IA. Busca resultado ainda neste trimestre.',
};

export const LEAD_TIMELINE: ItemTimeline[] = [
  {
    id: 'tl1',
    tipo: 'mensagem',
    canal: 'whatsapp',
    titulo: 'Mensagem recebida via WhatsApp',
    descricao: '"Lucas, podemos agendar uma call para esta semana?"',
    quando: hojeAs(10, 24),
    link: { rotulo: 'Ver conversa', href: '/conversas' },
  },
  {
    id: 'tl2',
    tipo: 'reuniao',
    titulo: 'Reunião realizada',
    descricao: 'Demo do produto com o time de marketing.',
    quando: haDias(1),
  },
  {
    id: 'tl3',
    tipo: 'email',
    canal: 'email',
    titulo: 'E-mail enviado',
    descricao: 'Apresentação da proposta comercial',
    quando: haDias(4),
    link: { rotulo: 'Ver e-mail', href: '#' },
  },
  {
    id: 'tl4',
    tipo: 'campanha',
    titulo: 'Clicou no link da campanha',
    descricao: 'Campanha: Automação com IA',
    quando: haDias(7),
    link: { rotulo: 'Ver campanha', href: '/campanhas' },
  },
  {
    id: 'tl5',
    tipo: 'visita',
    titulo: 'Visitou a página de preços',
    descricao: '3 visualizações · 4 min no site',
    quando: haDias(10),
  },
  {
    id: 'tl6',
    tipo: 'lead_criado',
    titulo: 'Novo lead criado',
    descricao: 'Origem: Landing Page · Receita com IA',
    quando: haDias(20),
  },
];

export const LEAD_NEGOCIOS: Negocio[] = [
  {
    id: 'n1',
    titulo: 'Implementação KHUB',
    valor: 284_500,
    etapa: 'Negociação',
    etapaIndice: 2,
    etapas: ['Qualificação', 'Proposta', 'Negociação', 'Fechamento'],
    previsaoFechamento: emDias(30),
    empresa: 'BRX Consultoria',
    responsavel: EQUIPE.lucas,
  },
];

export const LEAD_TAREFAS: Tarefa[] = [
  { id: 'lt1', titulo: 'Enviar proposta revisada', quando: hojeAs(14, 0), concluida: false, urgente: true, responsavel: EQUIPE.lucas },
  { id: 'lt2', titulo: 'Agendar call com time técnico', quando: emDias(1, 10), concluida: false, responsavel: EQUIPE.lucas },
  { id: 'lt3', titulo: 'Follow-up sobre a proposta', quando: emDias(12), concluida: false, responsavel: EQUIPE.mariana },
];

export const LEAD_NOTAS = [
  {
    id: 'no1',
    autor: 'Lucas Mendes',
    quando: hojeAs(10, 30),
    corpo:
      'Lead bastante engajado. Demonstrou dor clara com processos manuais e quer uma solução ainda no Q2. Agendar reunião com time técnico para próxima semana.',
    destaque: true,
  },
  {
    id: 'no2',
    autor: 'Mariana Silva',
    quando: haDias(4),
    corpo:
      'Gostou da proposta inicial. Solicitou alguns ajustes no escopo e quer incluir o time de operações na próxima conversa.',
    destaque: false,
  },
];

export const LEAD_ATRIBUICAO = {
  origemDoLead: 'Landing Page · Receita com IA',
  campanha: 'Automação com IA',
  midia: 'Google Ads',
  primeiroToque: haDias(160),
};

export const LEAD_INSIGHTS = {
  titulo: 'Alta chance de conversão',
  descricao:
    'Este lead demonstra forte intenção de compra, com múltiplos sinais de engajamento e fit com o ICP.',
  sinais: [
    'Interagiu com conteúdos estratégicos (preços, cases)',
    'Responde rapidamente às comunicações',
    'Ocupa cargo de decisão',
    'Empresa em fase de crescimento',
  ],
  score: 92,
};

/* ------------------------------------------------------------------ */
/* Pipeline                                                            */
/* ------------------------------------------------------------------ */

function card(
  id: string,
  empresa: string,
  titulo: string,
  valor: number,
  tags: string[],
  responsavel: { id: string; nome: string },
  dias: number,
): CardNegocio {
  return { id, empresa, titulo, valor, tags, responsavel, atualizadoEm: haDias(dias) };
}

export const PIPELINE_KPIS = {
  valorPipeline: { valor: 1_845_000, delta: 24 },
  taxaConversao: { valor: 18, delta: 6 },
  ticketMedio: { valor: 92_250, delta: 12 },
  cicloMedio: { valor: 32, delta: -18 },
};

export const PIPELINE_ETAPAS: EtapaPipeline[] = [
  {
    id: 'e1',
    nome: 'Entrada',
    cor: '#a78bfa',
    totalLeads: 432,
    valor: 320_000,
    negocios: [
      card('d1', 'TechNova', 'Implementação CRM', 25_000, ['Inbound', 'MQL'], EQUIPE.lucas, 2),
      card('d2', 'Bella Moda', 'Expansão de canais', 18_000, ['Site', 'Varejo'], EQUIPE.mariana, 4),
      card('d3', 'Clin Saúde', 'Solução de IA', 32_000, ['Indicação', 'Saúde'], EQUIPE.pedro, 5),
    ],
  },
  {
    id: 'e2',
    nome: 'Qualificação',
    cor: '#60a5fa',
    totalLeads: 278,
    valor: 420_000,
    negocios: [
      card('d4', 'Alpha Educação', 'Plataforma LMS', 48_000, ['Educação', 'B2B'], EQUIPE.mariana, 1),
      card('d5', 'Solaris Energia', 'Automação comercial', 75_000, ['Outbound', 'Enterprise'], EQUIPE.lucas, 2),
      card('d6', 'Grupo Vitale', 'Integração de sistemas', 28_000, ['B2B', 'Tecnologia'], EQUIPE.carla, 3),
    ],
  },
  {
    id: 'e3',
    nome: 'Reunião',
    cor: '#fbbf24',
    totalLeads: 156,
    valor: 350_000,
    negocios: [
      card('d7', 'MoveLog', 'Otimização logística', 62_000, ['Logística', 'B2B'], EQUIPE.pedro, 0),
      card('d8', 'GreenFoods', 'Plataforma de trade', 45_000, ['Alimentos', 'Expansão'], EQUIPE.pedro, 1),
      card('d9', 'Instituto Horizonte', 'Gestão de matrículas', 38_000, ['Educação', 'B2B'], EQUIPE.mariana, 1),
    ],
  },
  {
    id: 'e4',
    nome: 'Proposta',
    cor: '#fb923c',
    totalLeads: 89,
    valor: 280_000,
    negocios: [
      card('d10', 'Neon Bank', 'Solução de onboarding', 85_000, ['Financeiro', 'Enterprise'], EQUIPE.lucas, 2),
      card('d11', 'Casa & Estilo', 'E-commerce B2B', 52_000, ['Varejo', 'Expansão'], EQUIPE.carla, 3),
      card('d12', 'AgroReal', 'Plataforma de produtores', 43_000, ['Agro', 'B2B'], EQUIPE.pedro, 4),
    ],
  },
  {
    id: 'e5',
    nome: 'Negociação',
    cor: '#34d399',
    totalLeads: 64,
    valor: 310_000,
    negocios: [
      card('d13', 'FlexPay', 'Condição comercial', 120_000, ['Financeiro', 'High Ticket'], EQUIPE.lucas, 1),
      card('d14', 'Vitta Saúde', 'Expansão nacional', 68_000, ['Saúde', 'Enterprise'], EQUIPE.mariana, 2),
      card('d15', 'LogiPro', 'Fechamento anual', 45_000, ['Logística', 'Renovação'], EQUIPE.pedro, 3),
    ],
  },
  {
    id: 'e6',
    nome: 'Fechamento',
    cor: '#10b981',
    totalLeads: 64,
    valor: 184_500,
    negocios: [
      card('d16', 'SmartFit', 'Renovação contrato', 90_000, ['Fitness', 'Renovação'], EQUIPE.lucas, 0),
      card('d17', 'Delta Seguros', 'Nova unidade', 54_500, ['Seguros', 'B2B'], EQUIPE.carla, 1),
      card('d18', 'HubSoft', 'Implementação', 40_000, ['Tecnologia', 'Upsell'], EQUIPE.mariana, 2),
    ],
  },
];

export const NEGOCIO_DETALHE: Negocio = {
  id: 'd8',
  titulo: 'Plataforma de trade marketing',
  valor: 45_000,
  etapa: 'Reunião',
  etapaIndice: 2,
  etapas: ['Entrada', 'Qualificação', 'Reunião', 'Proposta', 'Negociação', 'Fechamento'],
  previsaoFechamento: emDias(25),
  empresa: 'GreenFoods Alimentos',
  contatoPrincipal: { nome: 'Fernanda Oliveira', cargo: 'Head de Marketing' },
  responsavel: EQUIPE.pedro,
  origem: 'Indicação',
  tags: ['Alimentos', 'Expansão'],
  observacoes:
    'Interessados em expandir para a região Sul. Valor pode aumentar com módulo adicional de analytics.',
};

export const NEGOCIO_PROXIMOS_PASSOS: Tarefa[] = [
  { id: 'np1', titulo: 'Enviar proposta comercial', quando: hojeAs(14, 0), concluida: false },
  { id: 'np2', titulo: 'Reunião técnica com time de TI', quando: emDias(3, 10), concluida: false },
  { id: 'np3', titulo: 'Aguardando retorno da Fernanda', quando: emDias(5, 9), concluida: false },
  { id: 'np4', titulo: 'Revisar termos e contrato', quando: emDias(7, 11), concluida: false },
];

/* ------------------------------------------------------------------ */
/* Conversas                                                           */
/* ------------------------------------------------------------------ */

export const CONVERSAS: ResumoConversa[] = [
  {
    id: 'c1',
    nome: 'Mariana Silva',
    empresa: 'Tech Solutions',
    canal: 'whatsapp',
    previa: 'Olá, gostaria de saber mais sobre...',
    quando: hojeAs(10, 24),
    naoLidas: 2,
    status: 'nao_lida',
    etiquetas: ['Qualificado'],
  },
  {
    id: 'c2',
    nome: 'Carlos Eduardo',
    empresa: 'Agência Pixels',
    canal: 'email',
    previa: 'Vocês emitem nota fiscal?',
    quando: hojeAs(9, 18),
    naoLidas: 1,
    status: 'nao_lida',
    etiquetas: ['Sem resposta'],
  },
  {
    id: 'c3',
    nome: 'Juliana Costa',
    empresa: 'Costa Marketing',
    canal: 'instagram',
    previa: 'Temos interesse no plano Pro.',
    quando: haDias(1),
    naoLidas: 1,
    status: 'em_atendimento',
    etiquetas: ['Em atendimento'],
  },
  {
    id: 'c4',
    nome: 'Ricardo Almeida',
    empresa: 'Almeida Consultoria',
    canal: 'whatsapp',
    previa: 'Perfeito, obrigado!',
    quando: haDias(1),
    naoLidas: 0,
    status: 'resolvida',
    etiquetas: ['Cliente'],
  },
  {
    id: 'c5',
    nome: 'Fernanda Lima',
    empresa: 'Lima Negócios',
    canal: 'site',
    previa: 'Vocês têm integração com CRM?',
    quando: haDias(3),
    naoLidas: 0,
    status: 'aguardando',
    etiquetas: ['Follow-up'],
  },
  {
    id: 'c6',
    nome: 'Bruno Martins',
    empresa: 'Martins & Cia',
    canal: 'email',
    previa: 'Pode me enviar uma proposta?',
    quando: haDias(3),
    naoLidas: 0,
    status: 'em_atendimento',
    etiquetas: ['Proposta'],
  },
  {
    id: 'c7',
    nome: 'Camila Rocha',
    empresa: 'Rocha Design',
    canal: 'whatsapp',
    previa: 'Qual o prazo de implementação?',
    quando: haDias(4),
    naoLidas: 0,
    status: 'aguardando',
    etiquetas: ['Sem resposta'],
  },
];

export const CONTAGEM_CANAIS = { whatsapp: 6, instagram: 2, email: 3, site: 1 };

export const MENSAGENS: Mensagem[] = [
  {
    id: 'm1',
    de: 'lead',
    texto: 'Olá! 👋\nVi o KHUB no LinkedIn e achei muito interessante. Gostaria de saber mais sobre os planos e como funciona a implementação.',
    quando: hojeAs(10, 2),
  },
  {
    id: 'm2',
    de: 'equipe',
    autor: 'Lucas Mendes',
    texto:
      'Olá, Mariana! Tudo bem?\n\nFico feliz pelo seu interesse no KHUB! 🚀 Posso te enviar uma apresentação rápida com os planos e mostrar como ajudamos empresas como a Tech Solutions a aumentarem suas receitas?',
    quando: hojeAs(10, 4),
    lida: true,
  },
  {
    id: 'm3',
    de: 'lead',
    texto: 'Perfeito! Seria ótimo.\n\nVocês também fazem integração com nosso CRM (HubSpot)?',
    quando: hojeAs(10, 5),
  },
];

export const SUGESTOES_IA_CONVERSA = [
  { id: 's1', titulo: 'Responder com apresentação', descricao: 'Enviar o material institucional do KHUB' },
  { id: 's2', titulo: 'Destacar cases do setor', descricao: 'Mostrar cases de empresas SaaS e tecnologia' },
  { id: 's3', titulo: 'Agendar uma reunião', descricao: 'Sugerir um horário na agenda do time de vendas' },
];

/* ------------------------------------------------------------------ */
/* Campanhas                                                           */
/* ------------------------------------------------------------------ */

export const CAMPANHAS_KPIS = {
  envios: { valor: 12_430, delta: 18 },
  respostas: { valor: 1_842, delta: 24 },
  reunioes: { valor: 287, delta: 32 },
  conversao: { valor: 2.3, delta: 0.8 },
};

export const CAMPANHAS: Campanha[] = [
  {
    id: 'cp1',
    nome: 'Outbound Tech Brasil',
    subtitulo: 'Prospecção SDR - Q2',
    status: 'ativa',
    canais: ['email', 'whatsapp', 'linkedin'],
    publico: { rotulo: 'Startups B2B', detalhe: '50-200 funcionários' },
    envios: 3420,
    respostas: 612,
    reunioes: 98,
    conversao: 2.9,
    descricao:
      'Campanha multicanal para atrair startups de tecnologia no Brasil, com foco em decisores de produto e crescimento.',
    sequencia: [
      { ordem: 1, canal: 'email', titulo: 'E-mail 1 · Apresentação', descricao: 'Apresenta o valor do KHUB em 3 linhas.', dia: 1 },
      { ordem: 2, canal: 'whatsapp', titulo: 'WhatsApp 1 · Contexto', descricao: 'Mensagem breve e personalizada.', dia: 3 },
      { ordem: 3, canal: 'email', titulo: 'Follow-up 2 · Case', descricao: 'Compartilha case relevante do setor.', dia: 7 },
      { ordem: 4, canal: 'linkedin', titulo: 'LinkedIn · Conexão', descricao: 'Solicita conexão com mensagem curta.', dia: 10 },
      { ordem: 5, canal: 'email', titulo: 'Follow-up 3 · Última tentativa', descricao: 'Reforça proposta e sugere reunião.', dia: 14 },
    ],
  },
  {
    id: 'cp2',
    nome: 'Follow-up Oportunidades',
    subtitulo: 'Reengajamento de leads',
    status: 'ativa',
    canais: ['email', 'whatsapp'],
    publico: { rotulo: 'Leads não convertidos', detalhe: 'últimos 90 dias' },
    envios: 2180,
    respostas: 401,
    reunioes: 76,
    conversao: 3.5,
    sequencia: [
      { ordem: 1, canal: 'email', titulo: 'Retomada de contato', descricao: 'Relembra a conversa anterior.', dia: 1 },
      { ordem: 2, canal: 'whatsapp', titulo: 'Oferta de call rápida', descricao: 'Propõe 15 minutos de conversa.', dia: 4 },
    ],
  },
  {
    id: 'cp3',
    nome: 'Expansão Base Atual',
    subtitulo: 'Cross-sell e upsell',
    status: 'pausada',
    canais: ['email', 'linkedin'],
    publico: { rotulo: 'Clientes ativos', detalhe: 'Conta expandida' },
    envios: 1245,
    respostas: 210,
    reunioes: 32,
    conversao: 2.6,
    sequencia: [
      { ordem: 1, canal: 'email', titulo: 'Novidades do produto', descricao: 'Apresenta módulos ainda não contratados.', dia: 1 },
    ],
  },
  {
    id: 'cp4',
    nome: 'Evento SaaS Summit',
    subtitulo: 'Pós-evento',
    status: 'ativa',
    canais: ['email', 'whatsapp', 'linkedin'],
    publico: { rotulo: 'Participantes do evento', detalhe: 'Mar 2024' },
    envios: 2890,
    respostas: 520,
    reunioes: 81,
    conversao: 2.8,
    sequencia: [
      { ordem: 1, canal: 'email', titulo: 'Obrigado pela visita', descricao: 'Agradece o contato no estande.', dia: 1 },
      { ordem: 2, canal: 'linkedin', titulo: 'Conexão pós-evento', descricao: 'Mantém o relacionamento aquecido.', dia: 3 },
    ],
  },
  {
    id: 'cp5',
    nome: 'Parcerias Estratégicas',
    subtitulo: 'Canais e revendas',
    status: 'rascunho',
    canais: ['email', 'linkedin'],
    publico: { rotulo: 'Empresas de tecnologia', detalhe: '> 500 funcionários' },
    envios: null,
    respostas: null,
    reunioes: null,
    conversao: null,
    sequencia: [],
  },
  {
    id: 'cp6',
    nome: 'Reativação 6 meses',
    subtitulo: 'Leads inativos',
    status: 'ativa',
    canais: ['whatsapp'],
    publico: { rotulo: 'Leads sem contato', detalhe: '+180 dias' },
    envios: 1695,
    respostas: 99,
    reunioes: 18,
    conversao: 1.1,
    sequencia: [
      { ordem: 1, canal: 'whatsapp', titulo: 'Ainda faz sentido?', descricao: 'Pergunta direta de reengajamento.', dia: 1 },
    ],
  },
];

export const INSIGHTS_CAMPANHA: InsightIA[] = [
  { id: 'ic1', titulo: 'A taxa de resposta está 24% acima da sua média', descricao: 'Continue com essa abordagem nos próximos envios.' },
  { id: 'ic2', titulo: 'Leads do segmento Fintech respondem 2x mais', descricao: 'Considere criar uma campanha específica para este perfil.' },
  { id: 'ic3', titulo: 'O melhor horário de resposta é entre 10h e 12h', descricao: 'Baseado em dados dos últimos 30 dias.' },
  { id: 'ic4', titulo: 'Sugestão da IA', descricao: 'Adicione um case de cliente no 2º follow-up para aumentar em até 35% as respostas.' },
];

/* ------------------------------------------------------------------ */
/* Agenda                                                              */
/* ------------------------------------------------------------------ */

export const COMPROMISSOS: Compromisso[] = [
  { id: 'ag1', titulo: 'Revisão do funil', tipo: 'interno', inicio: hojeAs(8, 0), fim: hojeAs(8, 30) },
  { id: 'ag2', titulo: 'Call inicial', subtitulo: 'Tech Solutions', tipo: 'call', inicio: hojeAs(9, 0), fim: hojeAs(9, 30) },
  {
    id: 'ag3',
    titulo: 'Demo NovaCorp',
    subtitulo: 'Reunião com cliente',
    tipo: 'demo',
    inicio: hojeAs(9, 0),
    fim: hojeAs(10, 0),
    local: { tipo: 'meet', valor: 'meet.google.com/khub-novacorp' },
    participantes: [
      { nome: 'Lucas Mendes', empresa: 'KHUB', papel: 'Host' },
      { nome: 'Mariana Silva', empresa: 'KHUB' },
      { nome: 'Carlos Ferreira', empresa: 'NovaCorp' },
      { nome: 'Juliana Costa', empresa: 'NovaCorp' },
    ],
    descricao: 'Apresentar a solução KHUB, entender os principais desafios e próximos passos.',
    tags: ['Demo', 'Qualificação', 'Alta prioridade'],
  },
  { id: 'ag4', titulo: 'Follow-up Ricardo Lima', tipo: 'followup', inicio: hojeAs(10, 30), fim: hojeAs(11, 0) },
  { id: 'ag5', titulo: 'Reunião de time', tipo: 'interno', inicio: hojeAs(11, 0), fim: hojeAs(12, 0) },
  { id: 'ag6', titulo: 'Almoço', tipo: 'pessoal', inicio: hojeAs(13, 0), fim: hojeAs(14, 0) },
  { id: 'ag7', titulo: 'Demo Grupo Alvorada', tipo: 'demo', inicio: hojeAs(14, 0), fim: hojeAs(15, 0) },
  { id: 'ag8', titulo: 'Call de negociação', tipo: 'call', inicio: hojeAs(15, 30), fim: hojeAs(16, 0) },
  { id: 'ag9', titulo: 'Revisar proposta', tipo: 'tarefa', inicio: hojeAs(16, 0), fim: hojeAs(17, 0) },
  { id: 'ag10', titulo: 'Follow-up leads', tipo: 'followup', inicio: hojeAs(17, 30), fim: hojeAs(18, 0) },
  { id: 'ag11', titulo: 'Planejamento Q2', tipo: 'interno', inicio: emDias(2, 9), fim: emDias(2, 10) },
  { id: 'ag12', titulo: 'Alinhamento com Marketing', tipo: 'interno', inicio: emDias(1, 11), fim: emDias(1, 11, 30) },
  { id: 'ag13', titulo: 'Apresentação Delta Sistemas', tipo: 'reuniao', inicio: emDias(3, 15), fim: emDias(3, 16) },
];

export const TAREFAS_AGENDA: Tarefa[] = [
  { id: 'ta1', titulo: 'Retornar proposta da Tech Solutions', quando: hojeAs(10, 0), concluida: false },
  { id: 'ta2', titulo: 'Preparar demo para a NovaCorp', quando: hojeAs(11, 30), concluida: false },
  { id: 'ta3', titulo: 'Enviar follow-up para Ricardo Lima', quando: hojeAs(14, 0), concluida: false },
  { id: 'ta4', titulo: 'Revisar apresentação com o time', quando: hojeAs(16, 0), concluida: true },
  { id: 'ta5', titulo: 'Atualizar CRM dos leads da semana', quando: hojeAs(17, 0), concluida: false },
];

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

export const ANALYTICS_KPIS = {
  receita: { valor: 284_500, delta: 28 },
  cac: { valor: 42, delta: -18 },
  conversao: { valor: 62, delta: 8 },
  tempoResposta: { valor: 2, delta: -35 },
  roi: { valor: 4.8, delta: 22 },
  comparecimento: { valor: 78, delta: 12 },
};

export const RECEITA_POR_CANAL = [
  { rotulo: 'WhatsApp', valor: 125_400, canal: 'whatsapp' as const },
  { rotulo: 'E-mail', valor: 68_200, canal: 'email' as const },
  { rotulo: 'Instagram', valor: 42_300, canal: 'instagram' as const },
  { rotulo: 'Website', valor: 28_600, canal: 'site' as const },
  { rotulo: 'Indicação', valor: 19_800, canal: 'indicacao' as const },
];

export const FUNIL_CONVERSAO = [
  { rotulo: 'Leads gerados', valor: 432, pct: 100 },
  { rotulo: 'Qualificados', valor: 278, pct: 64 },
  { rotulo: 'Proposta enviada', valor: 156, pct: 36 },
  { rotulo: 'Negociação', valor: 89, pct: 21 },
  { rotulo: 'Fechamentos', valor: 64, pct: 15 },
];

export const TEMPO_RESPOSTA_EQUIPE = [
  { nome: 'Comercial', minutos: 1 },
  { nome: 'Suporte', minutos: 3 },
  { nome: 'Pré-vendas', minutos: 4 },
  { nome: 'Sucesso do Cliente', minutos: 6 },
  { nome: 'Diretoria', minutos: 12 },
];

export const META_VS_REALIZADO = [
  { rotulo: 'Jan', meta: 180_000, realizado: 165_000 },
  { rotulo: 'Fev', meta: 220_000, realizado: 238_000 },
  { rotulo: 'Mar', meta: 250_000, realizado: 268_000 },
  { rotulo: 'Abr', meta: 260_000, realizado: 284_500 },
];

export const LEADS_POR_STATUS = [
  { rotulo: 'Qualificação', valor: 278, pct: 64, cor: '#8b5cf6' },
  { rotulo: 'Proposta', valor: 156, pct: 22, cor: '#c4b5fd' },
  { rotulo: 'Negociação', valor: 89, pct: 10, cor: '#fbbf24' },
  { rotulo: 'Fechamento', valor: 64, pct: 4, cor: '#34d399' },
];

export const INSIGHTS_ANALYTICS: InsightIA[] = [
  { id: 'ia1', titulo: 'Aumente o investimento no WhatsApp', descricao: 'O canal apresenta 43% maior taxa de conversão que a média.' },
  { id: 'ia2', titulo: 'Reduza o tempo de resposta', descricao: 'Leads respondidos em até 2 minutos têm 3,2x mais chance de conversão.' },
  { id: 'ia3', titulo: 'Reative leads parados', descricao: 'Você tem 142 leads qualificados sem movimentação há mais de 7 dias.' },
  { id: 'ia4', titulo: 'Melhore a taxa de comparecimento', descricao: 'Envie lembretes automáticos 24h antes das reuniões. Pode aumentar em até 28%.' },
  { id: 'ia5', titulo: 'Teste novas campanhas de indicação', descricao: 'Clientes indicados têm CAC 62% menor e conversão 2,5x maior.' },
];

export const RELATORIOS_RAPIDOS = [
  { id: 'r1', titulo: 'Relatório de Receita', descricao: 'Receita, canais e tendências', icone: 'file' as const },
  { id: 'r2', titulo: 'Desempenho de Equipe', descricao: 'Produtividade e tempo de resposta', icone: 'users' as const },
  { id: 'r3', titulo: 'Conversão por Canal', descricao: 'Do lead ao fechamento', icone: 'target' as const },
  { id: 'r4', titulo: 'ROI de Campanhas', descricao: 'Investimento vs. receita', icone: 'chart' as const },
  { id: 'r5', titulo: 'Leads em Risco', descricao: 'Leads parados e oportunidades', icone: 'alert' as const },
];

/* ------------------------------------------------------------------ */
/* IA Copiloto                                                         */
/* ------------------------------------------------------------------ */

export const TOP_OPORTUNIDADES = [
  { id: 'o1', empresa: 'Tech Solutions', segmento: 'Enterprise', valor: 180_000, probabilidade: 92, nota: 'Fechamento em 7 dias' },
  { id: 'o2', empresa: 'Grupo Alvorada', segmento: 'Mid Market', valor: 120_000, probabilidade: 88, nota: 'Em negociação' },
  { id: 'o3', empresa: 'Nova Energia', segmento: 'Enterprise', valor: 95_000, probabilidade: 76, nota: 'Proposta enviada' },
];

export const NEGOCIOS_EM_RISCO = [
  { id: 'r1', empresa: 'Construtora Delta', valor: 78_000, etapa: 'Proposta enviada', risco: 32, motivo: 'Sem contato há 8 dias' },
  { id: 'r2', empresa: 'Instituto Veritas', valor: 54_000, etapa: 'Em negociação', risco: 41, motivo: 'Concorrente ativo' },
  { id: 'r3', empresa: 'Retail Plus', valor: 36_000, etapa: 'Qualificação', risco: 48, motivo: 'Sem resposta' },
];

export const LEADS_SEM_RESPOSTA = [
  { id: 'sr1', nome: 'Carla Souza', cargo: 'Diretora de Marketing', empresa: 'Nexa', dias: 2 },
  { id: 'sr2', nome: 'Rafael Lima', cargo: 'CEO', empresa: 'BetaTech', dias: 3 },
  { id: 'sr3', nome: 'Fernanda Alves', cargo: 'Head of Growth', empresa: 'Solaris', dias: 4 },
];

export const AUTOMACOES_SUGERIDAS = [
  { id: 'as1', titulo: 'Follow-up pós proposta', detalhe: '12 leads qualificados' },
  { id: 'as2', titulo: 'Reengajamento de leads frios', detalhe: '48 leads inativos' },
  { id: 'as3', titulo: 'Boas-vindas para novos leads', detalhe: 'Novo template com IA' },
];

export const SUGESTOES_COPILOTO = [
  { id: 'sc1', titulo: 'Analisar pipeline', descricao: 'e encontrar oportunidades', icone: 'chart' as const },
  { id: 'sc2', titulo: 'Priorizar leads', descricao: 'com maior chance de conversão', icone: 'users' as const },
  { id: 'sc3', titulo: 'Criar follow-ups', descricao: 'para leads parados', icone: 'mail' as const },
  { id: 'sc4', titulo: 'Sugerir automações', descricao: 'para acelerar resultados', icone: 'settings' as const },
];

export const RESUMO_ANALISE_IA = [
  { valor: 'R$ 1,2M', rotulo: 'em oportunidades', detalhe: 'com alta probabilidade' },
  { valor: '12', rotulo: 'negociações precisam', detalhe: 'de follow-up esta semana' },
  { valor: '5', rotulo: 'leads quentes', detalhe: 'sem contato há 3+ dias' },
  { valor: '3', rotulo: 'desafios identificados', detalhe: 'que podem travar receita' },
];

export const RECOMENDACOES_COPILOTO = [
  { id: 'rc1', titulo: 'Focar em 12 negociações', descricao: 'Podem gerar R$ 680.000 nos próximos 30 dias.', acao: 'Gerar follow-up' },
  { id: 'rc2', titulo: 'Priorizar 8 leads quentes', descricao: 'Com alta intenção de compra e sem resposta recente.', acao: 'Priorizar leads' },
  { id: 'rc3', titulo: 'Criar automação de nutrição', descricao: 'Para 48 leads em estágio inicial.', acao: 'Criar automação' },
];

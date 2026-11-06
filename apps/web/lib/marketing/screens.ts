/**
 * Telas reais do produto usadas pela landing page.
 *
 * Só entram aqui os PNG "flat" de `public/lp-revenue/product/` — captura
 * limpa da interface. Os arquivos "-framed" têm um glow roxo chapado por
 * cima da tela (herança da V1) que apaga a leitura do produto e é
 * exatamente o visual de "gerado por IA" que esta reconstrução remove.
 *
 * Todas as capturas têm 1448×1086 com a janela do app ocupando
 * x 25→1422 / y 24→1038 — os números de recorte vivem em `.lp-shot-img`
 * (`app/globals.css`), aplicados por `ProductShot`.
 */
export type ProductScreen = {
  readonly src: string;
  readonly alt: string;
};

export const SCREENS = {
  dashboard: {
    src: '/lp-revenue/product/dashboard-flat.png',
    alt: 'Dashboard do ORVYN Revenue OS: leads do dia, taxa de resposta, follow-ups pendentes, pipeline de vendas e recomendações da IA',
  },
  leads: {
    src: '/lp-revenue/product/leads-flat.png',
    alt: 'Tela de Leads do ORVYN Revenue OS com origem por canal, score de qualificação e próxima ação de cada lead',
  },
  leadDetail: {
    src: '/lp-revenue/product/lead-detail-flat.png',
    alt: 'Detalhe de um lead no ORVYN Revenue OS: resumo do contato, timeline de interações por canal, negócios, tarefas e atribuição de campanha',
  },
  conversations: {
    src: '/lp-revenue/product/conversations-flat.png',
    alt: 'Caixa de conversas do ORVYN Revenue OS com WhatsApp, Instagram, e-mail e site na mesma fila, com os dados do lead ao lado da conversa',
  },
  pipeline: {
    src: '/lp-revenue/product/pipeline-flat.png',
    alt: 'Pipeline de vendas do ORVYN Revenue OS em Kanban, com valor por etapa, ticket médio e ciclo médio de vendas',
  },
  automations: {
    src: '/lp-revenue/product/automations-flat.png',
    alt: 'Construtor de automações do ORVYN Revenue OS: gatilho de entrada de lead, bloco de IA de qualificação, espera, condição e follow-up',
  },
  campaigns: {
    src: '/lp-revenue/product/campaigns-flat.png',
    alt: 'Tela de Campanhas do ORVYN Revenue OS com sequências multicanal, público, canais e atribuição de respostas e reuniões',
  },
  analytics: {
    src: '/lp-revenue/product/analytics-flat.png',
    alt: 'Analytics do ORVYN Revenue OS: receita por canal, funil de conversão, tempo de resposta por equipe e meta versus realizado',
  },
  agenda: {
    src: '/lp-revenue/product/agenda-flat.png',
    alt: 'Agenda do ORVYN Revenue OS com reuniões e follow-ups conectados ao pipeline',
  },
  copilot: {
    src: '/lp-revenue/product/copilot-flat.png',
    alt: 'Copiloto NYRO dentro do ORVYN Revenue OS respondendo sobre a operação comercial',
  },
} as const satisfies Record<string, ProductScreen>;

export type ScreenKey = keyof typeof SCREENS;

'use client';

import { clienteApi } from './session-fetch';

/** Cliente do simulador de campanhas (`/v1/ads/simulador/*`). Espelha o motor da API. */
const req = clienteApi('/api/v1/ads/simulador/');

export type Objetivo = 'mensagens' | 'leads' | 'conversoes' | 'trafego' | 'alcance' | 'engajamento';
export type Formato = 'imagem' | 'video' | 'carrossel';
export type Posicionamento = 'automatico' | 'feed' | 'stories_reels';
export type Cta = 'enviar_mensagem' | 'saiba_mais' | 'cadastre_se' | 'agendar' | 'comprar' | 'fale_conosco' | 'obter_oferta' | 'ligar';
export type TextoNaImagem = 'pouco' | 'medio' | 'muito';

export interface CriativoSim {
  nome: string;
  formato: Formato;
  hook: string;
  copy: string;
  titulo: string;
  cta: Cta;
  videoSegundos?: number;
  legendas?: boolean;
  rosto?: boolean;
  textoNaImagem?: TextoNaImagem;
  notaVisualIa?: number;
}

export interface EntradaSimulacao {
  objetivo: Objetivo;
  orcamentoDia: number;
  dias: number;
  publico: number;
  posicionamento: Posicionamento;
  ticketMedio: number;
  taxaFechamento: number;
  criativos: CriativoSim[];
  premissas?: { cpm?: number; ctr?: number; conversao?: number };
}

export interface Motivo { ok: boolean; texto: string }
export interface Dimensao { nota: number; motivos: Motivo[] }
export interface NotaCriativo { geral: number; hook: Dimensao; copy: Dimensao; cta: Dimensao; criativo: Dimensao; riscoReprovacao: boolean }
export interface Faixa { p10: number; p50: number; p90: number }
export interface Dia { dia: number; gasto: number; impressoes: number; cliques: number; resultados: number; cpr: number; frequencia: number; aprendizado: boolean }

export interface ResultadoCriativo {
  nome: string; nota: NotaCriativo; orcamentoDia: number; investimento: number; impressoes: number; alcance: number; frequencia: number;
  cliques: number; ctr: number; cpc: number; cpm: number; resultados: Faixa; custoPorResultado: Faixa; vendas: number;
  receita: number | null; roas: number | null; saidaAprendizado: number | null; chanceMelhor: number; serie: Dia[];
}

export interface ResultadoSimulacao {
  objetivo: Objetivo;
  resultadoNome: string;
  base: { cpm: number; ctr: number; conversao: number; fonte: 'conta' | 'referencia' | 'mista' | 'manual'; pesoConta: number };
  total: {
    investimento: number; impressoes: number; alcance: number; frequencia: number; cliques: number; ctr: number; cpm: number;
    resultados: Faixa; custoPorResultado: Faixa; vendas: number; receita: number | null; roas: number | null;
  };
  criativos: ResultadoCriativo[];
  vencedor: string | null;
  curvaVerba: { orcamentoDia: number; resultados: number; custoPorResultado: number }[];
  verbaRecomendada: number | null;
  serie: Dia[];
  alertas: { nivel: 'info' | 'atencao' | 'risco'; texto: string }[];
  rodadas: number;
  calibracao: { impressoes: number; cliques: number; gasto: number; resultados: number } | null;
}

export interface ImagemAnalise { tipo: 'image/jpeg' | 'image/png' | 'image/webp'; base64: string; rotulo: string }
export interface AnaliseIa {
  notaVisual: number | null; resumo: string; pontosFortes: string[]; melhorias: string[]; hooksAlternativos: string[];
  copySugerida: string; riscosPolitica: string[]; modelo: string; provedor: string; analisouImagem: boolean;
}

export const simulador = {
  simular: (e: EntradaSimulacao) => req<ResultadoSimulacao>('simular', { method: 'POST', body: JSON.stringify(e) }),
  analisar: (corpo: { objetivo: Objetivo; criativo: Omit<CriativoSim, 'notaVisualIa'>; negocio?: string; imagens: ImagemAnalise[] }) =>
    req<AnaliseIa>('analisar', { method: 'POST', body: JSON.stringify(corpo) }),
};

export const OBJETIVO_ROTULO: Record<Objetivo, string> = {
  mensagens: 'Mensagens (WhatsApp/Direct)',
  leads: 'Cadastros (formulário)',
  conversoes: 'Vendas / agendamentos no site',
  trafego: 'Tráfego',
  alcance: 'Alcance',
  engajamento: 'Engajamento',
};
export const CTA_ROTULO: Record<Cta, string> = {
  enviar_mensagem: 'Enviar mensagem', saiba_mais: 'Saiba mais', cadastre_se: 'Cadastre-se', agendar: 'Agendar',
  comprar: 'Comprar agora', fale_conosco: 'Fale conosco', obter_oferta: 'Obter oferta', ligar: 'Ligar agora',
};
export const POSICIONAMENTO_ROTULO: Record<Posicionamento, string> = {
  automatico: 'Automático (Advantage+)', feed: 'Feed', stories_reels: 'Stories e Reels',
};
export const PUBLICOS: { rotulo: string; valor: number }[] = [
  { rotulo: 'Bairro / raio 5 km (~40 mil)', valor: 40_000 },
  { rotulo: 'Cidade média (~150 mil)', valor: 150_000 },
  { rotulo: 'Cidade + região (~400 mil)', valor: 400_000 },
  { rotulo: 'Capital / metrópole (~2 mi)', valor: 2_000_000 },
  { rotulo: 'Estado (~8 mi)', valor: 8_000_000 },
  { rotulo: 'Brasil (~60 mi)', valor: 60_000_000 },
];

'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/analytics/');

export interface AiUsage {
  dias: number;
  custoUsd: number;
  tokens: number;
  execucoes: number;
  erros: number;
  porAgente: { agente: string; custo: number; n: number }[];
  porModelo: { modelo: string; custo: number; n: number }[];
  porDia: { dia: string; custo: number }[];
}
export interface AutomacoesStats {
  dias: number;
  total: number;
  concluidos: number;
  falhas: number;
  naDlq: number;
  rodando: number;
  taxaSucesso: number | null;
  porStatus: Record<string, number>;
}

export const analytics = {
  aiUsage: (dias = 30) => req<AiUsage>(`ai-usage?dias=${dias}`),
  automacoes: (dias = 30) => req<AutomacoesStats>(`automacoes?dias=${dias}`),
};

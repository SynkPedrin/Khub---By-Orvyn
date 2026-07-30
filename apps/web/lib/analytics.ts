'use client';

import { ApiError } from './api-error';

async function req<T>(path: string): Promise<T> {
  const call = () => fetch(`/api/v1/analytics/${path}`, { headers: { 'content-type': 'application/json' } });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

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

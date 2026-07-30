'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/financeiro/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

export interface Cobranca {
  id: string;
  contactId: string | null;
  dealId: string | null;
  descricao: string;
  valorCentavos: number;
  moeda: string;
  status: 'rascunho' | 'enviada' | 'paga' | 'vencida' | 'cancelada';
  vencimento: string | null;
  pagoEm: string | null;
  stripeCheckoutUrl: string | null;
  createdAt: string;
}
export interface ResumoFinanceiro {
  recebidoCentavos: number;
  aReceberCentavos: number;
  vencidoCentavos: number;
  total: number;
  pagas: number;
  vencidas: number;
}

export const financeiro = {
  cobrancas: (status?: string) => req<Cobranca[]>(`cobrancas${status ? `?status=${status}` : ''}`),
  resumo: () => req<ResumoFinanceiro>('resumo'),
  criar: (d: { descricao: string; valorCentavos: number; vencimento?: string; enviar?: boolean; contactId?: string }) =>
    req<Cobranca>('cobrancas', { method: 'POST', body: JSON.stringify(d) }),
  status: (id: string, status: 'enviada' | 'paga' | 'cancelada') =>
    req<Cobranca>(`cobrancas/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  linkPagamento: (id: string) => req<{ url: string }>(`cobrancas/${id}/link-pagamento`, { method: 'POST' }),
  remover: (id: string) => req<{ ok: boolean }>(`cobrancas/${id}`, { method: 'DELETE' }),
};

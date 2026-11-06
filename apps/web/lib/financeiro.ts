'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/financeiro/');

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

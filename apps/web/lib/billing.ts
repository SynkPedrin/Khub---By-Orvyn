'use client';

import { clienteApi } from './session-fetch';

/**
 * Billing da PLATAFORMA (o tenant pagando o KHUB): `GET /v1/billing/status`.
 * Distinto de `/v1/financeiro` (o tenant cobrando os clientes dele).
 */
const req = clienteApi('/api/v1/');

export type PlanoKhub = 'starter' | 'growth' | 'scale';
export type StatusAssinatura = 'sem_assinatura' | 'incompleta' | 'ativa' | 'inadimplente' | 'cancelada' | 'pausada';

export interface BillingStatus {
  plano: PlanoKhub | null;
  status: StatusAssinatura;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

export const billingApi = {
  status: () => req<BillingStatus>('billing/status'),
};

export const NOME_PLANO: Record<PlanoKhub, string> = { starter: 'Starter', growth: 'Growth', scale: 'Scale' };

export const ROTULO_STATUS: Record<Exclude<StatusAssinatura, 'sem_assinatura'>, string> = {
  ativa: 'Assinatura ativa',
  incompleta: 'Pagamento em andamento',
  inadimplente: 'Pagamento pendente',
  cancelada: 'Assinatura cancelada',
  pausada: 'Assinatura pausada',
};

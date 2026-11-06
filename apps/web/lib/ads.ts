'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/');

export interface Metrics {
  spend: number; leads: number; conversions: number; revenue: number; impressions: number; clicks: number;
  ctr: number; cpc: number; cpl: number; cpa: number; roas: number;
}
export interface AdsOverview {
  totals: Metrics;
  byProvider: (Metrics & { provider: string })[];
  connections: { id: string; provider: string; status: string; health: string; lastSyncAt: string | null }[];
  counts: { accounts: number; campaigns: number };
}
export interface Campaign extends Metrics { id: string; nome: string; externalId: string; objetivo: string | null; status: string }
export interface Creative extends Metrics {
  externalId: string; nome: string | null; thumbnailUrl: string | null; format: string | null; cta: string | null; body: string | null;
  /** Rótulos explícitos — nunca "melhor" sozinho sem dizer por qual métrica. */
  melhorCpl: boolean;
  maiorReceita: boolean;
}

export const ads = {
  overview: () => req<AdsOverview>('ads/overview'),
  campaigns: () => req<Campaign[]>('ads/campaigns'),
  creatives: () => req<Creative[]>('ads/creatives'),
  // `capability` só importa para o provider 'meta' ('ads' | 'leads') — ver
  // MetaAdsConnector: pedir os dois scopes num diálogo só faz "Invalid
  // Scopes" em Lead Ads derrubar também a conexão de Ads.
  authUrl: (provider: string, capability?: string) =>
    req<{ url: string }>(`integrations/${provider}/auth-url${capability ? `?capability=${capability}` : ''}`),
  sync: (id: string) => req<{ ok: boolean }>(`integrations/${id}/sync`, { method: 'POST' }),
};

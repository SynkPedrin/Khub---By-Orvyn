'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

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
export interface Creative { externalId: string; nome: string | null; thumbnailUrl: string | null; format: string | null; cta: string | null; body: string | null; roas: number; spend: number; leads: number; melhor: boolean }

export const ads = {
  overview: () => req<AdsOverview>('ads/overview'),
  campaigns: () => req<Campaign[]>('ads/campaigns'),
  creatives: () => req<Creative[]>('ads/creatives'),
  authUrl: (provider: string) => req<{ url: string }>(`integrations/${provider}/auth-url`),
  sync: (id: string) => req<{ ok: boolean }>(`integrations/${id}/sync`, { method: 'POST' }),
};

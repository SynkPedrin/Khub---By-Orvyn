'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/blueprints${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

export interface Blueprint {
  id: string;
  nome: string;
  familia: string;
  tier: number;
  orgaoRegulador?: string | null;
  etapas: { nome: string; cor?: string }[];
  automacoes: string[];
  versao: number;
}
export interface Sugestao {
  nicho: string | null;
  sugerido: Blueprint | null;
  jaAplicado: string | null;
}

export const blueprints = {
  listar: () => req<Blueprint[]>(''),
  sugerido: () => req<Sugestao>('/sugerido'),
  aplicar: (key: string) => req<{ jaAplicado?: boolean; blueprint?: string; funilId?: string; automacoes?: unknown[] }>(`/${key}/aplicar`, { method: 'POST' }),
};

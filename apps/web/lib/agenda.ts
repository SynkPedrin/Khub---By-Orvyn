'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/agenda/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

export interface Compromisso {
  id: string;
  contactId: string | null;
  titulo: string;
  inicio: string;
  fim: string;
  status: 'agendado' | 'confirmado' | 'concluido' | 'cancelado' | 'nao_compareceu';
  local: string | null;
  notas: string | null;
  googleEventId: string | null;
}

export const agenda = {
  compromissos: (range?: { de?: string; ate?: string }) => {
    const qs = new URLSearchParams();
    if (range?.de) qs.set('de', range.de);
    if (range?.ate) qs.set('ate', range.ate);
    return req<Compromisso[]>(`compromissos${qs.toString() ? `?${qs}` : ''}`);
  },
  horarios: (data: string, duracao = 60) => req<{ inicio: string; fim: string }[]>(`horarios?data=${data}&duracao=${duracao}`),
  criar: (d: { titulo: string; inicio: string; fim: string; contactId?: string; local?: string; notas?: string }) =>
    req<Compromisso>('compromissos', { method: 'POST', body: JSON.stringify(d) }),
  status: (id: string, status: Compromisso['status']) =>
    req<Compromisso>(`compromissos/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  sincronizar: (id: string) => req<{ googleEventId: string }>(`compromissos/${id}/sincronizar`, { method: 'POST' }),
  remover: (id: string) => req<{ ok: boolean }>(`compromissos/${id}`, { method: 'DELETE' }),
};

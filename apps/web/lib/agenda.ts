'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/agenda/');

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

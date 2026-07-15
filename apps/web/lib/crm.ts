'use client';

export function brl(v: number): string {
  return (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/crm/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    // access expirou → tenta refresh silencioso e repete 1x
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new Error(`CRM ${r.status}`);
  return r.json();
}

export interface Overview {
  kpis: { contatos: number; negocios: number; valorFunil: number; ganho: number; conversao: number };
  funil: { id: string; nome: string; cor: string; total: number; valor: number }[];
  atividades: { actor: string; acao: string; tone: string }[];
  contatosRecentes: { id: string; nome: string; tag: string; valor: number }[];
}
export interface PipelineData {
  stages: { id: string; nome: string; cor: string; deals: { id: string; titulo: string; contato: string; valor: number; origem: string }[] }[];
}
export interface Contato {
  id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null; tag: string; valor: number; ultimoContatoAt: string | null;
}
export interface Conversa {
  id: string; nome: string; canal: string; ultimaPrevia: string | null; naoLidas: number; ultimaHora: string | null;
  mensagens: { de: string; texto: string; hora: string | null }[];
}

export const crm = {
  overview: () => req<Overview>('overview'),
  pipeline: () => req<PipelineData>('pipeline'),
  contacts: (q?: string) => req<Contato[]>(`contacts${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  createContact: (data: Record<string, unknown>) => req<{ id: string }>('contacts', { method: 'POST', body: JSON.stringify(data) }),
  moveDeal: (id: string, stageId: string) => req<{ ok: boolean }>(`deals/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stageId }) }),
  createDeal: (data: Record<string, unknown>) => req<{ id: string }>('deals', { method: 'POST', body: JSON.stringify(data) }),
  conversations: () => req<Conversa[]>('conversations'),
};

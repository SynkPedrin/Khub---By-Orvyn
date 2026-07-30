'use client';

import { ApiError } from './api-error';

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
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
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
  id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null;
  companyId: string | null; tag: string; valor: number; ultimoContatoAt: string | null;
}
/** Página por cursor: `nextCursor: null` = acabou. */
export interface Pagina<T> { items: T[]; nextCursor: string | null }

export interface Contato360 {
  id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null;
  tag: string; tags: string[]; valor: number; camposCustom: Record<string, unknown>;
  ultimoContatoAt: string | null; createdAt: string;
  company: { id: string; nome: string; dominio: string | null; segmento: string | null } | null;
  negocios: { id: string; titulo: string; valor: number; status: string; stage: string; cor: string; origem: string | null }[];
  conversas: { id: string; canal: string; ultimaPrevia: string | null; ultimaHora: string | null; naoLidas: number }[];
  tarefas: Tarefa[];
  notas: Nota[];
  timeline: { id: string; actor: string; acao: string; tone: string; createdAt: string }[];
}
export interface Negocio360 {
  id: string; titulo: string; valor: number; origem: string | null; status: string;
  stage: { id: string; nome: string; cor: string } | null;
  contato: { id: string; nome: string; email: string | null; telefone: string | null } | null;
  createdAt: string; updatedAt: string; tarefas: Tarefa[]; notas: Nota[];
}
export interface Tarefa {
  id: string; titulo: string; descricao?: string | null; status: string; prioridade: string;
  dueAt: string | null; atrasada?: boolean; completedAt?: string | null;
  contato?: { id: string; nome: string } | null; negocio?: { id: string; titulo: string } | null;
}
export interface Nota { id: string; corpo: string; autor: string | null; createdAt: string }
export interface Empresa {
  id: string; nome: string; dominio: string | null; telefone: string | null; segmento: string | null;
  tamanho: string | null; site: string | null; contatos: number;
}
export interface Empresa360 {
  id: string; nome: string; dominio: string | null; telefone: string | null; endereco: string | null;
  segmento: string | null; tamanho: string | null; site: string | null; createdAt: string;
  contatos: { id: string; nome: string; email: string | null; telefone: string | null; tag: string }[];
  negocios: { id: string; titulo: string; valor: number; status: string; stage: string; cor: string; contato: string | null }[];
  valorAberto: number; tarefas: Tarefa[]; notas: Nota[];
}
export interface Conversa {
  id: string; nome: string; canal: string; ultimaPrevia: string | null; naoLidas: number; ultimaHora: string | null;
  mensagens: { id: string; de: string; texto: string; hora: string | null }[];
}

/** A mensagem SEMPRE persiste; só a entrega externa pode ficar pendente (ADR-0008). */
export interface SendResult {
  id: string;
  hora: string;
  status: 'sent' | 'failed' | 'sem_telefone' | 'config_required';
  erro: string | null;
  missing?: string[];
}

export interface SearchResult {
  tipo: 'contato' | 'negocio' | 'conversa';
  id: string;
  titulo: string;
  subtitulo: string;
  url: string;
}

export const crm = {
  overview: () => req<Overview>('overview'),
  search: (q: string) => req<SearchResult[]>(`search?q=${encodeURIComponent(q)}`),
  pipeline: () => req<PipelineData>('pipeline'),

  // ---- Contatos ----
  contacts: (opts: { q?: string; cursor?: string; limit?: number } = {}) => {
    const p = new URLSearchParams();
    if (opts.q) p.set('q', opts.q);
    if (opts.cursor) p.set('cursor', opts.cursor);
    if (opts.limit) p.set('limit', String(opts.limit));
    const qs = p.toString();
    return req<Pagina<Contato>>(`contacts${qs ? `?${qs}` : ''}`);
  },
  contact: (id: string) => req<Contato360>(`contacts/${id}`),
  createContact: (data: Record<string, unknown>) => req<{ id: string }>('contacts', { method: 'POST', body: JSON.stringify(data) }),
  updateContact: (id: string, data: Record<string, unknown>) => req<{ ok: boolean }>(`contacts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContact: (id: string) => req<{ ok: boolean }>(`contacts/${id}`, { method: 'DELETE' }),

  // ---- Negócios ----
  deal: (id: string) => req<Negocio360>(`deals/${id}`),
  moveDeal: (id: string, stageId: string) => req<{ ok: boolean }>(`deals/${id}/stage`, { method: 'PATCH', body: JSON.stringify({ stageId }) }),
  createDeal: (data: Record<string, unknown>) => req<{ id: string }>('deals', { method: 'POST', body: JSON.stringify(data) }),
  updateDeal: (id: string, data: Record<string, unknown>) => req<{ ok: boolean }>(`deals/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteDeal: (id: string) => req<{ ok: boolean }>(`deals/${id}`, { method: 'DELETE' }),

  // ---- Empresas ----
  companies: (q?: string) => req<Empresa[]>(`companies${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  company: (id: string) => req<Empresa360>(`companies/${id}`),
  createCompany: (data: Record<string, unknown>) => req<{ id: string }>('companies', { method: 'POST', body: JSON.stringify(data) }),
  updateCompany: (id: string, data: Record<string, unknown>) => req<{ ok: boolean }>(`companies/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteCompany: (id: string) => req<{ ok: boolean }>(`companies/${id}`, { method: 'DELETE' }),

  // ---- Tarefas ----
  tasks: (filtro: 'todas' | 'abertas' | 'concluidas' | 'hoje' | 'atrasadas' = 'abertas') => req<Tarefa[]>(`tasks?filtro=${filtro}`),
  createTask: (data: Record<string, unknown>) => req<{ id: string }>('tasks', { method: 'POST', body: JSON.stringify(data) }),
  updateTask: (id: string, data: Record<string, unknown>) => req<{ ok: boolean }>(`tasks/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  toggleTask: (id: string) => req<{ ok: boolean; status: string }>(`tasks/${id}/toggle`, { method: 'POST' }),
  deleteTask: (id: string) => req<{ ok: boolean }>(`tasks/${id}`, { method: 'DELETE' }),

  // ---- Notas ----
  createNote: (data: Record<string, unknown>) => req<{ id: string; createdAt: string }>('notes', { method: 'POST', body: JSON.stringify(data) }),
  updateNote: (id: string, corpo: string) => req<{ ok: boolean }>(`notes/${id}`, { method: 'PATCH', body: JSON.stringify({ corpo }) }),
  deleteNote: (id: string) => req<{ ok: boolean }>(`notes/${id}`, { method: 'DELETE' }),

  // ---- Inbox ----
  conversations: () => req<Conversa[]>('conversations'),
  sendMessage: (conversationId: string, texto: string) =>
    req<SendResult>(`conversations/${conversationId}/messages`, { method: 'POST', body: JSON.stringify({ texto }) }),
};

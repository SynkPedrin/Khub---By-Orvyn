'use client';

import { ApiError } from './api-error';

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const call = () => fetch(`/api/v1/nyro/${path}`, { headers: { 'content-type': 'application/json' }, ...opts });
  let r = await call();
  if (r.status === 401) {
    const rf = await fetch('/api/auth/refresh', { method: 'POST' });
    if (rf.ok) r = await call();
    else if (typeof window !== 'undefined') window.location.href = '/login';
  }
  if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
  return r.json();
}

export interface Capacidade { nome: string; descricao: string; precisaAprovacao: boolean }
export interface StatusNyro { configurada: boolean; missing: string[]; capacidades: Capacidade[] }

export interface PassoNyro { tipo: 'roteou' | 'tool' | 'aprovacao' | 'texto' | 'erro'; rotulo: string; detalhe?: string }
export interface Aprovacao { id: string; tool: string; resumo: string }
export interface Fonte { chunkId: string; titulo: string; escopo: string }

export interface RespostaNyro {
  conversationId: string;
  agente: string;
  passos: PassoNyro[];
  texto: string;
  fontes: Fonte[];
  aprovacoes: Aprovacao[];
  guardrail?: string;
}
export interface MensagemNyro {
  id: string; papel: 'user' | 'assistant' | 'tool'; conteudo: string;
  agente: string | null; fontes: Fonte[]; guardrail: string | null; createdAt: string;
}

export const AGENTE_NOME: Record<string, string> = {
  configuracao: 'Arquiteta',
  conversas: 'Atendente',
  growth: 'Estrategista',
  consultoria: 'Consultora',
};

export const nyro = {
  status: () => req<StatusNyro>('status'),
  chat: (texto: string, conversationId?: string) =>
    req<RespostaNyro>('chat', { method: 'POST', body: JSON.stringify({ texto, conversationId }) }),
  conversas: () => req<{ id: string; titulo: string | null; updatedAt: string }[]>('conversas'),
  conversa: (id: string) => req<{ id: string; titulo: string | null; mensagens: MensagemNyro[]; aprovacoes: Aprovacao[] }>(`conversas/${id}`),
  decidir: (actionId: string, aprovar: boolean) =>
    req<{ ok: boolean; status: string; erro?: string }>(`acoes/${actionId}`, { method: 'POST', body: JSON.stringify({ aprovar }) }),
  pendentes: () => req<Aprovacao[]>('acoes'),
  uso: () => req<{ agente: string; chamadas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number }[]>('uso'),
};

'use client';

import { clienteApi } from './session-fetch';

/** Agent Manager (ADR-0030). Tenant vem da sessão, nunca do browser. */
const req = clienteApi('/api/v1/');

export type StatusAgente = 'rascunho' | 'ativo' | 'pausado' | 'arquivado';

export interface Agente {
  id: string;
  nome: string;
  descricao: string | null;
  status: StatusAgente;
  modelo: string;
  instrucoes: string;
  tom: string;
  personalidade: string;
  ferramentas: string[];
  conhecimentoAtivo: boolean;
  conhecimentoEscopos: string[];
  maxRespostasConversa: number;
  maxCaracteres: number;
  canais: string[];
  padrao: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AgenteResumo extends Agente {
  metricas7d: { respondidas: number; transferidas: number; erros: number; custoUsd: number };
  conversasAtivas: number;
}

export interface CatalogoAgentes {
  modelos: { id: string; nome: string; descricao: string; entradaUsdPorMilhao: number; saidaUsdPorMilhao: number }[];
  modeloPadrao: string;
  tons: { id: string; nome: string; instrucao: string }[];
  ferramentas: { nome: string; rotulo: string; descricao: string; tipo: 'leitura' | 'escrita'; obrigatoria: boolean }[];
  escopos: { id: string; nome: string }[];
  canais: string[];
  ia: { configurada: boolean; faltando: string[] };
}

/** Campos editáveis (o formulário manda só o que mudou). */
export type AgenteInput = Partial<Omit<Agente, 'id' | 'status' | 'createdAt' | 'updatedAt'>>;

export interface ResultadoTeste {
  texto: string;
  transferiria: string | null;
  ferramentas: { nome: string; ok: boolean }[];
  fontes: { chunkId: string; titulo: string; escopo: string }[];
  guardrail: string | null;
  modelo: string;
  custoUsd: number;
}

const json = (body: unknown): RequestInit => ({ headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const agentesApi = {
  catalogo: () => req<CatalogoAgentes>('agents/catalogo'),
  listar: () => req<AgenteResumo[]>('agents'),
  obter: (id: string) => req<Agente>(`agents/${id}`),
  criar: (input: AgenteInput & { nome: string }) => req<Agente>('agents', { method: 'POST', ...json(input) }),
  atualizar: (id: string, input: AgenteInput) => req<Agente>(`agents/${id}`, { method: 'PATCH', ...json(input) }),
  status: (id: string, status: Exclude<StatusAgente, 'rascunho'>) => req<Agente>(`agents/${id}/status`, { method: 'POST', ...json({ status }) }),
  testar: (id: string, mensagens: { de: 'contato' | 'ia'; texto: string }[], rascunho?: AgenteInput) =>
    req<ResultadoTeste>(`agents/${id}/testar`, { method: 'POST', ...json({ mensagens, rascunho }) }),
};

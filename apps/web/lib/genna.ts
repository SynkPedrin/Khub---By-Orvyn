'use client';

import { clienteApi } from './session-fetch';
import { ApiError } from './api-error';

/** Genna da subconta (ADR-0053): `/api/v1/genna/*` → `/v1/genna/*`. */
const req = clienteApi('/api/v1/genna/');
const post = <T>(caminho: string, corpo: unknown) => req<T>(caminho, { method: 'POST', body: JSON.stringify(corpo) });

export interface StatusGenna {
  configurado: boolean;
  missing: string[];
  conectado: boolean;
  status: string | null;
  erro: string | null;
  conectadoEm: string | null;
  escopos: string[];
  podePublicar: boolean;
}

export type ClasseFerramenta = 'leitura' | 'escrita' | 'publicacao';

export interface PropriedadeSchema {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: PropriedadeSchema;
  format?: string;
  minimum?: number;
  maximum?: number;
}

export interface FerramentaGenna {
  nome: string;
  titulo: string;
  descricao: string;
  classe: ClasseFerramenta;
  parametros: { type?: string; properties?: Record<string, PropriedadeSchema>; required?: string[] };
}

export interface ResultadoGenna {
  ferramenta: string;
  classe: ClasseFerramenta;
  ok: boolean;
  texto: string;
  dados: unknown;
  imagens: string[];
  links: string[];
}

export type RespostaExecucao = ResultadoGenna | { aprovacao: { id: string; resumo: string } };

export const gennaApi = {
  status: () => req<StatusGenna>('status'),
  urlConexao: () => req<{ url: string }>('auth-url'),
  desconectar: () => req<{ ok: true }>('conexao', { method: 'DELETE' }),
  ferramentas: (renovar = false) => req<FerramentaGenna[]>(`ferramentas${renovar ? '?renovar=1' : ''}`),
  consultar: (nome: string, argumentos: Record<string, unknown> = {}) => post<ResultadoGenna>(`consultar/${encodeURIComponent(nome)}`, { argumentos }),
  executar: (nome: string, argumentos: Record<string, unknown> = {}) => post<RespostaExecucao>(`executar/${encodeURIComponent(nome)}`, { argumentos, confirmar: true }),
};

export function codigoErroGenna(e: unknown): string | null {
  return e instanceof ApiError && typeof e.body?.code === 'string' ? e.body.code : null;
}

export function mensagemErroGenna(e: unknown, padrao: string): string {
  if (e instanceof ApiError) {
    if (e.status === 403 && !e.body?.code) return 'Seu papel nesta conta não permite esta ação no Genna. Peça a um administrador.';
    const t = e.body?.title;
    if (typeof t === 'string' && t) return t;
  }
  return padrao;
}

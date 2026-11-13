'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/nyro/');

export interface Capacidade { nome: string; descricao: string; precisaAprovacao: boolean }
export interface StatusNyro { configurada: boolean; missing: string[]; capacidades: Capacidade[] }

/** Arquivo que a NICO lê (extração no servidor). Mantenha em sincronia com `nyro/anexos.ts` da API. */
export interface AnexoEnvio { nome: string; base64: string }
export const ANEXO_EXTENSOES = ['pdf', 'docx', 'pptx', 'md', 'txt', 'csv', 'json', 'py', 'js', 'ts', 'tsx', 'html', 'xml', 'yml', 'yaml', 'sql', 'log'];
export const ANEXO_MAX_BYTES = 10 * 1024 * 1024;
export const ANEXO_MAX_QTD = 3;

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
  chat: (texto: string, conversationId?: string, anexos?: AnexoEnvio[]) =>
    req<RespostaNyro>('chat', { method: 'POST', body: JSON.stringify({ texto, conversationId, ...(anexos?.length ? { anexos } : {}) }) }),
  conversas: () => req<{ id: string; titulo: string | null; updatedAt: string }[]>('conversas'),
  conversa: (id: string) => req<{ id: string; titulo: string | null; mensagens: MensagemNyro[]; aprovacoes: Aprovacao[] }>(`conversas/${id}`),
  decidir: (actionId: string, aprovar: boolean) =>
    req<{ ok: boolean; status: string; erro?: string }>(`acoes/${actionId}`, { method: 'POST', body: JSON.stringify({ aprovar }) }),
  pendentes: () => req<Aprovacao[]>('acoes'),
  uso: () => req<{ agente: string; chamadas: number; tokensEntrada: number; tokensSaida: number; custoUsd: number }[]>('uso'),
};

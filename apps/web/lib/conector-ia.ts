'use client';

import { clienteApi } from './session-fetch';

/** Conector MCP (Claude/ChatGPT) — ADR-0049. */
const req = clienteApi('/api/v1/conector-ia/');

export interface InfoConector {
  url: string;
  totalFerramentas: number;
  ferramentas: { nome: string; titulo: string; tipo: 'leitura' | 'escrita' | 'aprovacao' }[];
}
export interface ConexaoIa { id: string; aplicativo: string; autorizadoPor: string | null; criadaEm: string; ultimoUsoEm: string | null }
export interface PedidoConexao {
  aplicativo: string;
  destino: string;
  subconta: string;
  papel: string;
  podeAutorizar: boolean;
  expiraEm: string;
  negar: string | null;
}

export const conectorIaApi = {
  info: () => req<InfoConector>('info'),
  conexoes: () => req<ConexaoIa[]>('conexoes'),
  revogar: (id: string) => req<{ ok: boolean }>(`conexoes/${id}`, { method: 'DELETE' }),
  pedido: (pedido: string) => req<PedidoConexao>(`pedido/${encodeURIComponent(pedido)}`),
  decidir: (pedido: string, aprovar: boolean) => req<{ redirect: string }>('decidir', { method: 'POST', body: JSON.stringify({ pedido, aprovar }) }),
};

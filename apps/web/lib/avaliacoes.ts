'use client';

import { clienteApi } from './session-fetch';

/** Pedido de avaliação (Q4.4). Contrato: `apps/api/src/avaliacoes/avaliacoes.controller.ts`. */
const req = clienteApi('/api/v1/avaliacoes');

export interface ConfigAvaliacao {
  plataforma: 'google' | 'outro';
  link: string;
  mensagemPadrao: string;
  assuntoEmail: string;
  filtroSatisfacao: boolean;
  notaMinima: number;
  updatedAt?: string;
}
export interface RespostaConfig {
  configurado: boolean;
  config: ConfigAvaliacao | null;
  sugestao: { mensagemPadrao: string; assuntoEmail: string };
  variaveis: { chave: string; rotulo: string }[];
}
export interface PedidoAvaliacao {
  id: string;
  contactId: string;
  contatoNome: string;
  canal: 'whatsapp' | 'email';
  status: 'pendente' | 'enviado' | 'falhou' | 'config_required';
  origem: 'manual' | 'automacao';
  erro: string | null;
  enviadoEm: string | null;
  clicadoEm: string | null;
  cliques: number;
  avaliacaoInterna: number | null;
  comentario: string | null;
  redirecionado: boolean;
  createdAt: string;
  linkCurto: string;
}
export interface ResumoAvaliacoes {
  dias: number;
  pedidos: number;
  enviados: number;
  falhas: number;
  clicados: number;
  taxaClique: number;
  avaliacoesInternas: number;
  mediaInterna: number | null;
  distribuicao: { nota: number; total: number }[];
  encaminhadosAoPublico: number;
}
export interface ResultadoPedido {
  pedido: { id: string; status: string; canal: string; linkCurto: string };
  status: 'enviado' | 'config_required' | 'falhou' | 'adiar';
  erro?: string | null;
}

export const avaliacoes = {
  config: () => req<RespostaConfig>('/config'),
  salvarConfig: (c: Omit<ConfigAvaliacao, 'updatedAt'>) => req<ConfigAvaliacao>('/config', { method: 'POST', body: JSON.stringify(c) }),
  pedidos: (contactId?: string) => req<PedidoAvaliacao[]>(`/pedidos${contactId ? `?contactId=${contactId}` : ''}`),
  resumo: (dias = 90) => req<ResumoAvaliacoes>(`/resumo?dias=${dias}`),
  pedir: (contactId: string, canal: 'whatsapp' | 'email') => req<ResultadoPedido>('/pedidos', { method: 'POST', body: JSON.stringify({ contactId, canal }) }),
};

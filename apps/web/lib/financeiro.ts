'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente autenticado deste módulo.
 *
 * A lógica de 401 → renovar → repetir → encerrar sessão vive em
 * `session-fetch.ts`. Ela estava copiada em dez arquivos e cada cópia
 * carregava o mesmo loop de redirecionamento infinito.
 */
const req = clienteApi('/api/v1/financeiro/');

export interface Cobranca {
  id: string;
  contactId: string | null;
  dealId: string | null;
  descricao: string;
  valorCentavos: number;
  moeda: string;
  status: 'rascunho' | 'enviada' | 'paga' | 'vencida' | 'cancelada';
  vencimento: string | null;
  pagoEm: string | null;
  stripeCheckoutUrl: string | null;
  createdAt: string;
}
export interface ResumoFinanceiro {
  recebidoCentavos: number;
  aReceberCentavos: number;
  vencidoCentavos: number;
  total: number;
  pagas: number;
  vencidas: number;
}

// ------------------------- fluxo de caixa (db/070) -------------------------
export interface Categoria {
  id: string;
  nome: string;
  tipo: 'entrada' | 'saida';
  cor: string | null;
}

export interface Transacao {
  id: string;
  tipo: 'entrada' | 'saida';
  categoriaId: string | null;
  categoria: Categoria | null;
  descricao: string;
  valorCentavos: number;
  dataCompetencia: string;
  status: 'pago' | 'pendente';
  contactId: string | null;
  cobrancaId: string | null;
  compromissoId: string | null;
  responsavelId: string | null;
  origem: 'manual' | 'agenda' | 'cobranca' | 'importacao' | 'comissao';
  observacao: string | null;
  createdAt: string;
}

export interface NovaTransacao {
  tipo: 'entrada' | 'saida';
  descricao: string;
  valorCentavos: number;
  categoriaId?: string | null;
  dataCompetencia?: string | null;
  status?: 'pago' | 'pendente';
  responsavelId?: string | null;
  observacao?: string | null;
}

export interface FluxoCaixa {
  entradasCentavos: number;
  saidasCentavos: number;
  saldoCentavos: number;
  aReceberCentavos: number;
  aPagarCentavos: number;
  porCategoria: { categoriaId: string | null; nome: string | null; tipo: 'entrada' | 'saida'; total: number; qtd: number }[];
  porDia: { dia: string; tipo: 'entrada' | 'saida'; total: number }[];
}

// ------------------------- comissões -------------------------
export interface MembroComissao {
  identityId: string;
  role: string;
  email: string;
  nome: string;
  cargo: string | null;
  comissaoPercent: number;
}

export interface ComissaoGerada {
  id: string;
  identityId: string;
  nome: string;
  baseCentavos: number;
  percent: number;
  valorCentavos: number;
  status: 'prevista' | 'paga';
  pagoEm: string | null;
  competencia: string;
  descricao: string | null;
  dataCompetencia: string | null;
}

export interface ComissoesMes {
  competencia: string;
  porMembro: { identityId: string; nome: string; totalCentavos: number; pagoCentavos: number; previstoCentavos: number; qtd: number }[];
  itens: ComissaoGerada[];
}

/** Resultado de um lote de importação (financeiro e agenda). `linha` já é a do arquivo. */
export interface ResultadoImportacao {
  total: number;
  criados: number;
  /** Linhas que já tinham sido importadas antes (não duplicam). */
  ignorados: number;
  erros: { linha: number; motivo: string }[];
  /** Linha importada, mas com ressalva (ex.: profissional não encontrado, entrou sem comissão). */
  avisos: { linha: number; motivo: string }[];
}

export interface OpcoesImportacaoFin {
  /** Padrão false: histórico importado não gera comissão (pode já ter sido paga no sistema antigo). */
  gerarComissoes?: boolean;
}

export const financeiro = {
  cobrancas: (status?: string) => req<Cobranca[]>(`cobrancas${status ? `?status=${status}` : ''}`),
  resumo: () => req<ResumoFinanceiro>('resumo'),
  criar: (d: { descricao: string; valorCentavos: number; vencimento?: string; enviar?: boolean; contactId?: string }) =>
    req<Cobranca>('cobrancas', { method: 'POST', body: JSON.stringify(d) }),
  status: (id: string, status: 'enviada' | 'paga' | 'cancelada') =>
    req<Cobranca>(`cobrancas/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  linkPagamento: (id: string) => req<{ url: string }>(`cobrancas/${id}/link-pagamento`, { method: 'POST' }),
  remover: (id: string) => req<{ ok: boolean }>(`cobrancas/${id}`, { method: 'DELETE' }),

  // ------------------------- caixa -------------------------
  categorias: () => req<Categoria[]>('categorias'),
  criarCategoria: (d: { nome: string; tipo: 'entrada' | 'saida'; cor?: string | null }) =>
    req<Categoria>('categorias', { method: 'POST', body: JSON.stringify(d) }),
  atualizarCategoria: (id: string, d: { nome?: string; cor?: string | null }) =>
    req<Categoria>(`categorias/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  removerCategoria: (id: string) => req<{ ok: boolean }>(`categorias/${id}`, { method: 'DELETE' }),
  transacoes: (filtro?: { de?: string; ate?: string; tipo?: string; status?: string; categoriaId?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(filtro ?? {})) if (v) qs.set(k, v);
    return req<Transacao[]>(`transacoes${qs.toString() ? `?${qs}` : ''}`);
  },
  criarTransacao: (d: NovaTransacao) => req<Transacao>('transacoes', { method: 'POST', body: JSON.stringify(d) }),
  atualizarTransacao: (id: string, d: Partial<NovaTransacao>) => req<Transacao>(`transacoes/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  statusTransacao: (id: string, status: 'pago' | 'pendente') =>
    req<Transacao>(`transacoes/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  removerTransacao: (id: string) => req<{ ok: boolean }>(`transacoes/${id}`, { method: 'DELETE' }),
  fluxo: (de?: string, ate?: string) => {
    const qs = new URLSearchParams();
    if (de) qs.set('de', de);
    if (ate) qs.set('ate', ate);
    return req<FluxoCaixa>(`fluxo${qs.toString() ? `?${qs}` : ''}`);
  },
  importar: (linhas: Record<string, unknown>[], opcoes: OpcoesImportacaoFin, linhaInicial: number) =>
    req<ResultadoImportacao>('importar', { method: 'POST', body: JSON.stringify({ linhas, opcoes, linhaInicial }) }),

  // ------------------------- comissões -------------------------
  equipeComissoes: () => req<MembroComissao[]>('comissoes/equipe'),
  definirComissao: (identityId: string, d: { cargo?: string | null; comissaoPercent?: number }) =>
    req<unknown>(`comissoes/equipe/${identityId}`, { method: 'PUT', body: JSON.stringify(d) }),
  comissoesGeradas: (competencia?: string) => req<ComissoesMes>(`comissoes/geradas${competencia ? `?competencia=${competencia}` : ''}`),
  pagarComissao: (id: string) => req<unknown>(`comissoes/geradas/${id}/pagar`, { method: 'POST' }),
  /** Desfaz o pagamento: a comissão volta a prevista e a saída do caixa é apagada. */
  estornarComissao: (id: string) => req<unknown>(`comissoes/geradas/${id}/estornar`, { method: 'POST' }),
};

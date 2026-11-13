'use client';

import { clienteApi } from './session-fetch';

/**
 * Cliente das telas comerciais (ADR-0042): estrutura de funis, propostas,
 * carteira de clientes e importação por planilha.
 */
const req = clienteApi('/api/v1/crm/');
const json = (body: unknown) => ({ body: JSON.stringify(body) });

// ------------------------------------------------------------ funis

export interface EtapaConfig { id: string; nome: string; cor: string; ordem: number; abertos: number; total: number }
export interface FunilConfig { id: string; nome: string; tipo: string; etapas: EtapaConfig[]; negocios: number }

export const funisApi = {
  listar: () => req<FunilConfig[]>('pipelines'),
  criar: (d: { nome: string; etapas?: string[] }) => req<{ id: string }>('pipelines', { method: 'POST', ...json(d) }),
  renomear: (id: string, nome: string) => req<{ ok: true }>(`pipelines/${id}`, { method: 'PATCH', ...json({ nome }) }),
  apagar: (id: string, moverPara?: string) => req<{ ok: true; movidos: number }>(`pipelines/${id}${moverPara ? `?moverPara=${moverPara}` : ''}`, { method: 'DELETE' }),
  criarEtapa: (pipelineId: string, d: { nome: string; cor?: string; posicao?: number }) => req<{ id: string }>(`pipelines/${pipelineId}/stages`, { method: 'POST', ...json(d) }),
  atualizarEtapa: (id: string, d: { nome?: string; cor?: string }) => req<{ ok: true }>(`stages/${id}`, { method: 'PATCH', ...json(d) }),
  reordenar: (pipelineId: string, ids: string[]) => req<{ ok: true }>(`pipelines/${pipelineId}/stages/order`, { method: 'POST', ...json({ ids }) }),
  apagarEtapa: (id: string, moverPara?: string) => req<{ ok: true; movidos: number }>(`stages/${id}${moverPara ? `?moverPara=${moverPara}` : ''}`, { method: 'DELETE' }),
};

// ------------------------------------------------------------ propostas

export type StatusProposta = 'rascunho' | 'enviada' | 'aceita' | 'recusada' | 'expirada' | 'cancelada';
export type AcaoProposta = 'enviar' | 'aceitar' | 'recusar' | 'cancelar' | 'reabrir';
export interface ItemProposta { descricao: string; quantidade: number; valorUnitario: number }
export interface PropostaResumo {
  id: string; titulo: string; status: StatusProposta; valor: number; desconto: number; validade: string | null;
  enviadaEm: string | null; respondidaEm: string | null; motivoRecusa: string | null; proximoFollowupAt: string | null;
  updatedAt: string; createdAt: string;
  contato: { id: string; nome: string; telefone: string | null } | null;
  negocio: { id: string; titulo: string; status: string } | null;
  diasSemResposta: number; parada: boolean;
}
export interface PropostaDetalhe extends Omit<PropostaResumo, 'contato' | 'negocio' | 'diasSemResposta' | 'parada'> {
  contactId: string | null; dealId: string | null; itens: ItemProposta[]; observacoes: string | null; ownerId: string | null;
  contato: { id: string; nome: string; email: string | null; telefone: string | null } | null;
  negocio: { id: string; titulo: string; status: string; valor: number } | null;
}
export interface ResumoPropostas { rascunho: number; enviadas: number; paradas: number; aceitas: number; valorEmNegociacao: number; valorAceito: number; taxaAceite: number | null }
export interface DadosProposta { titulo: string; contactId?: string | null; dealId?: string | null; itens: ItemProposta[]; desconto?: number; validade?: string | null; observacoes?: string | null }

export const propostasApi = {
  listar: (f: { status?: string; q?: string; contactId?: string; dealId?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
    return req<{ itens: PropostaResumo[]; resumo: ResumoPropostas }>(`proposals${qs ? `?${qs}` : ''}`);
  },
  obter: (id: string) => req<PropostaDetalhe>(`proposals/${id}`),
  criar: (d: DadosProposta) => req<{ id: string }>('proposals', { method: 'POST', ...json(d) }),
  atualizar: (id: string, d: Partial<DadosProposta>) => req<{ ok: true }>(`proposals/${id}`, { method: 'PATCH', ...json(d) }),
  acao: (id: string, acao: AcaoProposta, extra: { motivo?: string; marcarNegocioPerdido?: boolean } = {}) =>
    req<{ ok: true; status: StatusProposta; negocioAtualizado: 'ganho' | 'perdido' | null }>(`proposals/${id}/acao`, { method: 'POST', ...json({ acao, ...extra }) }),
  apagar: (id: string) => req<{ ok: true }>(`proposals/${id}`, { method: 'DELETE' }),
};

/** Mesmo cálculo do servidor (centavos exatos), para mostrar o total ao digitar. */
export function totalProposta(itens: ItemProposta[], desconto: number): number {
  const c = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100);
  const bruto = itens.reduce((t, i) => t + Math.round((Number.isFinite(i.quantidade) ? i.quantidade : 0) * c(i.valorUnitario)), 0);
  return Math.max(0, bruto - c(desconto)) / 100;
}

// ------------------------------------------------------------ carteira

export type StatusCarteira = 'ativo' | 'em_risco' | 'inativo';
export interface ClienteCarteira {
  contactId: string; nome: string; telefone: string | null; email: string | null; tags: string[];
  compras: number; totalComprado: number; ticketMedio: number; recebido: number;
  clienteDesde: string; ultimaCompra: string; diasSemComprar: number; status: StatusCarteira;
  cicloDias: number | null; proximaCompraPrevista: string | null; recompraAtrasada: boolean; optOut: boolean;
}
export interface Carteira {
  limites: { ativoDias: number; riscoDias: number };
  resumo: { clientes: number; ativos: number; emRisco: number; inativos: number; recompraAtrasada: number; recorrentes: number; receitaTotal: number; ticketMedio: number; ltvMedio: number };
  clientes: ClienteCarteira[];
}

export const carteiraApi = {
  ver: (ativoDias?: number, riscoDias?: number) => req<Carteira>(`carteira?${new URLSearchParams({ ...(ativoDias ? { ativoDias: String(ativoDias) } : {}), ...(riscoDias ? { riscoDias: String(riscoDias) } : {}) })}`),
  marcar: (contactIds: string[], tag: string) => req<{ ok: true; marcados: number; jaTinham: number; naoEncontrados: number }>('carteira/marcar', { method: 'POST', ...json({ contactIds, tag }) }),
};

// ------------------------------------------------------------ importação

export type CampoImportacao = 'nome' | 'primeiroNome' | 'sobrenome' | 'telefone' | 'email' | 'empresa' | 'cargo' | 'tags' | 'origem' | 'valor' | 'cidade' | 'observacao';
export type LinhaImportacao = Partial<Record<CampoImportacao, string>> & { campos?: Record<string, string> };
export interface OpcoesImportacao { atualizarExistentes?: boolean; tagExtra?: string; origem?: string; dispararAutomacoes?: boolean; stageId?: string }
export interface ResultadoImportacao { total: number; criados: number; atualizados: number; ignorados: number; negociosCriados: number; eventosNeutralizados: number; erros: { linha: number; motivo: string }[] }

export const importacaoApi = {
  contatos: (linhas: LinhaImportacao[], opcoes: OpcoesImportacao, linhaInicial: number) =>
    req<ResultadoImportacao>('import/contacts', { method: 'POST', ...json({ linhas, opcoes, linhaInicial }) }),
};

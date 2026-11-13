'use client';

import { clienteApi } from './session-fetch';

/**
 * Lista real de Leads/Contatos (Q2.2): filtros, ações em massa, listas salvas
 * e duplicados. Contrato do filtro = `apps/api/src/crm/contatos-filtro.ts`.
 */
const req = clienteApi('/api/crm/');

export interface FiltroContatos {
  q?: string;
  stageId?: string;
  origem?: string;
  tag?: string;
  /** identityId, ou `nenhum` = sem dono. */
  ownerId?: string;
  naoPerturbe?: 'sim' | 'nao';
  /** AAAA-MM-DD */
  criadoDe?: string;
  criadoAte?: string;
  /** Campo personalizado → `cf_<chave>=<valor>` (Q2.3 resolve pelo tipo). */
  cf?: Record<string, string>;
}

export const ORDENS = [
  { value: 'recentes', label: 'Mais recentes' },
  { value: 'antigos', label: 'Mais antigos' },
  { value: 'nome_az', label: 'Nome (A a Z)' },
  { value: 'nome_za', label: 'Nome (Z a A)' },
  { value: 'valor_desc', label: 'Maior valor' },
  { value: 'atualizados', label: 'Atualizados recentemente' },
] as const;
export type OrdemContatos = (typeof ORDENS)[number]['value'];

export const COLUNAS = [
  { id: 'email', label: 'E-mail' },
  { id: 'telefone', label: 'Telefone' },
  { id: 'empresa', label: 'Empresa' },
  { id: 'tags', label: 'Tags' },
  { id: 'etapa', label: 'Etapa' },
  { id: 'origem', label: 'Origem' },
  { id: 'dono', label: 'Dono' },
  { id: 'valor', label: 'Valor' },
  { id: 'criadoEm', label: 'Criado em' },
  { id: 'ultimoContato', label: 'Último contato' },
  { id: 'naoPerturbe', label: 'Não perturbe' },
] as const;
export type ColunaId = 'nome' | (typeof COLUNAS)[number]['id'];
export const COLUNAS_PADRAO: ColunaId[] = ['nome', 'telefone', 'tags', 'etapa', 'origem', 'dono', 'criadoEm'];

export interface ContatoLista {
  id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null;
  companyId: string | null; tag: string; valor: number; ultimoContatoAt: string | null;
  tags: string[]; ownerId: string | null; optedOutAt: string | null; origem: string | null; createdAt: string | null;
  etapa: { dealId: string; stageId: string; nome: string; cor: string } | null;
}
export interface PaginaContatos { items: ContatoLista[]; nextCursor: string | null }

export type AcaoMassa = 'tag_add' | 'tag_remove' | 'etapa' | 'dono' | 'nao_perturbe' | 'excluir';
export interface ResultadoMassa { acao: AcaoMassa; alvo: number; afetados: number; ignorados: number }

export interface ListaSalva {
  id: string; nome: string; filtros: FiltroContatos; colunas: string[]; ordem: OrdemContatos;
  compartilhada: boolean; ownerIdentityId: string; minha: boolean;
}

export interface ContatoDuplicado {
  id: string; nome: string; email: string | null; telefone: string | null; empresa: string | null;
  tags: string[]; createdAt: string; negocios: number; conversas: number;
}
export interface GrupoDuplicado { motivos: ('email' | 'telefone')[]; sugeridoPrincipalId: string; contatos: ContatoDuplicado[] }

/** Filtro → query string (vazios ficam de fora; `cf` vira `cf_<chave>`). */
export function queryDoFiltro(f: FiltroContatos, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (k === 'cf' || v === undefined || v === '') continue;
    p.set(k, String(v));
  }
  for (const [k, v] of Object.entries(f.cf ?? {})) if (v) p.set(`cf_${k}`, v);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

/** Quantos filtros (fora a busca) estão ativos — badge do botão "Filtros". */
export function contarFiltros(f: FiltroContatos): number {
  let n = 0;
  for (const [k, v] of Object.entries(f)) {
    if (k === 'q' || v === undefined || v === '') continue;
    n += k === 'cf' ? Object.values(v as Record<string, string>).filter(Boolean).length : 1;
  }
  return n;
}

export const contatos = {
  listar: (f: FiltroContatos, opts: { cursor?: string; limit?: number; ordem?: OrdemContatos } = {}) => {
    const qs = queryDoFiltro(f, { cursor: opts.cursor, limit: opts.limit, ordem: opts.ordem });
    return req<PaginaContatos>(`contacts${qs ? `?${qs}` : ''}`);
  },
  massa: (body: { ids?: string[]; filtro?: FiltroContatos; acao: AcaoMassa; params?: Record<string, unknown> }) =>
    req<ResultadoMassa>('contacts/bulk', { method: 'POST', body: JSON.stringify(body) }),
  duplicados: () => req<{ grupos: GrupoDuplicado[]; total: number }>('contacts/duplicates'),
  mesclar: (principalId: string, duplicadoIds: string[]) =>
    req<{ ok: true; principalId: string; mesclados: number; movidos: Record<string, number> }>('contacts/merge', { method: 'POST', body: JSON.stringify({ principalId, duplicadoIds }) }),
  listas: () => req<ListaSalva[]>('contact-views'),
  criarLista: (d: { nome: string; filtros: FiltroContatos; colunas: string[]; ordem: OrdemContatos; compartilhada: boolean }) =>
    req<ListaSalva>('contact-views', { method: 'POST', body: JSON.stringify(d) }),
  atualizarLista: (id: string, d: Partial<{ nome: string; filtros: FiltroContatos; colunas: string[]; ordem: OrdemContatos; compartilhada: boolean }>) =>
    req<ListaSalva>(`contact-views/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  removerLista: (id: string) => req<{ ok: true }>(`contact-views/${id}`, { method: 'DELETE' }),
};

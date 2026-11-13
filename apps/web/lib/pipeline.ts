'use client';

import { clienteApi } from './session-fetch';
import { ApiError } from './api-error';

/**
 * Pipeline real (Q2.1): filtros na URL, visão Lista, motivo de perda e ações
 * em massa. Funções puras (filtros, ordenação, etapa de perda) ficam aqui para
 * serem testadas sem montar a tela.
 */
const req = clienteApi('/api/crm/');
const json = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/* ----------------------------- tipos ----------------------------- */

export type StatusFiltro = 'abertos' | 'ganhos' | 'perdidos' | 'todos';
export interface FiltrosPipeline {
  q?: string;
  /** identityId, ou `nenhum` (sem dono). */
  ownerId?: string;
  origem?: string;
  tag?: string;
  valorMin?: string;
  valorMax?: string;
  status?: StatusFiltro;
  criadoDe?: string;
  criadoAte?: string;
}
export const CHAVES_FILTRO = ['q', 'ownerId', 'origem', 'tag', 'valorMin', 'valorMax', 'status', 'criadoDe', 'criadoAte'] as const;
const STATUS: StatusFiltro[] = ['abertos', 'ganhos', 'perdidos', 'todos'];

export interface NegocioQuadro {
  id: string;
  titulo: string;
  contato: string;
  contactId: string | null;
  valor: number;
  origem: string;
  status: 'aberto' | 'ganho' | 'perdido' | string;
  stageId: string;
  ownerId: string | null;
  createdAt: string;
  ultimoContatoAt: string | null;
  motivoPerda: string | null;
}
export interface TotaisFunil {
  negocios: number; valor: number; abertos: number; valorAberto: number; ganhos: number; valorGanho: number; perdidos: number; valorPerdido: number;
}
export interface Quadro {
  pipelineId: string | null;
  pipelines: { id: string; nome: string; abertos: number }[];
  stages: { id: string; nome: string; cor: string; deals: NegocioQuadro[] }[];
  totais: TotaisFunil;
  opcoes: { origens: string[]; tags: string[] };
  truncado: boolean;
}
export interface MotivoPerda { id: string; nome: string; ativo: boolean; ordem: number; usos: number }
export interface DadosPerda { motivoPerdaId: string | null; motivoPerdaObs: string | null }

export type AcaoMassa = 'etapa' | 'dono' | 'ganho' | 'perdido' | 'excluir';
export interface ResultadoMassa { acao: AcaoMassa; alvo: number; afetados: number; ignorados: number }
export const LIMITE_MASSA = 1000;

/* ------------------------------ API ------------------------------ */

export const pipelineApi = {
  quadro: (pipelineId: string | undefined, filtros: FiltrosPipeline) => {
    const qs = paraQuery(filtros);
    if (pipelineId) qs.set('pipelineId', pipelineId);
    const s = qs.toString();
    return req<Quadro>(`pipeline${s ? `?${s}` : ''}`);
  },
  bulk: (ids: string[], acao: AcaoMassa, params: Record<string, unknown> = {}) => req<ResultadoMassa>('deals/bulk', json({ ids, acao, params })),
  motivos: (somenteAtivos = false) => req<MotivoPerda[]>(`lost-reasons${somenteAtivos ? '?ativos=true' : ''}`),
  criarMotivo: (nome: string) => req<{ id: string }>('lost-reasons', json({ nome })),
  atualizarMotivo: (id: string, data: { nome?: string; ativo?: boolean }) => req<{ ok: true }>(`lost-reasons/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reordenarMotivos: (ids: string[]) => req<{ ok: true }>('lost-reasons/ordem', json({ ids })),
  removerMotivo: (id: string) => req<{ ok: true }>(`lost-reasons/${id}`, { method: 'DELETE' }),
};

/** Mensagem legível de um erro da API (RFC 7807 `detail` primeiro). */
export function mensagemDeErro(e: unknown, padrao = 'Tente novamente.'): string {
  if (e instanceof ApiError) {
    const d = e.body?.detail ?? e.body?.message;
    if (typeof d === 'string' && d) return d;
    if (Array.isArray(d) && d.length) return d.join('; ');
  }
  return padrao;
}

/* ----------------------- filtros <-> URL ------------------------ */

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUM = /^\d+([.,]\d{1,2})?$/;

/**
 * Lê os filtros da URL descartando o que a API recusaria (link antigo ou
 * editado à mão não pode quebrar a tela com 400).
 */
export function filtrosDaUrl(sp: URLSearchParams): FiltrosPipeline {
  const f: FiltrosPipeline = {};
  const v = (k: string) => sp.get(k)?.trim() ?? '';
  if (v('q')) f.q = v('q').slice(0, 120);
  if (v('ownerId') === 'nenhum' || UUID.test(v('ownerId'))) f.ownerId = v('ownerId');
  if (v('origem')) f.origem = v('origem').slice(0, 80);
  if (v('tag')) f.tag = v('tag').slice(0, 40);
  if (NUM.test(v('valorMin'))) f.valorMin = v('valorMin').replace(',', '.');
  if (NUM.test(v('valorMax'))) f.valorMax = v('valorMax').replace(',', '.');
  if ((STATUS as string[]).includes(v('status'))) f.status = v('status') as StatusFiltro;
  if (DATA.test(v('criadoDe'))) f.criadoDe = v('criadoDe');
  if (DATA.test(v('criadoAte'))) f.criadoAte = v('criadoAte');
  return f;
}

/** Filtros → query string (sem chaves vazias; `status=abertos` é o padrão e não vai). */
export function paraQuery(f: FiltrosPipeline): URLSearchParams {
  const qs = new URLSearchParams();
  for (const k of CHAVES_FILTRO) {
    const valor = f[k]?.trim();
    if (!valor || (k === 'status' && valor === 'abertos')) continue;
    qs.set(k, valor);
  }
  return qs;
}

/** Filtros ligados (o chip "Limpar" só aparece com pelo menos um). */
export function contarFiltros(f: FiltrosPipeline): number {
  return [...paraQuery(f).keys()].length;
}

/** Faixa de valor invertida: a tela avisa antes de pedir à API. */
export function faixaInvalida(f: FiltrosPipeline): boolean {
  return !!f.valorMin && !!f.valorMax && Number(f.valorMin) > Number(f.valorMax);
}

/* ------------------------ etapa de perda ------------------------ */

const sem = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Etapa cujo nome diz que o negócio foi perdido ("Perdido", "Fechado / Perdido",
 * "Perdidos"). Etapa não tem tipo no schema; soltar um card nela é pedir para
 * marcar como perdido, então a tela pede o motivo antes de mover.
 */
export function ehEtapaDePerda(nome: string): boolean {
  return /\bperdid[oa]s?\b|\bperda\b/.test(sem(nome));
}

/* --------------------------- lista ------------------------------ */

export type ColunaOrdem = 'titulo' | 'contato' | 'etapa' | 'valor' | 'dono' | 'origem' | 'criado' | 'ultimoContato';
export interface Ordem { coluna: ColunaOrdem; dir: 'asc' | 'desc' }
export interface LinhaLista extends NegocioQuadro { etapa: string; cor: string; ordemEtapa: number; dono: string }

export function linhasDoQuadro(q: Pick<Quadro, 'stages'>, nomeDono: (id: string | null) => string): LinhaLista[] {
  return q.stages.flatMap((s, i) => s.deals.map((d) => ({ ...d, etapa: s.nome, cor: s.cor, ordemEtapa: i, dono: nomeDono(d.ownerId) })));
}

const texto = (a: string, b: string) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' });
const tempo = (d: string | null) => (d ? new Date(d).getTime() : Number.NEGATIVE_INFINITY);

/** Ordenação estável da visão Lista; vazio (sem dono, sem contato) vai para o fim. */
export function ordenarLinhas(linhas: LinhaLista[], o: Ordem): LinhaLista[] {
  const fator = o.dir === 'asc' ? 1 : -1;
  const cmp = (a: LinhaLista, b: LinhaLista): number => {
    switch (o.coluna) {
      case 'valor': return (a.valor - b.valor) * fator;
      case 'etapa': return (a.ordemEtapa - b.ordemEtapa) * fator;
      case 'criado': return (tempo(a.createdAt) - tempo(b.createdAt)) * fator;
      case 'ultimoContato': {
        if (!a.ultimoContatoAt || !b.ultimoContatoAt) return a.ultimoContatoAt ? -1 : b.ultimoContatoAt ? 1 : 0;
        return (tempo(a.ultimoContatoAt) - tempo(b.ultimoContatoAt)) * fator;
      }
      default: {
        const va = o.coluna === 'contato' ? (a.contato === '-' ? '' : a.contato) : String(a[o.coluna] ?? '');
        const vb = o.coluna === 'contato' ? (b.contato === '-' ? '' : b.contato) : String(b[o.coluna] ?? '');
        if (!va || !vb) return va ? -1 : vb ? 1 : 0;
        return texto(va, vb) * fator;
      }
    }
  };
  return linhas.map((l, i) => ({ l, i })).sort((x, y) => cmp(x.l, y.l) || x.i - y.i).map((x) => x.l);
}

/** Formato preferido do pipeline, lembrado por navegador (conveniência; nunca fonte de verdade). */
export const CHAVE_VISAO = 'khub.pipeline.visao';
export function lerVisao(): 'kanban' | 'lista' {
  try { return window.localStorage.getItem(CHAVE_VISAO) === 'lista' ? 'lista' : 'kanban'; } catch { return 'kanban'; }
}
export function gravarVisao(v: 'kanban' | 'lista') {
  try { window.localStorage.setItem(CHAVE_VISAO, v); } catch { /* navegação privada: segue sem lembrar */ }
}

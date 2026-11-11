'use client';

import { clienteApi } from './session-fetch';
import { ApiError } from './api-error';

/**
 * Campos personalizados (Q2.3): cliente de `/v1/crm/custom-fields` e as
 * regras de exibição compartilhadas pela tela de Configurações e pelo
 * componente `CamposPersonalizados` (perfil do contato, negócio, empresa).
 * A validação que vale é a da API; aqui só há a verificação rápida para o
 * formulário não mandar o óbvio errado.
 */

const req = clienteApi('/api/crm/');

export type EntidadeCampo = 'contact' | 'deal' | 'company';
export type TipoCampo = 'text' | 'textarea' | 'number' | 'money' | 'date' | 'select' | 'multiselect' | 'boolean' | 'phone' | 'email' | 'url';

export interface CampoDef {
  id: string;
  entidade: EntidadeCampo;
  chave: string;
  rotulo: string;
  tipo: TipoCampo;
  opcoes: string[];
  obrigatorio: boolean;
  ordem: number;
  grupo: string | null;
  arquivado: boolean;
  arquivadoEm: string | null;
}

export interface CampoInput {
  rotulo: string;
  tipo: TipoCampo;
  chave?: string;
  opcoes?: string[];
  obrigatorio?: boolean;
  grupo?: string | null;
}

export const ENTIDADES: { key: EntidadeCampo; label: string }[] = [
  { key: 'contact', label: 'Contatos' },
  { key: 'deal', label: 'Negócios' },
  { key: 'company', label: 'Empresas' },
];

export const TIPOS: { key: TipoCampo; label: string }[] = [
  { key: 'text', label: 'Texto curto' },
  { key: 'textarea', label: 'Texto longo' },
  { key: 'number', label: 'Número' },
  { key: 'money', label: 'Dinheiro (R$)' },
  { key: 'date', label: 'Data' },
  { key: 'select', label: 'Lista (uma opção)' },
  { key: 'multiselect', label: 'Lista (várias opções)' },
  { key: 'boolean', label: 'Sim ou não' },
  { key: 'phone', label: 'Telefone' },
  { key: 'email', label: 'E-mail' },
  { key: 'url', label: 'Link' },
];
export const rotuloTipo = (t: TipoCampo) => TIPOS.find((x) => x.key === t)?.label ?? t;
export const temOpcoes = (t: TipoCampo) => t === 'select' || t === 'multiselect';

export const customFields = {
  list: (entidade: EntidadeCampo) => req<CampoDef[]>(`custom-fields?entidade=${entidade}`),
  create: (entidade: EntidadeCampo, data: CampoInput) => req<CampoDef>('custom-fields', { method: 'POST', body: JSON.stringify({ entidade, ...data }) }),
  update: (id: string, data: Partial<CampoInput>) => req<CampoDef>(`custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  arquivar: (id: string) => req<CampoDef>(`custom-fields/${id}/arquivar`, { method: 'POST' }),
  restaurar: (id: string) => req<CampoDef>(`custom-fields/${id}/restaurar`, { method: 'POST' }),
  remove: (id: string) => req<{ ok: true }>(`custom-fields/${id}`, { method: 'DELETE' }),
  reordenar: (entidade: EntidadeCampo, ids: string[]) => req<CampoDef[]>('custom-fields/reordenar', { method: 'POST', body: JSON.stringify({ entidade, ids }) }),
};

/** Erros por campo devolvidos pela API (extensão `campos` do RFC 7807). */
export function errosDosCampos(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.body?.campos)) return {};
  const out: Record<string, string> = {};
  for (const c of e.body.campos as { chave?: unknown; erro?: unknown }[]) {
    if (typeof c.chave === 'string' && typeof c.erro === 'string') out[c.chave] = c.erro;
  }
  return out;
}

/** Mensagem legível de um erro da API (title do RFC 7807). */
export function mensagemErro(e: unknown, padrao: string): string {
  if (e instanceof ApiError) return e.message || padrao;
  return padrao;
}

export const vazio = (v: unknown) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** Valor gravado → texto de exibição no formato brasileiro. */
export function formatarValor(def: Pick<CampoDef, 'tipo'>, v: unknown): string {
  if (vazio(v)) return '';
  switch (def.tipo) {
    case 'money':
      return typeof v === 'number' ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : String(v);
    case 'number':
      return typeof v === 'number' ? v.toLocaleString('pt-BR') : String(v);
    case 'date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
    }
    case 'boolean':
      return v === true ? 'Sim' : v === false ? 'Não' : String(v);
    case 'multiselect':
      return Array.isArray(v) ? v.join(', ') : String(v);
    default:
      return String(v);
  }
}

/** Valor gravado → valor do controle de formulário. */
export function paraFormulario(def: Pick<CampoDef, 'tipo'>, v: unknown): string | boolean | string[] {
  if (def.tipo === 'boolean') return v === true;
  if (def.tipo === 'multiselect') return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  if (vazio(v)) return '';
  return String(v);
}

/** Valor do formulário → valor enviado à API (`null` limpa o campo). */
export function paraApi(def: Pick<CampoDef, 'tipo'>, v: string | boolean | string[]): unknown {
  if (def.tipo === 'boolean') return v === true;
  if (def.tipo === 'multiselect') return Array.isArray(v) && v.length ? v : null;
  const t = typeof v === 'string' ? v.trim() : '';
  if (!t) return null;
  if (def.tipo === 'number' || def.tipo === 'money') {
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) ? n : t;
  }
  return t;
}

/** Verificação rápida no cliente; devolve a mensagem ou null. */
export function checarValor(def: Pick<CampoDef, 'tipo' | 'obrigatorio' | 'rotulo'>, v: string | boolean | string[]): string | null {
  const enviado = paraApi(def, v);
  if (def.obrigatorio && def.tipo !== 'boolean' && vazio(enviado)) return 'Campo obrigatório';
  if (vazio(enviado)) return null;
  if ((def.tipo === 'number' || def.tipo === 'money') && typeof enviado !== 'number') return 'Informe um número';
  if (def.tipo === 'email' && typeof enviado === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(enviado)) return 'E-mail inválido';
  if (def.tipo === 'phone' && typeof enviado === 'string') {
    const d = enviado.replace(/\D/g, '');
    if (d.length < 8 || d.length > 15) return 'Telefone inválido';
  }
  return null;
}

/** Agrupa definições ativas pelo `grupo` (sem grupo primeiro), mantendo a ordem. */
export function agrupar(defs: CampoDef[]): { grupo: string | null; campos: CampoDef[] }[] {
  const grupos: { grupo: string | null; campos: CampoDef[] }[] = [];
  for (const d of defs) {
    const g = d.grupo?.trim() || null;
    let alvo = grupos.find((x) => x.grupo === g);
    if (!alvo) {
      alvo = { grupo: g, campos: [] };
      if (g === null) grupos.unshift(alvo);
      else grupos.push(alvo);
    }
    alvo.campos.push(d);
  }
  return grupos;
}

'use client';

import { ApiError } from './api-error';
import { clienteApi } from './session-fetch';
import type { CampoView, EstiloForm, TipoCampoPublico } from './publico/tipos';

/** Formulários (Q4.1), área autenticada: `/api/v1/forms/*` → API `/v1/forms/*`. */
const req = clienteApi('/api/v1/forms/');

export type CampoNativo = 'nome' | 'email' | 'telefone' | 'empresa';
export type Mapeamento = { tipo: 'nativo'; campo: CampoNativo } | { tipo: 'custom'; chave: string };

/** Campo completo (com o destino no CRM), como o construtor edita. */
export interface CampoForm extends CampoView {
  mapear?: Mapeamento | null;
}

export interface Formulario {
  id: string;
  nome: string;
  slug: string;
  campos: CampoForm[];
  estilo: EstiloForm;
  ativo: boolean;
  tag: string | null;
  stageId: string | null;
  totalRespostas: number;
  createdAt: string;
  updatedAt: string;
}

export type FormularioPatch = Partial<Pick<Formulario, 'nome' | 'slug' | 'campos' | 'estilo' | 'ativo' | 'tag' | 'stageId'>>;

export interface Envio {
  id: string;
  contactId: string | null;
  dealId: string | null;
  respostas: Record<string, unknown>;
  utm: Record<string, string>;
  createdAt: string;
}

export const formularios = {
  listar: () => req<Formulario[]>(''),
  obter: (id: string) => req<Formulario>(id),
  criar: (d: { nome: string } & FormularioPatch) => req<Formulario>('', { method: 'POST', body: JSON.stringify(d) }),
  atualizar: (id: string, d: FormularioPatch) => req<Formulario>(id, { method: 'PATCH', body: JSON.stringify(d) }),
  remover: (id: string) => req<{ ok: true }>(id, { method: 'DELETE' }),
  respostas: (id: string, cursor?: string) => req<{ items: Envio[]; nextCursor: string | null }>(`${id}/respostas${cursor ? `?cursor=${cursor}` : ''}`),
  /** Baixa o CSV gerado no servidor. */
  async exportarCsv(id: string, nome: string): Promise<void> {
    const r = await fetch(`/api/v1/forms/${id}/respostas/csv`, { cache: 'no-store' });
    if (!r.ok) throw new ApiError(r.status, await r.json().catch(() => ({})));
    const url = URL.createObjectURL(await r.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `respostas-${nome}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

/** Primeiro problema que a API devolveu (`problemas` do 400) ou a mensagem do erro. */
export function mensagemDeErro(e: unknown, padrao = 'Não foi possível salvar.'): string {
  if (e instanceof ApiError) {
    const p = e.body?.problemas;
    if (Array.isArray(p) && typeof p[0] === 'string') return p[0];
    return e.message || padrao;
  }
  return padrao;
}

/** Id novo para um campo (`text_k3f9`), no formato que a API aceita. */
export function novoIdCampo(tipo: TipoCampoPublico, existentes: string[]): string {
  for (;;) {
    const id = `${tipo}_${Math.random().toString(36).slice(2, 6)}`.replace(/[^a-z0-9_]/g, '');
    if (!existentes.includes(id)) return id;
  }
}

/** Campo novo de um tipo, com rótulo e destino sugeridos. */
export function campoNovo(tipo: TipoCampoPublico, existentes: CampoForm[]): CampoForm {
  const id = novoIdCampo(tipo, existentes.map((c) => c.id));
  const usado = (n: CampoNativo) => existentes.some((c) => c.mapear?.tipo === 'nativo' && c.mapear.campo === n);
  const base: CampoForm = { id, tipo, rotulo: 'Nova pergunta', obrigatorio: false, largura: 'inteira' };
  switch (tipo) {
    case 'email':
      return { ...base, rotulo: 'E-mail', mapear: usado('email') ? null : { tipo: 'nativo', campo: 'email' } };
    case 'phone':
      return { ...base, rotulo: 'Telefone', mapear: usado('telefone') ? null : { tipo: 'nativo', campo: 'telefone' } };
    case 'select':
    case 'multiselect':
      return { ...base, rotulo: 'Escolha uma opção', opcoes: ['Opção 1', 'Opção 2'] };
    case 'consentimento':
      return { ...base, rotulo: 'Autorizo o contato e o tratamento dos meus dados para este atendimento, conforme a LGPD.', obrigatorio: true };
    case 'checkbox':
      return { ...base, rotulo: 'Quero receber novidades' };
    case 'date':
      return { ...base, rotulo: 'Data' };
    case 'number':
      return { ...base, rotulo: 'Número' };
    case 'textarea':
      return { ...base, rotulo: 'Mensagem' };
    default:
      return base;
  }
}

/** Tipos de campo personalizado (Q2.3) que cada pergunta pode alimentar (espelho da API). */
export const COMPATIVEIS: Record<TipoCampoPublico, readonly string[]> = {
  text: ['text', 'textarea', 'url', 'phone', 'email'],
  textarea: ['textarea', 'text'],
  email: ['email', 'text'],
  phone: ['phone', 'text'],
  number: ['number', 'money', 'text'],
  date: ['date', 'text'],
  select: ['select', 'text'],
  multiselect: ['multiselect'],
  checkbox: ['boolean'],
  consentimento: [],
};
export const NATIVOS_POR_TIPO: Partial<Record<TipoCampoPublico, CampoNativo[]>> = {
  text: ['nome', 'empresa'],
  email: ['email'],
  phone: ['telefone'],
};
export const ROTULO_NATIVO: Record<CampoNativo, string> = { nome: 'Nome', email: 'E-mail', telefone: 'Telefone', empresa: 'Empresa' };

/** Link público, iframe e script de embed. */
export function codigosDeCompartilhar(origem: string, slug: string) {
  const link = `${origem}/f/${slug}`;
  return {
    link,
    iframe: `<iframe src="${link}/embed" title="Formulário" style="width:100%;min-height:640px;border:0" loading="lazy"></iframe>`,
    script: `<script src="${origem}/api/public/embed.js" data-khub-form="${slug}" async></script>`,
  };
}

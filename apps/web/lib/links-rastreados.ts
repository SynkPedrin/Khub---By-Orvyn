'use client';

import { clienteApi } from './session-fetch';

/**
 * Links rastreados de WhatsApp + métricas de atribuição por campanha.
 * Contratos: `apps/api/src/crm/links-rastreados.controller.ts` e
 * `apps/api/src/crm/atribuicao.controller.ts` (db/080 + db/066).
 *
 * A ideia: anúncio que cai no WhatsApp sem ser Click-to-WhatsApp (Google Ads
 * principalmente) chega sem referral. Cada campanha anuncia um link wa.me com
 * texto inicial único; quando a PRIMEIRA mensagem de um contato novo casa com
 * esse texto, a origem é gravada como confirmada.
 */
const req = clienteApi('/api/v1/crm/');

export const FONTES_LINK = ['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'outro'] as const;
export type FonteLink = (typeof FONTES_LINK)[number];

export interface LinkRastreado {
  id: string;
  codigo: string;
  campanha: string;
  fonte: FonteLink;
  conjunto: string | null;
  criativo: string | null;
  textoInicial: string;
  ativo: boolean;
  /** Contatos cuja atribuição veio deste link (sinal + cliqueId). */
  leads: number;
  /** wa.me com o texto inicial; null quando não há número conectado. */
  urlWhatsapp: string | null;
  /** Por que `urlWhatsapp` veio null (WhatsApp não conectado etc.). */
  aviso: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DadosLink {
  campanha: string;
  fonte: FonteLink;
  textoInicial: string;
  conjunto?: string | null;
  criativo?: string | null;
}
export type EdicaoLink = Partial<DadosLink & { ativo: boolean }>;

export interface MetricaCampanha {
  fonte: string;
  campanha: string | null;
  total: number;
  confirmada: number;
  provavel: number;
  desconhecida: number;
}
export interface MetricasCampanhas {
  de: string;
  ate: string;
  total: number;
  campanhas: MetricaCampanha[];
}

export const linksRastreados = {
  listar: () => req<LinkRastreado[]>('links-rastreados'),
  criar: (d: DadosLink) => req<LinkRastreado>('links-rastreados', { method: 'POST', body: JSON.stringify(d) }),
  atualizar: (id: string, d: EdicaoLink) => req<LinkRastreado>(`links-rastreados/${id}`, { method: 'PATCH', body: JSON.stringify(d) }),
  remover: (id: string) => req<{ ok: boolean }>(`links-rastreados/${id}`, { method: 'DELETE' }),
  metricas: (de: string, ate: string) => req<MetricasCampanhas>(`atribuicao/campanhas?de=${de}&ate=${ate}`),
};

/* ------------------------------------------------------------------ */
/* Lógica pura                                                         */
/* ------------------------------------------------------------------ */

/** Rótulos pt-BR das fontes do link (o select e a lista usam daqui). */
export const ROTULO_FONTE_LINK: Record<FonteLink, string> = {
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
  tiktok_ads: 'TikTok Ads',
  organico: 'Orgânico',
  outro: 'Outro',
};

/**
 * Rótulo da fonte nas MÉTRICAS de atribuição: além das fontes de link, a
 * atribuição grava fontes próprias (db/066) — whatsapp_direto, formulario…
 * Espelha o ROTULO_FONTE do backend. Fonte fora do mapa: 'Desconhecida'
 * (rótulo honesto, nunca chute).
 */
const ROTULO_FONTE_ATRIBUICAO: Record<string, string> = {
  ...ROTULO_FONTE_LINK,
  whatsapp_direto: 'WhatsApp direto',
  instagram_direto: 'Instagram direto',
  messenger_direto: 'Messenger direto',
  formulario: 'Formulário',
  indicacao: 'Indicação',
  importacao: 'Importação',
  manual: 'Cadastro manual',
  desconhecida: 'Desconhecida',
};

export function rotuloFonte(fonte: string | null | undefined): string {
  return (fonte && ROTULO_FONTE_ATRIBUICAO[fonte]) || 'Desconhecida';
}

export const ROTULO_CONFIANCA = { confirmada: 'Confirmada', provavel: 'Provável', desconhecida: 'Desconhecida' } as const;

/** Estado do formulário de criação/edição (tudo texto cru dos inputs). */
export interface FormularioLink {
  campanha: string;
  fonte: string;
  conjunto: string;
  criativo: string;
  textoInicial: string;
}

export type ErrosFormularioLink = Partial<Record<keyof FormularioLink, string>>;

/**
 * Valida o formulário com as MESMAS réguas do backend
 * (`links-rastreados.ts` da API): campanha obrigatória (máx. 160), texto
 * inicial de 3 a 400, conjunto/criativo opcionais até 160, fonte da lista.
 * Retorna {} quando está tudo certo.
 */
export function validarFormularioLink(f: FormularioLink): ErrosFormularioLink {
  const erros: ErrosFormularioLink = {};
  const campanha = f.campanha.replace(/\s+/g, ' ').trim();
  if (!campanha) erros.campanha = 'Campanha é obrigatória.';
  else if (campanha.length > 160) erros.campanha = 'Campanha pode ter no máximo 160 caracteres.';
  if (!(FONTES_LINK as readonly string[]).includes(f.fonte)) erros.fonte = 'Escolha a fonte do anúncio.';
  if (f.conjunto.trim().length > 160) erros.conjunto = 'Conjunto pode ter no máximo 160 caracteres.';
  if (f.criativo.trim().length > 160) erros.criativo = 'Criativo pode ter no máximo 160 caracteres.';
  const texto = f.textoInicial.trim();
  if (texto.length < 3) erros.textoInicial = 'Texto inicial precisa de pelo menos 3 caracteres.';
  else if (texto.length > 400) erros.textoInicial = 'Texto inicial pode ter no máximo 400 caracteres.';
  return erros;
}

/** Do formulário para o corpo da API: apara e transforma vazio em null. */
export function montarDadosLink(f: FormularioLink): DadosLink {
  const limpo = (v: string) => v.trim() || null;
  return {
    campanha: f.campanha.replace(/\s+/g, ' ').trim(),
    fonte: f.fonte as FonteLink,
    textoInicial: f.textoInicial.trim(),
    conjunto: limpo(f.conjunto),
    criativo: limpo(f.criativo),
  };
}

export const FORMULARIO_VAZIO: FormularioLink = { campanha: '', fonte: 'meta_ads', conjunto: '', criativo: '', textoInicial: '' };

export const PERIODOS_METRICA = [7, 30, 90] as const;
export type PeriodoMetrica = (typeof PERIODOS_METRICA)[number];

/**
 * Janela "últimos N dias terminando hoje" em YYYY-MM-DD no fuso do produto
 * (America/Sao_Paulo, mesma régua do backend — `diaSP`).
 */
export function periodoDias(dias: PeriodoMetrica, agora = new Date()): { de: string; ate: string } {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' });
  const ate = fmt.format(agora);
  const d = new Date(`${ate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (dias - 1));
  return { de: d.toISOString().slice(0, 10), ate };
}

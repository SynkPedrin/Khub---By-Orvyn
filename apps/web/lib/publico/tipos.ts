/**
 * Contratos das páginas PÚBLICAS (/f formulário, /b agendamento) — espelham
 * `apps/api/src/common/public-fields.ts`, `forms/forms.schema.ts` e
 * `booking/booking.schema.ts`. Sem 'use client': servem ao servidor e ao navegador.
 */

export const TIPOS_CAMPO = ['text', 'email', 'phone', 'textarea', 'select', 'multiselect', 'checkbox', 'date', 'number', 'consentimento'] as const;
export type TipoCampoPublico = (typeof TIPOS_CAMPO)[number];

export const ROTULO_TIPO: Record<TipoCampoPublico, string> = {
  text: 'Texto curto',
  email: 'E-mail',
  phone: 'Telefone',
  textarea: 'Texto longo',
  select: 'Lista de opções',
  multiselect: 'Múltipla escolha',
  checkbox: 'Caixa de seleção',
  date: 'Data',
  number: 'Número',
  consentimento: 'Consentimento LGPD',
};

/** Campo como a página pública recebe (sem mapeamento para o CRM). */
export interface CampoView {
  id: string;
  tipo: TipoCampoPublico;
  rotulo: string;
  obrigatorio: boolean;
  largura: 'inteira' | 'metade';
  placeholder?: string;
  ajuda?: string;
  opcoes?: string[];
}

export interface EstiloForm {
  cor?: string;
  logoUrl?: string;
  titulo?: string;
  descricao?: string;
  textoBotao?: string;
  mensagemSucesso?: string;
  redirecionarUrl?: string;
}

export interface FormPublico {
  nome: string;
  campos: CampoView[];
  estilo: EstiloForm;
  marca: { nome: string };
  carimbo: string;
}

export interface RespostaEnvio {
  ok: true;
  mensagem: string;
  redirecionarUrl: string | null;
}

export interface ErroCampoApi {
  campo: string;
  rotulo?: string;
  erro: string;
}

export interface BookingPublico {
  titulo: string;
  descricao: string | null;
  duracaoMin: number;
  fuso: string;
  local: string | null;
  janela: { primeiro: string; ultimo: string };
  dias: { data: string; horarios: number }[];
  perguntas: CampoView[];
  estilo: { cor?: string };
  marca: { nome: string };
  /** Página pessoal (CAL-PESSOAL): com quem o visitante vai falar. */
  responsavel: { nome: string } | null;
  carimbo: string;
}

export interface ReservaFeita {
  ok: true;
  token: string | null;
  reserva: { titulo: string; inicio: string; fim: string; local: string | null; status: string; fuso: string; marca: string } | null;
}

export interface ReservaPublica {
  titulo: string;
  slug: string;
  paginaAtiva: boolean;
  inicio: string;
  fim: string;
  status: string;
  local: string | null;
  fuso: string;
  duracaoMin: number;
  marca: { nome: string };
  estilo: { cor?: string };
  podeAlterar: boolean;
}

/** Corpo de erro RFC 7807 com as extensões que as páginas públicas usam. */
export interface ErroPublico {
  title?: string;
  code?: string;
  campos?: ErroCampoApi[];
}

/** POST/GET do navegador para o proxy público. Lança `ErroPublico` com status. */
export async function chamarPublico<T>(caminho: string, init?: { method?: 'GET' | 'POST'; body?: unknown }): Promise<T> {
  const r = await fetch(`/api/public/${caminho}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error((dados as ErroPublico).title ?? 'Não foi possível concluir. Tente de novo.'), { status: r.status, corpo: dados as ErroPublico });
  return dados as T;
}

export type ErroChamada = Error & { status?: number; corpo?: ErroPublico };

/** UTM e contexto da página onde o formulário/agenda está (também dentro de iframe). */
export function contextoDaPagina(): { pagina?: string; referrer?: string; utm: Record<string, string> } {
  if (typeof window === 'undefined') return { utm: {} };
  const qs = new URLSearchParams(window.location.search);
  // No embed, a página real do site chega em `_pagina` (o script repassa).
  const pagina = qs.get('_pagina') || window.location.href;
  const utm: Record<string, string> = {};
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid']) {
    const v = qs.get(k);
    if (v) utm[k] = v.slice(0, 200);
  }
  return { pagina, referrer: document.referrer || undefined, utm };
}

/** Cor da marca do tenant validada (só #RRGGBB); outra coisa não entra no estilo. */
export function corSegura(cor?: string): string | undefined {
  return cor && /^#[0-9a-fA-F]{6}$/.test(cor) ? cor : undefined;
}

/** Texto legível sobre a cor da marca: escuro em cor clara, claro em cor escura (tokens). */
export function textoSobre(cor: string): string {
  const n = parseInt(cor.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? 'var(--base-0)' : 'var(--text)';
}

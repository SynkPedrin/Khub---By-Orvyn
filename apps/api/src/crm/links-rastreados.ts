import { BadRequestException } from '@nestjs/common';
import type { FonteLead, Toque } from './atribuicao';

/**
 * Links rastreados de WhatsApp (db/080) — regras PURAS, testáveis.
 *
 * Por que existe: anúncio que cai no WhatsApp sem ser Click-to-WhatsApp
 * (Google Ads principalmente) chega sem `referral`. A saída padrão de
 * agência: cada campanha anuncia um link wa.me com texto inicial único;
 * quando a PRIMEIRA mensagem de um contato novo casa com esse texto, a
 * origem é gravada como confirmada com sinal 'link_rastreado'.
 */

/** Fontes permitidas pelo CHECK da tabela (db/080). */
export const FONTES_LINK = ['meta_ads', 'google_ads', 'tiktok_ads', 'organico', 'outro'] as const;
export type FonteLink = (typeof FONTES_LINK)[number];

/** O que o casamento precisa saber do link (subconjunto da linha). */
export interface LinkParaMatch {
  codigo: string;
  campanha: string;
  fonte: string;
  conjunto: string | null;
  criativo: string | null;
  textoInicial: string;
}

/** Colapso de espaços + minúsculas: a comparação ignora caixa e bordas. */
export function normalizarTexto(v: string): string {
  return v.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Casa a mensagem com UM dos links ativos: primeiro match exato do texto
 * inteiro; depois "mensagem começa com o texto_inicial" (o lead pode ter
 * editado/completado a mensagem). Entre prefixos, vence o mais longo —
 * é o mais específico. Sem candidato: null.
 */
export function casarLink(links: LinkParaMatch[], mensagem: string): LinkParaMatch | null {
  const msg = normalizarTexto(mensagem);
  if (!msg) return null;
  const exato = links.find((l) => normalizarTexto(l.textoInicial) === msg);
  if (exato) return exato;
  let melhor: LinkParaMatch | null = null;
  for (const l of links) {
    const t = normalizarTexto(l.textoInicial);
    if (t && msg.startsWith(t) && t.length > normalizarTexto(melhor?.textoInicial ?? '').length) melhor = l;
  }
  return melhor;
}

/**
 * `fonte` da tabela (CHECK do db/080) → FonteLead da atribuição (db/066).
 * 'organico' aqui significa "post/perfil orgânico que caiu no WhatsApp" —
 * o rótulo honesto na atribuição é whatsapp_direto; 'outro' não afirma nada.
 */
export function fonteDoLink(fonte: string): FonteLead {
  if (fonte === 'meta_ads' || fonte === 'google_ads' || fonte === 'tiktok_ads') return fonte;
  return fonte === 'organico' ? 'whatsapp_direto' : 'desconhecida';
}

/** Toque gravado quando a 1ª mensagem casa com o link (confirmada: o texto é o rastreador). */
export function toqueDeLink(link: LinkParaMatch, em = new Date()): Toque {
  return {
    fonte: fonteDoLink(link.fonte),
    canal: 'WhatsApp',
    confianca: 'confirmada',
    em: em.toISOString(),
    campanha: link.campanha,
    conjunto: link.conjunto ?? undefined,
    criativo: link.criativo ?? undefined,
    cliqueId: link.codigo,
    sinal: 'link_rastreado',
  };
}

/** "Progressiva — Black Friday 2026!" → "progressiva-black-friday-2026". 2–60 chars (CHECK do db/080). */
export function slugCodigo(campanha: string): string {
  const base = normalizarTexto(campanha)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return base.length >= 2 ? base : 'link';
}

/** Código informado pelo usuário: mesmas regras do slug gerado. */
export function validarCodigo(valor: string): string {
  const v = valor.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(v)) {
    throw new BadRequestException('código inválido: use 2–60 caracteres entre a-z, 0-9 e hífen, começando por letra ou número');
  }
  return v;
}

export function validarCampanha(valor: string): string {
  const v = (valor ?? '').replace(/\s+/g, ' ').trim();
  if (!v) throw new BadRequestException('campanha é obrigatória');
  if (v.length > 160) throw new BadRequestException('campanha pode ter no máximo 160 caracteres');
  return v;
}

export function validarTextoInicial(valor: string): string {
  const v = (valor ?? '').trim();
  if (v.length < 3) throw new BadRequestException('texto inicial precisa de pelo menos 3 caracteres');
  if (v.length > 400) throw new BadRequestException('texto inicial pode ter no máximo 400 caracteres');
  return v;
}

export function validarFonte(valor: string): FonteLink {
  if ((FONTES_LINK as readonly string[]).includes(valor)) return valor as FonteLink;
  throw new BadRequestException(`fonte inválida: use uma de ${FONTES_LINK.join(', ')}`);
}

/** Opcional de texto: vazio/indefinido vira null; demais vão aparados (máx. 160, como campanha). */
export function limparOpcional(valor: string | null | undefined): string | null {
  const v = (valor ?? '').trim();
  if (v.length > 160) throw new BadRequestException('conjunto/criativo podem ter no máximo 160 caracteres');
  return v || null;
}

/**
 * URL pronta para o anúncio: wa.me exige só dígitos com DDI e o texto
 * url-encoded. Sem número (instância não conectada) o serviço devolve null.
 */
export function montarUrlWhatsapp(numero: string, textoInicial: string): string | null {
  const digitos = numero.replace(/\D/g, '');
  if (digitos.length < 10 || digitos.length > 15) return null;
  return `https://wa.me/${digitos}?text=${encodeURIComponent(textoInicial)}`;
}

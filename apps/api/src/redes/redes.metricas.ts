import type { MetricasPost, PontoSerie, PostRede } from './redes.tipos';

/**
 * Cálculos puros do painel de redes. Regra de ouro: sem dado da rede, o
 * resultado é `null` (a tela mostra "sem dado"), nunca zero inventado.
 */

const arred = (n: number, casas = 2) => Math.round(n * 10 ** casas) / 10 ** casas;

/**
 * Taxa de engajamento (%) = (curtidas + comentários + compartilhamentos + salvamentos) / base × 100.
 * Base = alcance quando a rede informa (Instagram); senão visualizações (TikTok, YouTube).
 * Interações ausentes não contam; se TODAS faltam, ou a base é nula/zero, devolve null.
 */
export function taxaEngajamento(m: Pick<MetricasPost, 'curtidas' | 'comentarios' | 'compartilhamentos' | 'salvamentos' | 'alcance' | 'visualizacoes'>): number | null {
  const interacoes = [m.curtidas, m.comentarios, m.compartilhamentos, m.salvamentos].filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!interacoes.length) return null;
  const base = m.alcance && m.alcance > 0 ? m.alcance : m.visualizacoes && m.visualizacoes > 0 ? m.visualizacoes : null;
  if (!base) return null;
  return arred((interacoes.reduce((a, b) => a + b, 0) / base) * 100);
}

/** Completa as métricas com o engajamento calculado. */
export function comEngajamento(m: Omit<MetricasPost, 'engajamento'>): MetricasPost {
  return { ...m, engajamento: taxaEngajamento(m) };
}

/** Variação percentual entre dois valores reais; null sem base de comparação. */
export function variacao(atual: number | null | undefined, anterior: number | null | undefined): number | null {
  if (atual == null || anterior == null || !Number.isFinite(atual) || !Number.isFinite(anterior) || anterior === 0) return null;
  return arred(((atual - anterior) / Math.abs(anterior)) * 100, 1);
}

/** Crescimento entre o primeiro e o último ponto da série (absoluto e %). */
export function crescimento(serie: PontoSerie[]): { absoluto: number | null; percentual: number | null } {
  const ord = [...serie].sort((a, b) => a.dia.localeCompare(b.dia));
  if (ord.length < 2) return { absoluto: null, percentual: null };
  const ini = ord[0].valor;
  const fim = ord[ord.length - 1].valor;
  return { absoluto: fim - ini, percentual: variacao(fim, ini) };
}

/** Série de seguidores a partir das fotos diárias (ignora dias sem número, ordena por dia). */
export function serieDeSnapshots(snaps: { dia: string; seguidores: number | null }[]): PontoSerie[] {
  return snaps
    .filter((s): s is { dia: string; seguidores: number } => typeof s.seguidores === 'number' && Number.isFinite(s.seguidores))
    .map((s) => ({ dia: s.dia, valor: s.seguidores }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/** Seguidores acumulados a partir de ganho/perda diários (YouTube Analytics), ancorados no total atual. */
export function serieAcumulada(diario: { dia: string; ganho: number; perda: number }[], totalAtual: number | null): PontoSerie[] {
  if (totalAtual == null || !diario.length) return [];
  const ord = [...diario].sort((a, b) => a.dia.localeCompare(b.dia));
  const liquidoTotal = ord.reduce((s, d) => s + d.ganho - d.perda, 0);
  let acumulado = totalAtual - liquidoTotal;
  return ord.map((d) => {
    acumulado += d.ganho - d.perda;
    return { dia: d.dia, valor: acumulado };
  });
}

/** Soma de uma métrica; null se nenhum post tem o número. */
export function somar(posts: PostRede[], chave: keyof Omit<MetricasPost, 'engajamento'>): number | null {
  const v = posts.map((p) => p.metricas[chave]).filter((x): x is number => typeof x === 'number');
  return v.length ? v.reduce((a, b) => a + b, 0) : null;
}

/** Média do engajamento dos posts que têm o número. */
export function engajamentoMedio(posts: PostRede[]): number | null {
  const v = posts.map((p) => p.metricas.engajamento).filter((x): x is number => typeof x === 'number');
  return v.length ? arred(v.reduce((a, b) => a + b, 0) / v.length) : null;
}

/**
 * Melhores posts: maior engajamento; empate (ou sem engajamento) por
 * visualizações, depois curtidas. Posts sem nenhum número ficam de fora.
 */
export function rankear(posts: PostRede[], limite = 5): PostRede[] {
  const num = (v: number | null) => (typeof v === 'number' ? v : -1);
  return posts
    .filter((p) => p.metricas.engajamento != null || p.metricas.visualizacoes != null || p.metricas.curtidas != null)
    .sort((a, b) => num(b.metricas.engajamento) - num(a.metricas.engajamento) || num(b.metricas.visualizacoes) - num(a.metricas.visualizacoes) || num(b.metricas.curtidas) - num(a.metricas.curtidas))
    .slice(0, limite);
}

/** Duração ISO 8601 do YouTube (`PT1H2M3S`, `P1DT2S`) em segundos; null se inválida. */
export function duracaoIso(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso);
  if (!m || iso === 'P' || iso === 'PT') return null;
  const [, d, h, mi, s] = m.map((x) => (x ? Number(x) : 0));
  return d * 86400 + h * 3600 + mi * 60 + s;
}

/** Dia `YYYY-MM-DD` em UTC. */
export function diaUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Posts dentro da janela [desde, agora]. */
export function noPeriodo(posts: PostRede[], desde: Date): PostRede[] {
  return posts.filter((p) => p.publicadoEm && new Date(p.publicadoEm).getTime() >= desde.getTime());
}

/**
 * Parse das métricas de PÚBLICO e de DESCOBERTA do Instagram (IG User Insights
 * com `breakdown`). Puro: recebe o JSON da Graph API, devolve listas prontas.
 *
 * Doc oficial (DOC_REDES.igInsightsConta, conferida em 2026-11-13, exemplos v27.0):
 *  - `follower_demographics`: period=lifetime, metric_type=total_value,
 *    `timeframe` obrigatório, breakdown age|city|country|gender. Não vem com
 *    menos de 100 seguidores; só os 45 maiores valores.
 *  - `follows_and_unfollows` (breakdown follow_type), `profile_links_taps`
 *    (breakdown contact_button_type), `reach` (breakdown media_product_type
 *    ou follow_type): period=day, metric_type=total_value, since/until.
 * Forma da resposta com breakdown:
 *   { data: [{ name, total_value: { value?, breakdowns: [{ dimension_keys: [...],
 *     results: [{ dimension_values: [...], value }] }] } }] }
 * `dimension_keys` pode incluir `timeframe`: o valor da dimensão pedida é o da
 * MESMA posição de `dimension_keys`.
 */

export interface Fatia {
  chave: string;
  valor: number;
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Fatias de UMA dimensão (`age`, `gender`, `follow_type`…), ordenadas do maior para o menor. */
export function parseBreakdown(j: unknown, dimensao: string): Fatia[] {
  const metrica = obj(arr(obj(j)?.data)[0]);
  const bd = arr(obj(metrica?.total_value)?.breakdowns);
  const somas = new Map<string, number>();
  for (const b of bd) {
    const chaves = arr(obj(b)?.dimension_keys).map(String);
    const pos = chaves.indexOf(dimensao);
    for (const r of arr(obj(b)?.results)) {
      const vals = arr(obj(r)?.dimension_values).map(String);
      const chave = pos >= 0 ? vals[pos] : vals[vals.length - 1];
      const valor = Number(obj(r)?.value);
      if (!chave || !Number.isFinite(valor)) continue;
      somas.set(chave, (somas.get(chave) ?? 0) + valor);
    }
  }
  return [...somas.entries()].map(([chave, valor]) => ({ chave, valor })).sort((a, b) => b.valor - a.valor);
}

/** Total do período (`total_value.value`), ou a soma das fatias quando só vem o breakdown. */
export function parseTotal(j: unknown, dimensao?: string): number | null {
  const metrica = obj(arr(obj(j)?.data)[0]);
  const v = Number(obj(metrica?.total_value)?.value);
  if (Number.isFinite(v)) return v;
  if (!dimensao) return null;
  const f = parseBreakdown(j, dimensao);
  return f.length ? f.reduce((s, x) => s + x.valor, 0) : null;
}

const GENERO: Record<string, string> = { F: 'Mulheres', M: 'Homens', U: 'Não informado' };
/** Idade em ordem de faixa (não de tamanho), como o operador lê. */
export function ordenarIdade(f: Fatia[]): Fatia[] {
  return [...f].sort((a, b) => (parseInt(a.chave, 10) || 999) - (parseInt(b.chave, 10) || 999));
}
export const rotuloGenero = (c: string) => GENERO[c] ?? c;

const BOTAO: Record<string, string> = {
  CALL: 'Ligar', TEXT: 'Mensagem', DIRECTION: 'Como chegar', EMAIL: 'E-mail', BOOK_NOW: 'Agendar',
  INSTANT_EXPERIENCE: 'Experiência instantânea', UNDEFINED: 'Outros',
};
export const rotuloBotao = (c: string) => BOTAO[c] ?? c;

const FORMATO: Record<string, string> = { POST: 'Posts', REEL: 'Reels', REELS: 'Reels', STORY: 'Stories', CAROUSEL_CONTAINER: 'Carrosséis', AD: 'Anúncios', FEED: 'Feed' };
export const rotuloFormato = (c: string) => FORMATO[c] ?? c;

const SEGUE: Record<string, string> = { FOLLOWER: 'Seguidores', NON_FOLLOWER: 'Não seguidores', UNKNOWN: 'Não identificado' };
export const rotuloSegue = (c: string) => SEGUE[c] ?? c;

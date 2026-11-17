import { ApiError } from '@/lib/api-error';

export { parseValor, lerValor, lerPercentual, valorParaCampo } from '@/lib/dinheiro';

export const money = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Data de competência (coluna DATE): vem como "2026-11-17" ou "2026-11-17T00:00:00.000Z"; nunca converter por fuso (a meia-noite UTC virava o dia anterior em Brasília). */
export const dataBR = (iso: string) => (/^\d{4}-\d{2}-\d{2}(T00:00:00(\.000)?Z)?$/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : new Date(iso).toLocaleDateString('pt-BR'));

/** Primeiro e último dia do mês (YYYY-MM-DD), para filtro de período. */
export function mesAtual(): { de: string; ate: string } {
  const h = new Date();
  const de = `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = new Date(h.getFullYear(), h.getMonth() + 1, 0);
  const ate = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`;
  return { de, ate };
}

/** Competência YYYY-MM do mês atual. */
export function competenciaAtual(): string {
  const h = new Date();
  return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, '0')}`;
}

/** Primeiro e último dia do mês de `ref` (YYYY-MM-DD). */
export function mesDe(ref: Date): { de: string; ate: string } {
  const de = `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, '0')}-01`;
  const fim = new Date(ref.getFullYear(), ref.getMonth() + 1, 0);
  const ate = `${fim.getFullYear()}-${String(fim.getMonth() + 1).padStart(2, '0')}-${String(fim.getDate()).padStart(2, '0')}`;
  return { de, ate };
}

/** Anda `delta` meses a partir do mês do período atual. */
export function navegarMes(periodo: { de: string; ate: string }, delta: number): { de: string; ate: string } {
  const base = new Date(`${periodo.de}T12:00:00`);
  base.setMonth(base.getMonth() + delta);
  return mesDe(base);
}

/** "novembro de 2026" a partir do início do período. */
export function rotuloMes(periodo: { de: string }): string {
  return new Date(`${periodo.de}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

/** true quando o período é exatamente o mês corrente. */
export function ehMesAtual(periodo: { de: string; ate: string }): boolean {
  const m = mesAtual();
  return periodo.de === m.de && periodo.ate === m.ate;
}

export const ORIGEM_LABEL: Record<string, string> = {
  manual: 'Manual',
  agenda: 'Agenda',
  cobranca: 'Cobrança',
  importacao: 'Importação',
  comissao: 'Comissão',
};

export const SEM_PERMISSAO = 'Você não tem permissão para ver esta área do Financeiro. Peça acesso a um administrador.';

/** Falha de carregamento: 403 vira o estado "sem permissão"; o resto, erro com nova tentativa. */
export type FalhaCarga = { tipo: 'permissao' } | { tipo: 'erro'; mensagem: string };

export function falhaDeCarga(e: unknown, oque: string): FalhaCarga {
  if (e instanceof ApiError && e.status === 403) return { tipo: 'permissao' };
  return { tipo: 'erro', mensagem: mensagemFin(e, `carregar ${oque}`) };
}

/**
 * Mensagem para a pessoa a partir do erro da API. O título RFC 7807 já vem
 * em português e diz o que corrigir (ex.: 409 "a comissão desta entrada já
 * foi paga..."); sem ele, uma frase genérica com a ação.
 */
export function mensagemFin(e: unknown, acao: string): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'Sua sessão expirou. Entre de novo para continuar.';
    if (e.status === 403) return 'Você não tem permissão para fazer isso. Peça a um administrador.';
    if (e.status === 429) return 'Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo.';
    const titulo = typeof e.body?.title === 'string' ? e.body.title.trim() : '';
    if (e.status < 500 && titulo && !/exception$/i.test(titulo)) return `Não consegui ${acao}: ${titulo}.`.replace(/\.\.$/, '.');
  }
  return `Não consegui ${acao}. Tente de novo em instantes.`;
}

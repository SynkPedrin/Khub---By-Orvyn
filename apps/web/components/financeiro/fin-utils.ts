import { ApiError } from '@/lib/api-error';

export { parseValor, lerValor, lerPercentual, valorParaCampo } from '@/lib/dinheiro';

export const money = (centavos: number) => (centavos / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const dataBR = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR');

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

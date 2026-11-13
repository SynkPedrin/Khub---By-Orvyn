import type { CampoPerfil } from '../config/agent-config';

/**
 * POLÍTICA DE ATUALIZAÇÃO DO PERFIL (Customer Intelligence §8.1)
 * ==============================================================
 *
 * Decide, para cada extração, se ela vira o valor atual do campo. Regras:
 *  1. Fato CONFIRMADO (humano, CRM ou declarado com alta confiança) não é
 *     sobrescrito por INFERÊNCIA — nunca.
 *  2. Confirmado só é substituído por outro DECLARADO com confiança ≥ à atual
 *     (o contato corrigiu: "na verdade meu e-mail é…").
 *  3. Campo fora de `camposAutomaticos` vira `pendente_revisao` (a equipe vê
 *     no perfil e confirma ou rejeita).
 *  4. Abaixo do limiar de confiança: registrado no histórico, não aplicado.
 *  5. Campo de lista (objeções, problemas secundários, necessidades…) ACUMULA
 *     valores distintos em vez de substituir.
 */

export interface FatoAtual {
  valor: unknown;
  origem: 'declarado' | 'inferido' | 'humano' | 'crm';
  confianca: number;
  status: 'confirmado' | 'pendente' | 'rejeitado';
}

export interface ExtracaoEntrada {
  campo: CampoPerfil;
  valor: string;
  origem: 'declarado' | 'inferido';
  confianca: number;
}

export type Decisao = 'aplicado' | 'pendente_revisao' | 'ignorado_confirmado' | 'ignorado_confianca' | 'ignorado_politica';

export interface ResultadoDecisao {
  decisao: Decisao;
  motivo: string;
  /** Valor final a gravar (para listas, já acumulado). */
  valorFinal?: unknown;
  statusFinal?: FatoAtual['status'];
}

export const CAMPOS_LISTA: ReadonlySet<CampoPerfil> = new Set(['problemas_secundarios', 'objetivos', 'necessidades', 'objecoes', 'preferencias']);
/** Declarado com confiança a partir disto nasce confirmado. */
export const CONFIANCA_CONFIRMA = 0.85;
/** Valor rejeitado por humano não volta pela mesma inferência. */
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

function acumular(atual: unknown, novo: string): string[] {
  const lista = Array.isArray(atual) ? atual.map(String) : typeof atual === 'string' && atual ? [atual] : [];
  const partes = novo.split(/\s*[,;]\s*/).map((p) => p.trim()).filter(Boolean);
  const vistos = new Set(lista.map(norm));
  for (const p of partes) if (!vistos.has(norm(p))) {
    lista.push(p);
    vistos.add(norm(p));
  }
  return lista.slice(-12);
}

export function decidirExtracao(
  e: ExtracaoEntrada,
  atual: FatoAtual | null,
  politica: { camposAutomaticos: readonly string[]; limiarConfianca: number },
): ResultadoDecisao {
  if (e.confianca < politica.limiarConfianca && e.origem === 'inferido') {
    return { decisao: 'ignorado_confianca', motivo: `inferência com confiança ${e.confianca.toFixed(2)} abaixo do limiar ${politica.limiarConfianca}` };
  }
  if (e.confianca < Math.min(politica.limiarConfianca, 0.5)) {
    return { decisao: 'ignorado_confianca', motivo: `confiança ${e.confianca.toFixed(2)} muito baixa` };
  }
  const lista = CAMPOS_LISTA.has(e.campo);
  if (atual?.status === 'rejeitado' && norm(String(atual.valor)) === norm(e.valor)) {
    return { decisao: 'ignorado_politica', motivo: 'valor já rejeitado por um humano' };
  }
  if (atual && atual.status === 'confirmado' && !lista) {
    if (norm(String(atual.valor)) === norm(e.valor)) return { decisao: 'ignorado_confirmado', motivo: 'mesmo valor já confirmado' };
    if (e.origem === 'inferido') return { decisao: 'ignorado_confirmado', motivo: 'inferência não sobrescreve fato confirmado' };
    if (atual.origem === 'humano') return { decisao: 'pendente_revisao', motivo: 'contradiz valor confirmado por humano: precisa de revisão', valorFinal: e.valor, statusFinal: 'pendente' };
    if (e.confianca < atual.confianca) return { decisao: 'ignorado_confirmado', motivo: 'declaração com confiança menor que a do fato confirmado' };
  }
  const automatico = politica.camposAutomaticos.includes(e.campo);
  const valorFinal = lista ? acumular(atual?.valor, e.valor) : e.valor;
  if (!automatico) {
    return { decisao: 'pendente_revisao', motivo: 'campo exige revisão humana (fora dos campos automáticos)', valorFinal, statusFinal: 'pendente' };
  }
  const statusFinal: FatoAtual['status'] = e.origem === 'declarado' && e.confianca >= CONFIANCA_CONFIRMA ? 'confirmado' : atual?.status === 'confirmado' ? 'confirmado' : 'pendente';
  return { decisao: 'aplicado', motivo: e.origem === 'declarado' ? 'declarado pelo contato' : 'inferido pela conversa', valorFinal, statusFinal };
}

/** Texto do fato para prompt/regras (listas viram "a, b, c"). */
export function valorTexto(v: unknown): string {
  if (Array.isArray(v)) return v.map(String).join(', ');
  if (v === null || v === undefined) return '';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

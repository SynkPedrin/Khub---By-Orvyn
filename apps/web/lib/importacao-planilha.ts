import { lerCsv } from './csv';
import { lerXlsx } from './xlsx';

/** Limite de linhas por requisição de importação (igual ao da API). */
export const TAMANHO_LOTE = 500;

/**
 * Bytes de um CSV → texto. Tenta UTF-8 estrito (com ou sem BOM); se houver
 * byte inválido, o arquivo é Latin-1/Windows-1252 (o Avec e o Excel antigo
 * exportam assim) e decodifica como windows-1252.
 */
export function decodificarTexto(buf: ArrayBuffer): string {
  let b = new Uint8Array(buf);
  if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) b = b.subarray(3);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return new TextDecoder('windows-1252').decode(b);
  }
}

export class FormatoNaoSuportado extends Error {}

/** Lê CSV/TXT ou XLSX e devolve a matriz [cabeçalho, ...linhas]. */
export async function lerPlanilha(nome: string, buf: ArrayBuffer): Promise<string[][]> {
  const n = nome.toLowerCase();
  if (n.endsWith('.xls')) {
    throw new FormatoNaoSuportado('Arquivo .xls (formato antigo do Excel) não é lido aqui. Abra no Excel ou no Google Planilhas e salve como .xlsx ou CSV.');
  }
  const b = new Uint8Array(buf);
  const ehZip = b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
  if (n.endsWith('.xlsx') || ehZip) return lerXlsx(buf);
  return lerCsv(decodificarTexto(buf));
}

/** Fatia em lotes; `inicio` é o índice (base 0) da primeira linha do lote. */
export function lotes<T>(itens: T[], tamanho = TAMANHO_LOTE): { inicio: number; itens: T[] }[] {
  const out: { inicio: number; itens: T[] }[] = [];
  for (let i = 0; i < itens.length; i += tamanho) out.push({ inicio: i, itens: itens.slice(i, i + tamanho) });
  return out;
}

const normalizarValor = (v: unknown) => String(v ?? '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Marca cada linha com `ocorrencia`: quantas linhas IGUAIS (mesmo conteúdo
 * normalizado) já apareceram no arquivo até ela, contando a própria (base 1).
 * Duas vendas idênticas no mesmo dia viram ocorrência 1 e 2 e ambas entram;
 * reimportar o mesmo arquivo gera as mesmas chaves e a API ignora as repetidas.
 */
export function comOcorrencia<T extends Record<string, unknown>>(linhas: T[]): (T & { ocorrencia: number })[] {
  const vistos = new Map<string, number>();
  return linhas.map((l) => {
    const chave = JSON.stringify(Object.keys(l).filter((k) => k !== 'ocorrencia').sort().map((k) => [k, normalizarValor(l[k])]));
    const n = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, n);
    return { ...l, ocorrencia: n };
  });
}

export interface ProblemaLinha { linha: number; motivo: string }

/** Relatório de erros/avisos em CSV (separado por ";" para abrir direto no Excel pt-BR). */
export function relatorioProblemasCsv(erros: ProblemaLinha[], avisos: ProblemaLinha[]): string {
  const esc = (s: string) => (/[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const linhas = [
    ...erros.map((e) => ({ ...e, tipo: 'erro' })),
    ...avisos.map((a) => ({ ...a, tipo: 'aviso' })),
  ].sort((a, b) => a.linha - b.linha);
  return ['linha;tipo;motivo', ...linhas.map((l) => `${l.linha};${l.tipo};${esc(l.motivo)}`)].join('\r\n');
}

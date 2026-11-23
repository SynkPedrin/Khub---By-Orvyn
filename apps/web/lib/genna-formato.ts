import type { FerramentaGenna, PropriedadeSchema } from './genna';

/**
 * Funções puras do painel do Genna (ADR-0053). O Genna é quem define as
 * ferramentas e os parâmetros (JSON Schema do `tools/list`); a tela monta o
 * formulário e desenha o resultado a partir disso, sem campo inventado.
 */

export type ValorCampo = string | boolean;

export function tipoDe(p: PropriedadeSchema): 'texto' | 'numero' | 'inteiro' | 'booleano' | 'lista' | 'escolha' | 'json' {
  if (Array.isArray(p.enum) && p.enum.length) return 'escolha';
  const t = Array.isArray(p.type) ? p.type.find((x) => x !== 'null') : p.type;
  if (t === 'string') return 'texto';
  if (t === 'number') return 'numero';
  if (t === 'integer') return 'inteiro';
  if (t === 'boolean') return 'booleano';
  if (t === 'array' && (p.items?.type === 'string' || p.items?.type === undefined)) return 'lista';
  return 'json';
}

export function campos(f: FerramentaGenna): { chave: string; prop: PropriedadeSchema; obrigatorio: boolean }[] {
  const props = f.parametros?.properties ?? {};
  const req = new Set(f.parametros?.required ?? []);
  return Object.entries(props)
    .map(([chave, prop]) => ({ chave, prop, obrigatorio: req.has(chave) }))
    .sort((a, b) => Number(b.obrigatorio) - Number(a.obrigatorio));
}

export function valoresIniciais(f: FerramentaGenna): Record<string, ValorCampo> {
  const v: Record<string, ValorCampo> = {};
  for (const { chave, prop } of campos(f)) {
    const d = prop.default;
    const tipo = tipoDe(prop);
    if (tipo === 'booleano') v[chave] = d === true;
    else if (d === undefined || d === null) v[chave] = '';
    else if (tipo === 'lista' && Array.isArray(d)) v[chave] = d.join(', ');
    else if (tipo === 'json') v[chave] = JSON.stringify(d, null, 2);
    else v[chave] = String(d);
  }
  return v;
}

/** Converte o que a pessoa digitou nos tipos do schema. Campo vazio não vai. */
export function montarArgumentos(f: FerramentaGenna, valores: Record<string, ValorCampo>): { ok: true; args: Record<string, unknown> } | { ok: false; erro: string } {
  const args: Record<string, unknown> = {};
  for (const { chave, prop, obrigatorio } of campos(f)) {
    const bruto = valores[chave];
    const tipo = tipoDe(prop);
    if (tipo === 'booleano') {
      if (bruto === true || obrigatorio || prop.default !== undefined) args[chave] = bruto === true;
      continue;
    }
    const s = typeof bruto === 'string' ? bruto.trim() : '';
    if (!s) {
      if (obrigatorio) return { ok: false, erro: `Preencha "${rotulo(chave)}".` };
      continue;
    }
    if (tipo === 'numero' || tipo === 'inteiro') {
      const n = Number(s.replace(',', '.'));
      if (!Number.isFinite(n) || (tipo === 'inteiro' && !Number.isInteger(n))) return { ok: false, erro: `"${rotulo(chave)}" precisa ser um número${tipo === 'inteiro' ? ' inteiro' : ''}.` };
      args[chave] = n;
    } else if (tipo === 'lista') {
      args[chave] = s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
    } else if (tipo === 'json') {
      try {
        args[chave] = JSON.parse(s);
      } catch {
        return { ok: false, erro: `"${rotulo(chave)}" precisa ser JSON válido.` };
      }
    } else if (tipo === 'escolha') {
      const opc = (prop.enum ?? []).find((o) => String(o) === s);
      args[chave] = opc === undefined ? s : opc;
    } else {
      args[chave] = s;
    }
  }
  return { ok: true, args };
}

/** `follower_count` / `followerCount` → "Follower count". */
export function rotulo(chave: string): string {
  const s = chave.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s ? s[0]!.toUpperCase() + s.slice(1) : chave;
}

type Escalar = string | number | boolean | null;
const escalar = (v: unknown): v is Escalar => v === null || ['string', 'number', 'boolean'].includes(typeof v);
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export interface Tabela {
  titulo: string | null;
  colunas: string[];
  linhas: Record<string, unknown>[];
}

export interface FormaDados {
  /** Números e textos curtos do primeiro nível (viram cartões). */
  destaques: { chave: string; valor: Escalar }[];
  /** Listas de objetos (posts, formatos, dias...) viram tabela. */
  tabelas: Tabela[];
  /** O que não cabe nos dois acima, mostrado como JSON. */
  resto: Record<string, unknown> | unknown[] | null;
}

const MAX_COLUNAS = 8;

function tabelaDe(titulo: string | null, lista: unknown[]): Tabela | null {
  const objs = lista.filter(objeto);
  if (!objs.length || objs.length !== lista.length) return null;
  const freq = new Map<string, number>();
  for (const o of objs) for (const [k, v] of Object.entries(o)) if (escalar(v)) freq.set(k, (freq.get(k) ?? 0) + 1);
  const colunas = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_COLUNAS).map(([k]) => k);
  return colunas.length ? { titulo, colunas, linhas: objs } : null;
}

export function formaDosDados(dados: unknown): FormaDados {
  const forma: FormaDados = { destaques: [], tabelas: [], resto: null };
  if (dados === null || dados === undefined) return forma;
  if (Array.isArray(dados)) {
    const t = tabelaDe(null, dados);
    if (t) forma.tabelas.push(t);
    else forma.resto = dados;
    return forma;
  }
  if (!objeto(dados)) {
    forma.destaques.push({ chave: 'valor', valor: escalar(dados) ? dados : String(dados) });
    return forma;
  }
  const resto: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(dados)) {
    if (escalar(v) && !(typeof v === 'string' && v.length > 140)) forma.destaques.push({ chave: k, valor: v });
    else if (Array.isArray(v) && tabelaDe(rotulo(k), v)) forma.tabelas.push(tabelaDe(rotulo(k), v)!);
    else if (objeto(v) && Object.values(v).every((x) => typeof x === 'number')) {
      // Métricas agrupadas ({ alcance: 10, salvamentos: 3 }): sobem para os destaques com prefixo.
      for (const [k2, v2] of Object.entries(v)) forma.destaques.push({ chave: `${k}.${k2}`, valor: v2 as number });
    } else resto[k] = v;
  }
  forma.resto = Object.keys(resto).length ? resto : null;
  return forma;
}

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/** Texto de célula/cartão em pt-BR. */
export function textoValor(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('pt-BR', { maximumFractionDigits: Number.isInteger(v) ? 0 : 2 });
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'string' && ISO.test(v)) {
    const d = new Date(v.length === 10 ? `${v}T12:00:00` : v);
    if (!Number.isNaN(d.getTime())) return v.length === 10 ? d.toLocaleDateString('pt-BR') : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

export const ehUrl = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/\S+$/.test(v);
export const ehImagem = (v: unknown): v is string => ehUrl(v) && /\.(png|jpe?g|webp|gif)(\?|$)/i.test(v);

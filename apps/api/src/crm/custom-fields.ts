import type { Prisma } from '@prisma/client';

/**
 * Campos personalizados (Q2.3 = RV-02.1): regras PURAS, sem banco.
 *
 * Um único lugar decide o que é um valor válido para cada tipo. Quem grava
 * valor de campo personalizado (API de contato, negócio e empresa; o motor de
 * automação via `CustomFieldsService`) passa por `validarValores` — dois
 * validadores divergentes é como "10" vira número num lugar e texto no outro.
 */

export const ENTIDADES_CAMPO = ['contact', 'deal', 'company'] as const;
export type EntidadeCampo = (typeof ENTIDADES_CAMPO)[number];

export const TIPOS_CAMPO = ['text', 'textarea', 'number', 'money', 'date', 'select', 'multiselect', 'boolean', 'phone', 'email', 'url'] as const;
export type TipoCampo = (typeof TIPOS_CAMPO)[number];

/** Tipos que aceitam filtro por faixa (`cf_<chave>_min` / `_max`). */
export const TIPOS_FAIXA: readonly TipoCampo[] = ['number', 'money', 'date'];
/** Tipos com lista fechada de opções. */
export const TIPOS_COM_OPCOES: readonly TipoCampo[] = ['select', 'multiselect'];

export const CHAVE_RE = /^[a-z][a-z0-9_]{0,49}$/;
export const MAX_OPCOES = 100;
export const MAX_OPCAO = 80;
const MAX_TEXTO = 500;
const MAX_TEXTAREA = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMERO_RE = /^-?\d+(\.\d+)?$/;

export type ValorCampo = string | number | boolean | string[];

/** O que o validador precisa saber de uma definição (subconjunto do model). */
export interface DefCampo {
  chave: string;
  rotulo: string;
  tipo: string;
  opcoes: unknown;
  obrigatorio: boolean;
  arquivadoEm: Date | null;
}

export interface ErroCampo {
  chave: string;
  rotulo: string | null;
  erro: string;
}

export type ResultadoValidacao =
  | { ok: true; valores: Record<string, unknown> }
  | { ok: false; erros: ErroCampo[] };

export const ehEntidade = (v: unknown): v is EntidadeCampo => typeof v === 'string' && (ENTIDADES_CAMPO as readonly string[]).includes(v);
export const ehTipo = (v: unknown): v is TipoCampo => typeof v === 'string' && (TIPOS_CAMPO as readonly string[]).includes(v);

/** Opções gravadas (jsonb) → lista de strings, tolerante a lixo histórico. */
export function opcoesDe(def: Pick<DefCampo, 'opcoes'>): string[] {
  return Array.isArray(def.opcoes) ? def.opcoes.filter((o): o is string => typeof o === 'string') : [];
}

/** "Plano de saúde (2º)" → "plano_de_saude_2". Base da chave quando o admin não informa uma. */
export function slugChave(rotulo: string): string {
  const s = rotulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 50)
    .replace(/_+$/g, '');
  if (!s) return 'campo';
  return /^[a-z]/.test(s) ? s : `c_${s}`.slice(0, 50);
}

/**
 * Normaliza as opções de select/multiselect: aparadas, sem vazias, sem
 * duplicadas (case-insensitive). Devolve erro em vez de cortar em silêncio.
 */
export function normalizarOpcoes(tipo: TipoCampo, bruto: unknown): { ok: true; opcoes: string[] } | { ok: false; erro: string } {
  if (!TIPOS_COM_OPCOES.includes(tipo)) return { ok: true, opcoes: [] };
  if (!Array.isArray(bruto)) return { ok: false, erro: 'informe as opções da lista' };
  const vistas = new Set<string>();
  const opcoes: string[] = [];
  for (const o of bruto) {
    if (typeof o !== 'string') return { ok: false, erro: 'cada opção deve ser um texto' };
    const t = o.trim();
    if (!t) continue;
    if (t.length > MAX_OPCAO) return { ok: false, erro: `opção acima de ${MAX_OPCAO} caracteres` };
    const k = t.toLowerCase();
    if (vistas.has(k)) continue;
    vistas.add(k);
    opcoes.push(t);
  }
  if (opcoes.length === 0) return { ok: false, erro: 'a lista precisa de ao menos uma opção' };
  if (opcoes.length > MAX_OPCOES) return { ok: false, erro: `no máximo ${MAX_OPCOES} opções` };
  return { ok: true, opcoes };
}

function dataValida(s: string): boolean {
  const m = DATA_RE.exec(s);
  if (!m) return false;
  const [a, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(a, mes - 1, dia));
  return d.getUTCFullYear() === a && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function paraNumero(bruto: unknown): number | null {
  if (typeof bruto === 'number') return Number.isFinite(bruto) ? bruto : null;
  if (typeof bruto === 'string') {
    const t = bruto.trim();
    return NUMERO_RE.test(t) ? Number(t) : null;
  }
  return null;
}

/** Vazio = "limpar o campo": null, string em branco ou lista vazia. */
export function ehVazio(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/**
 * Converte um valor bruto no formato canônico do tipo.
 * Canônico: number/money → number (money com 2 casas), date → `AAAA-MM-DD`,
 * boolean → boolean, multiselect → string[] na ordem das opções, demais → string.
 */
export function normalizarValor(def: Pick<DefCampo, 'tipo' | 'opcoes'>, bruto: unknown): { ok: true; valor: ValorCampo } | { ok: false; erro: string } {
  const tipo = def.tipo as TipoCampo;
  switch (tipo) {
    case 'text':
    case 'textarea': {
      if (typeof bruto !== 'string' && typeof bruto !== 'number') return { ok: false, erro: 'esperado texto' };
      const t = String(bruto).trim();
      const max = tipo === 'text' ? MAX_TEXTO : MAX_TEXTAREA;
      if (t.length > max) return { ok: false, erro: `texto acima de ${max} caracteres` };
      return { ok: true, valor: t };
    }
    case 'number': {
      const n = paraNumero(bruto);
      if (n === null) return { ok: false, erro: 'esperado número' };
      return { ok: true, valor: n };
    }
    case 'money': {
      const n = paraNumero(bruto);
      if (n === null) return { ok: false, erro: 'esperado valor em reais' };
      return { ok: true, valor: Math.round(n * 100) / 100 };
    }
    case 'date': {
      if (typeof bruto !== 'string' || !dataValida(bruto.trim())) return { ok: false, erro: 'esperada data no formato AAAA-MM-DD' };
      return { ok: true, valor: bruto.trim() };
    }
    case 'boolean': {
      if (typeof bruto === 'boolean') return { ok: true, valor: bruto };
      if (bruto === 'true' || bruto === 'false') return { ok: true, valor: bruto === 'true' };
      return { ok: false, erro: 'esperado sim ou não' };
    }
    case 'select': {
      if (typeof bruto !== 'string') return { ok: false, erro: 'esperada uma opção da lista' };
      const op = opcoesDe(def).find((o) => o.toLowerCase() === bruto.trim().toLowerCase());
      if (!op) return { ok: false, erro: `opção inválida: "${bruto}"` };
      return { ok: true, valor: op };
    }
    case 'multiselect': {
      if (!Array.isArray(bruto) || bruto.some((b) => typeof b !== 'string')) return { ok: false, erro: 'esperada uma lista de opções' };
      const opcoes = opcoesDe(def);
      const pedidas = new Set((bruto as string[]).map((b) => b.trim().toLowerCase()));
      const invalidas = [...pedidas].filter((p) => !opcoes.some((o) => o.toLowerCase() === p));
      if (invalidas.length) return { ok: false, erro: `opção inválida: "${invalidas[0]}"` };
      return { ok: true, valor: opcoes.filter((o) => pedidas.has(o.toLowerCase())) };
    }
    case 'phone': {
      if (typeof bruto !== 'string' && typeof bruto !== 'number') return { ok: false, erro: 'esperado telefone' };
      const t = String(bruto).trim();
      const digitos = t.replace(/\D/g, '');
      if (!/^\+?[\d\s().-]+$/.test(t) || digitos.length < 8 || digitos.length > 15) return { ok: false, erro: 'telefone inválido' };
      return { ok: true, valor: t };
    }
    case 'email': {
      if (typeof bruto !== 'string') return { ok: false, erro: 'esperado e-mail' };
      const t = bruto.trim().toLowerCase();
      if (t.length > 200 || !EMAIL_RE.test(t)) return { ok: false, erro: 'e-mail inválido' };
      return { ok: true, valor: t };
    }
    case 'url': {
      if (typeof bruto !== 'string') return { ok: false, erro: 'esperado endereço web' };
      const t = bruto.trim();
      const comProtocolo = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
      try {
        const u = new URL(comProtocolo);
        if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) return { ok: false, erro: 'endereço web inválido' };
        if (comProtocolo.length > 500) return { ok: false, erro: 'endereço web muito longo' };
        return { ok: true, valor: comProtocolo };
      } catch {
        return { ok: false, erro: 'endereço web inválido' };
      }
    }
    default:
      return { ok: false, erro: `tipo de campo desconhecido: ${String(def.tipo)}` };
  }
}

/**
 * Valida um PATCH de valores contra as definições do tenant e devolve o jsonb
 * final (mesclado com `atuais`).
 *
 *  - chave sem definição → erro (nada de jsonb livre pela API);
 *  - campo arquivado só aceita ser LIMPO (o valor guardado não se perde, mas
 *    também não recebe dado novo enquanto o campo está fora do formulário);
 *  - vazio (null, "", []) remove a chave;
 *  - `exigirObrigatorios`: depois da mescla, todo campo ativo obrigatório
 *    precisa ter valor. Chaves que já estavam gravadas e não vieram no patch
 *    são preservadas (inclusive as de sistema, como `lead_origem`).
 */
export function validarValores(
  defs: readonly DefCampo[],
  valores: Record<string, unknown>,
  opts: { atuais?: Record<string, unknown>; exigirObrigatorios?: boolean } = {},
): ResultadoValidacao {
  const porChave = new Map(defs.map((d) => [d.chave, d]));
  const erros: ErroCampo[] = [];
  const final: Record<string, unknown> = { ...(opts.atuais ?? {}) };

  for (const [chave, bruto] of Object.entries(valores)) {
    const def = porChave.get(chave);
    if (!def) {
      erros.push({ chave, rotulo: null, erro: 'campo personalizado desconhecido' });
      continue;
    }
    if (ehVazio(bruto)) {
      delete final[chave];
      continue;
    }
    if (def.arquivadoEm) {
      erros.push({ chave, rotulo: def.rotulo, erro: 'campo arquivado não aceita valor novo' });
      continue;
    }
    const r = normalizarValor(def, bruto);
    if (r.ok) final[chave] = r.valor;
    else erros.push({ chave, rotulo: def.rotulo, erro: r.erro });
  }

  if (opts.exigirObrigatorios) {
    for (const d of defs) {
      if (!d.obrigatorio || d.arquivadoEm) continue;
      if (erros.some((e) => e.chave === d.chave)) continue;
      if (ehVazio(final[d.chave])) erros.push({ chave: d.chave, rotulo: d.rotulo, erro: 'campo obrigatório' });
    }
  }

  return erros.length ? { ok: false, erros } : { ok: true, valores: final };
}

/** Mensagem única (title do RFC 7807) para a lista de erros. */
export function tituloErros(erros: readonly ErroCampo[]): string {
  const nomes = erros.map((e) => e.rotulo ?? e.chave);
  return `Campos personalizados inválidos: ${nomes.join(', ')}`;
}

// --------------------------------------------------------------------------
// Filtro da listagem: `cf_<chave>=<valor>`, `cf_<chave>_min`, `cf_<chave>_max`
// --------------------------------------------------------------------------

export interface ResultadoFiltro {
  /** Condições a juntar (AND) ao `where` do Prisma, uma por parâmetro `cf_*`. */
  condicoes: Prisma.ContactWhereInput[];
  erros: ErroCampo[];
}

/**
 * Traduz o `cf` do filtro da lista (`{ chave: valor }`, já sem o prefixo
 * `cf_` — ver `contatos-filtro.ts`) em filtros JSON do Prisma, pelo TIPO da
 * definição:
 *  - igualdade para todos os tipos (number/money comparam como número,
 *    boolean como true/false, select sem diferença de maiúscula,
 *    multiselect = "contém a opção");
 *  - faixa inclusiva `_min`/`_max` só para number, money e date;
 *  - valor que não cabe no tipo é erro (400), não "nenhum resultado".
 *
 * `cf_<chave>` exato tem prioridade: uma chave chamada `idade_min` continua
 * filtrável por igualdade. Chave SEM definição ativa (dado histórico de
 * importação/lead, ex. `lead_origem`) cai na igualdade textual que a lista já
 * fazia: o filtro não quebra quem dependia dele.
 */
export function montarFiltroCampos(defs: readonly DefCampo[], cf: Record<string, string>): ResultadoFiltro {
  const ativos = new Map(defs.filter((d) => !d.arquivadoEm).map((d) => [d.chave, d]));
  const condicoes: Prisma.ContactWhereInput[] = [];
  const erros: ErroCampo[] = [];
  const json = (f: Prisma.JsonFilter): Prisma.ContactWhereInput => ({ camposCustom: f });

  for (const [nome, valor] of Object.entries(cf)) {
    let def = ativos.get(nome);
    let faixa: 'min' | 'max' | null = null;
    if (!def) {
      const m = /^(.+)_(min|max)$/.exec(nome);
      const base = m ? ativos.get(m[1]) : undefined;
      if (m && base) {
        def = base;
        faixa = m[2] as 'min' | 'max';
      }
    }
    if (!def) {
      condicoes.push(json({ path: [nome], equals: valor }));
      continue;
    }

    if (faixa) {
      if (!TIPOS_FAIXA.includes(def.tipo as TipoCampo)) {
        erros.push({ chave: def.chave, rotulo: def.rotulo, erro: 'filtro por faixa só vale para número, dinheiro e data' });
        continue;
      }
      const r = normalizarValor(def, valor);
      if (!r.ok) erros.push({ chave: def.chave, rotulo: def.rotulo, erro: r.erro });
      else condicoes.push(json(faixa === 'min' ? { path: [def.chave], gte: r.valor } : { path: [def.chave], lte: r.valor }));
      continue;
    }

    const r = def.tipo === 'multiselect' ? normalizarValor(def, [valor]) : normalizarValor(def, valor);
    if (!r.ok) erros.push({ chave: def.chave, rotulo: def.rotulo, erro: r.erro });
    else if (def.tipo === 'multiselect') condicoes.push(json({ path: [def.chave], array_contains: r.valor as string[] }));
    else condicoes.push(json({ path: [def.chave], equals: r.valor as Prisma.InputJsonValue }));
  }

  return { condicoes, erros };
}

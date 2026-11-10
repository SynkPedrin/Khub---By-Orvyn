import { z } from 'zod';
import { soDigitos } from './telefone';
import { CHAVE_CAMPO } from './contatos-filtro';

/**
 * Regras PURAS do import de contatos por CSV (Q2.2): normalização de linha,
 * telefone BR e o plano de dedupe. Sem banco aqui, de propósito: é a parte
 * que precisa de teste de 1.000 linhas e não pode depender de I/O.
 */

export const ESTRATEGIAS = ['pular', 'atualizar_vazios', 'sobrescrever'] as const;
export type Estrategia = (typeof ESTRATEGIAS)[number];
export const MAX_LINHAS_LOTE = 500;

/** Mesmo recorte do helper do Inbox (telefone.ts): os 8 últimos dígitos. */
export const CAUDA_TELEFONE = 8;

const texto = (max: number) => z.union([z.string(), z.number()]).transform((v) => String(v).replace(/\s+/g, ' ').trim().slice(0, max)).optional();

export const linhaSchema = z
  .object({
    linha: z.number().int().min(1),
    nome: texto(160),
    email: texto(200),
    telefone: texto(40),
    empresa: texto(160),
    cargo: texto(120),
    origem: texto(80),
    valor: z.union([z.string(), z.number()]).optional(),
    /** "a, b; c" ou ["a","b"] */
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    campos: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();
export type LinhaBruta = z.input<typeof linhaSchema>;

export interface ContatoImport {
  linha: number;
  nome: string;
  /** Nome veio do arquivo (e não do fallback e-mail/telefone): só ele sobrescreve. */
  nomeInformado: boolean;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  cargo: string | null;
  origem: string | null;
  valor: number | null;
  tags: string[];
  campos: Record<string, string>;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Telefone BR → só dígitos com DDI (`5511977771234`). Aceita máscara, `+55`,
 * `0` de tronco (`011...`) e `00` internacional. Número estrangeiro só com `+`
 * explícito. Sem DDD (8/9 dígitos) é erro: viraria contato que o WhatsApp não acha.
 */
export function normalizarTelefoneBR(bruto: string | null | undefined): { ok: true; valor: string | null } | { ok: false; motivo: string } {
  const original = (bruto ?? '').trim();
  if (!original) return { ok: true, valor: null };
  let d = soDigitos(original);
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + 8 dígitos (fixo)
  else if (d.length === 12 && d.startsWith('0')) d = d.slice(1); // 0 + DDD + 9 dígitos (celular)
  if (d.length === 10 || d.length === 11) return { ok: true, valor: `55${d}` };
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return { ok: true, valor: d };
  if (original.startsWith('+') && d.length >= 8 && d.length <= 15) return { ok: true, valor: d };
  if (d.length === 8 || d.length === 9) return { ok: false, motivo: `telefone sem DDD: ${original}` };
  return { ok: false, motivo: `telefone inválido: ${original}` };
}

/** "1.234,56" / "1234.56" / "R$ 1.234" → número; vazio → null; inválido → erro. */
export function valorBR(v: string | number | undefined): { ok: true; valor: number | null } | { ok: false; motivo: string } {
  if (v === undefined || v === '') return { ok: true, valor: null };
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? { ok: true, valor: Math.round(v * 100) / 100 } : { ok: false, motivo: `valor inválido: ${v}` };
  const s = v.replace(/[^\d,.-]/g, '');
  if (!s) return { ok: true, valor: null };
  const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e10 ? { ok: true, valor: Math.round(n * 100) / 100 } : { ok: false, motivo: `valor inválido: ${v}` };
}

export function separarTags(t: string | string[] | undefined): string[] {
  const lista = Array.isArray(t) ? t : (t ?? '').split(/[,;|]/);
  const out: string[] = [];
  for (const bruto of lista) {
    const tag = String(bruto).trim();
    if (tag && tag.length <= 40 && !out.some((x) => x.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  return out.slice(0, 30);
}

/** Valida e normaliza UMA linha. Erro vira `{linha, motivo}` no relatório, nunca 400. */
export function normalizarLinha(bruta: unknown, tagsExtras: string[] = []): { ok: true; dado: ContatoImport } | { ok: false; linha: number; motivo: string } {
  const linhaN = typeof (bruta as { linha?: unknown })?.linha === 'number' ? (bruta as { linha: number }).linha : 0;
  const r = linhaSchema.safeParse(bruta);
  if (!r.success) return { ok: false, linha: linhaN, motivo: `formato inválido: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}` };
  const l = r.data;
  const emailBruto = l.email?.toLowerCase() || null;
  if (emailBruto && !EMAIL.test(emailBruto)) return { ok: false, linha: l.linha, motivo: `e-mail inválido: ${emailBruto}` };
  const tel = normalizarTelefoneBR(l.telefone);
  if (!tel.ok) return { ok: false, linha: l.linha, motivo: tel.motivo };
  const valor = valorBR(l.valor);
  if (!valor.ok) return { ok: false, linha: l.linha, motivo: valor.motivo };
  const nome = l.nome || null;
  if (!nome && !emailBruto && !tel.valor) return { ok: false, linha: l.linha, motivo: 'linha sem nome, e-mail ou telefone' };
  const campos: Record<string, string> = {};
  for (const [k, v] of Object.entries(l.campos ?? {})) {
    if (!CHAVE_CAMPO.test(k)) return { ok: false, linha: l.linha, motivo: `campo personalizado inválido: ${k}` };
    const s = String(v).trim().slice(0, 500);
    if (s) campos[k] = s;
  }
  return {
    ok: true,
    dado: {
      linha: l.linha,
      nome: nome ?? emailBruto ?? tel.valor!,
      nomeInformado: !!nome,
      email: emailBruto,
      telefone: tel.valor,
      empresa: l.empresa || null,
      cargo: l.cargo || null,
      origem: l.origem || null,
      valor: valor.valor,
      tags: separarTags([...separarTags(l.tags), ...tagsExtras]),
      campos,
    },
  };
}

/** Registro alvo do dedupe: um contato que já existe no banco. */
export interface Existente {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  cargo: string | null;
  origem: string | null;
  valor: number;
  tags: string[];
  campos: Record<string, unknown>;
}

/** Estado de trabalho de um alvo (existente ou novo) — campos já mesclados. */
type Ficha = Omit<Existente, 'id'>;

export interface PlanoImport {
  criar: (Ficha & { linha: number })[];
  atualizar: { id: string; linha: number; antes: Ficha; depois: Ficha }[];
  ignorados: { linha: number; motivo: string }[];
}

const vazio = (v: unknown) => v === null || v === undefined || v === '';
const chaveEmail = (e: string | null) => (e ? e.toLowerCase() : null);
const chaveFone = (t: string | null) => {
  const d = soDigitos(t);
  return d.length >= CAUDA_TELEFONE ? d.slice(-CAUDA_TELEFONE) : null;
};

/** Aplica UMA linha sobre a ficha conforme a estratégia (não muta a original). */
export function mesclarFicha(f: Ficha, l: ContatoImport, estrategia: Exclude<Estrategia, 'pular'>): Ficha {
  const novo: Ficha = { ...f, tags: [...f.tags], campos: { ...f.campos } };
  const sobrescreve = estrategia === 'sobrescrever';
  for (const k of ['email', 'telefone', 'empresa', 'cargo', 'origem'] as const) {
    const v = l[k];
    if (vazio(v)) continue;
    if (vazio(novo[k]) || sobrescreve) novo[k] = v;
  }
  if (l.nomeInformado && sobrescreve) novo.nome = l.nome;
  if (l.valor !== null && (sobrescreve || !(novo.valor > 0))) novo.valor = l.valor;
  // tags somam nas duas estratégias: sobrescrever é sobre dados, não apaga etiqueta
  for (const t of l.tags) if (!novo.tags.some((x) => x.toLowerCase() === t.toLowerCase())) novo.tags.push(t);
  for (const [k, v] of Object.entries(l.campos)) if (sobrescreve || vazio(novo.campos[k])) novo.campos[k] = v;
  return novo;
}

const igual = (a: Ficha, b: Ficha) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Plano de dedupe de um lote. Mesma pessoa = mesmo e-mail (case-insensitive)
 * OU mesmo telefone (8 últimos dígitos, a regra do Inbox — BUG-012). E-mail
 * ganha quando os dois apontam para pessoas diferentes (igual a leads.service).
 * Duplicata DENTRO do arquivo também é pega: a primeira linha "é dona" do
 * contato; as seguintes mesclam nela (ou são ignoradas, em `pular`).
 * Invariante do relatório: criar + atualizar + ignorados = linhas válidas.
 */
export function planejarImport(linhas: ContatoImport[], existentes: Existente[], estrategia: Estrategia): PlanoImport {
  type Alvo = { tipo: 'existente'; id: string; dona: number; antes: Ficha; ficha: Ficha } | { tipo: 'novo'; idx: number; dona: number; ficha: Ficha };
  const porEmail = new Map<string, Alvo>();
  const porFone = new Map<string, Alvo>();
  const indexar = (a: Alvo) => {
    const e = chaveEmail(a.ficha.email);
    const t = chaveFone(a.ficha.telefone);
    if (e && !porEmail.has(e)) porEmail.set(e, a);
    if (t && !porFone.has(t)) porFone.set(t, a);
  };
  // existentes chegam em ordem de criação: o mais antigo fica com a chave
  const tocados = new Map<string, Alvo & { tipo: 'existente' }>();
  for (const ex of existentes) {
    const { id, ...ficha } = ex;
    indexar({ tipo: 'existente', id, dona: 0, antes: ficha, ficha });
  }

  const novos: (Alvo & { tipo: 'novo' })[] = [];
  const ignorados: PlanoImport['ignorados'] = [];
  for (const l of linhas) {
    const e = chaveEmail(l.email);
    const t = chaveFone(l.telefone);
    const alvo = (e ? porEmail.get(e) : undefined) ?? (t ? porFone.get(t) : undefined);
    if (!alvo) {
      const ficha: Ficha = { nome: l.nome, email: l.email, telefone: l.telefone, empresa: l.empresa, cargo: l.cargo, origem: l.origem, valor: l.valor ?? 0, tags: [...l.tags], campos: { ...l.campos } };
      const a: Alvo & { tipo: 'novo' } = { tipo: 'novo', idx: novos.length, dona: l.linha, ficha };
      novos.push(a);
      indexar(a);
      continue;
    }
    const doArquivo = alvo.dona > 0;
    if (estrategia === 'pular') {
      ignorados.push({ linha: l.linha, motivo: doArquivo ? `duplicada no arquivo (mesmo contato da linha ${alvo.dona})` : 'já existe (mesmo e-mail ou telefone)' });
      continue;
    }
    alvo.ficha = mesclarFicha(alvo.ficha, l, estrategia);
    indexar(alvo); // e-mail/telefone recém-preenchidos passam a casar as próximas linhas
    if (doArquivo) {
      ignorados.push({ linha: l.linha, motivo: `duplicada no arquivo: mesclada com a linha ${alvo.dona}` });
    } else if (alvo.tipo === 'existente') {
      alvo.dona = l.linha;
      tocados.set(alvo.id, alvo);
    }
  }

  const atualizar: PlanoImport['atualizar'] = [];
  for (const a of tocados.values()) {
    if (igual(a.antes, a.ficha)) ignorados.push({ linha: a.dona, motivo: 'já existe, sem dados novos' });
    else atualizar.push({ id: a.id, linha: a.dona, antes: a.antes, depois: a.ficha });
  }
  ignorados.sort((x, y) => x.linha - y.linha);
  return { criar: novos.map((n) => ({ ...n.ficha, linha: n.dona })), atualizar, ignorados };
}

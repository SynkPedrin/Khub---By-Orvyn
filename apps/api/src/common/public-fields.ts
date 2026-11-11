import { z } from 'zod';

/**
 * Campos de páginas PÚBLICAS (formulário /f e perguntas extras do
 * agendamento /b): definição (Zod) e validação das respostas — regras puras,
 * sem banco. Um validador só para os dois produtos: "obrigatório", "e-mail
 * válido" e "telefone BR" têm de significar a mesma coisa nas duas telas.
 */

export const TIPOS_CAMPO_PUBLICO = ['text', 'email', 'phone', 'textarea', 'select', 'multiselect', 'checkbox', 'date', 'number', 'consentimento'] as const;
export type TipoCampoPublico = (typeof TIPOS_CAMPO_PUBLICO)[number];

export const CAMPO_ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const MAX_CAMPOS = 50;
const MAX_TEXTO = 500;
const MAX_TEXTAREA = 5000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Onde a resposta vai parar no contato. */
export const MapeamentoSchema = z.union([
  z.object({ tipo: z.literal('nativo'), campo: z.enum(['nome', 'email', 'telefone', 'empresa']) }),
  z.object({ tipo: z.literal('custom'), chave: z.string().regex(/^[a-z][a-z0-9_]{0,49}$/) }),
]);
export type Mapeamento = z.infer<typeof MapeamentoSchema>;

const textoCurto = (max: number) => z.string().trim().max(max);

export const CampoPublicoSchema = z
  .object({
    id: z.string().regex(CAMPO_ID_RE, 'id do campo: letras minúsculas, números e _'),
    tipo: z.enum(TIPOS_CAMPO_PUBLICO),
    rotulo: textoCurto(300).min(1, 'informe o rótulo do campo'),
    obrigatorio: z.boolean().default(false),
    placeholder: textoCurto(120).optional(),
    ajuda: textoCurto(300).optional(),
    opcoes: z.array(textoCurto(80).min(1)).max(100).optional(),
    largura: z.enum(['inteira', 'metade']).default('inteira'),
    mapear: MapeamentoSchema.nullable().optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    const precisaOpcoes = c.tipo === 'select' || c.tipo === 'multiselect';
    if (precisaOpcoes && !(c.opcoes && c.opcoes.length)) ctx.addIssue({ code: 'custom', message: `"${c.rotulo}": inclua ao menos uma opção`, path: ['opcoes'] });
    if (c.opcoes && new Set(c.opcoes.map((o) => o.toLowerCase())).size !== c.opcoes.length) ctx.addIssue({ code: 'custom', message: `"${c.rotulo}": opções repetidas`, path: ['opcoes'] });
    if (c.tipo === 'consentimento' && c.mapear) ctx.addIssue({ code: 'custom', message: 'o consentimento LGPD não é ligado a campo do contato', path: ['mapear'] });
  });
export type CampoPublico = z.infer<typeof CampoPublicoSchema>;

export const ListaCamposSchema = z
  .array(CampoPublicoSchema)
  .max(MAX_CAMPOS, `no máximo ${MAX_CAMPOS} campos`)
  .superRefine((lista, ctx) => {
    const ids = new Set<string>();
    for (const c of lista) {
      if (ids.has(c.id)) ctx.addIssue({ code: 'custom', message: `id de campo repetido: ${c.id}` });
      ids.add(c.id);
    }
  });

/**
 * Telefone BR normalizado em dígitos com DDI (`5511977771234`), o mesmo
 * formato da importação de contatos. Aceita máscara, +55, 0 de operadora.
 * Número estrangeiro só com `+` explícito (8 a 15 dígitos). Inválido → null.
 */
export function normalizarTelefoneBR(bruto: string): string | null {
  const s = bruto.trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  if (s.startsWith('+') && !d.startsWith('55')) return d.length >= 8 && d.length <= 15 ? d : null;
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  else if (d.startsWith('0') && (d.length === 11 || d.length === 12)) d = d.slice(1);
  if (d.length !== 10 && d.length !== 11) return null;
  if (/^0/.test(d) || /^(\d)\1+$/.test(d)) return null;
  // Celular (11 dígitos) começa com 9 depois do DDD.
  if (d.length === 11 && d[2] !== '9') return null;
  return `55${d}`;
}

export type ValorResposta = string | number | boolean | string[];
export interface ErroResposta {
  campo: string;
  rotulo: string;
  erro: string;
}
export type ResultadoRespostas = { ok: true; valores: Record<string, ValorResposta> } | { ok: false; erros: ErroResposta[] };

const vazio = (v: unknown) => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);

function dataValida(s: string): boolean {
  const m = DATA_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && Number(m[1]) >= 1900 && Number(m[1]) <= 2200;
}

function umValor(c: CampoPublico, v: unknown): { ok: true; valor: ValorResposta } | { ok: false; erro: string } {
  switch (c.tipo) {
    case 'text':
    case 'textarea': {
      if (typeof v !== 'string') return { ok: false, erro: 'texto inválido' };
      const t = v.trim();
      const max = c.tipo === 'text' ? MAX_TEXTO : MAX_TEXTAREA;
      if (t.length > max) return { ok: false, erro: `use no máximo ${max} caracteres` };
      return { ok: true, valor: t };
    }
    case 'email': {
      if (typeof v !== 'string') return { ok: false, erro: 'e-mail inválido' };
      const e = v.trim().toLowerCase();
      return EMAIL_RE.test(e) && e.length <= 254 ? { ok: true, valor: e } : { ok: false, erro: 'informe um e-mail válido' };
    }
    case 'phone': {
      if (typeof v !== 'string') return { ok: false, erro: 'telefone inválido' };
      const t = normalizarTelefoneBR(v);
      return t ? { ok: true, valor: t } : { ok: false, erro: 'informe um telefone com DDD' };
    }
    case 'number': {
      const n = typeof v === 'number' ? v : typeof v === 'string' && /^-?\d+([.,]\d+)?$/.test(v.trim()) ? Number(v.trim().replace(',', '.')) : NaN;
      return Number.isFinite(n) && Math.abs(n) < 1e12 ? { ok: true, valor: n } : { ok: false, erro: 'informe um número' };
    }
    case 'date':
      return typeof v === 'string' && dataValida(v.trim()) ? { ok: true, valor: v.trim() } : { ok: false, erro: 'informe uma data válida' };
    case 'select': {
      const opcoes = c.opcoes ?? [];
      return typeof v === 'string' && opcoes.includes(v) ? { ok: true, valor: v } : { ok: false, erro: 'escolha uma das opções' };
    }
    case 'multiselect': {
      const opcoes = c.opcoes ?? [];
      const lista = Array.isArray(v) ? v : typeof v === 'string' ? [v] : null;
      if (!lista || lista.some((x) => typeof x !== 'string' || !opcoes.includes(x))) return { ok: false, erro: 'escolha entre as opções' };
      return { ok: true, valor: [...new Set(lista as string[])] };
    }
    case 'checkbox':
    case 'consentimento':
      if (v === true || v === 'true' || v === 'on') return { ok: true, valor: true };
      if (v === false || v === 'false') return { ok: true, valor: false };
      return { ok: false, erro: 'valor inválido' };
  }
}

/**
 * Valida as respostas contra os campos. Chave desconhecida é descartada (o
 * cliente não injeta dado fora do formulário). Obrigatório vazio, e
 * consentimento obrigatório não marcado, viram erro por campo.
 */
export function validarRespostas(campos: readonly CampoPublico[], bruto: unknown): ResultadoRespostas {
  const entrada = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? (bruto as Record<string, unknown>) : {};
  const valores: Record<string, ValorResposta> = {};
  const erros: ErroResposta[] = [];
  for (const c of campos) {
    const v = entrada[c.id];
    const semValor = vazio(typeof v === 'string' ? v.trim() : v);
    if (semValor) {
      if (c.obrigatorio) erros.push({ campo: c.id, rotulo: c.rotulo, erro: c.tipo === 'consentimento' ? 'é preciso aceitar para continuar' : 'campo obrigatório' });
      else if (c.tipo === 'checkbox' || c.tipo === 'consentimento') valores[c.id] = false;
      continue;
    }
    const r = umValor(c, v);
    if (!r.ok) erros.push({ campo: c.id, rotulo: c.rotulo, erro: r.erro });
    else if (c.obrigatorio && vazio(r.valor)) erros.push({ campo: c.id, rotulo: c.rotulo, erro: 'campo obrigatório' });
    else valores[c.id] = r.valor;
  }
  return erros.length ? { ok: false, erros } : { ok: true, valores };
}

/** Só o necessário para renderizar (o mapeamento para o CRM não sai do servidor). */
export function campoParaPublico(c: CampoPublico) {
  return {
    id: c.id, tipo: c.tipo, rotulo: c.rotulo, obrigatorio: c.obrigatorio, largura: c.largura,
    ...(c.placeholder ? { placeholder: c.placeholder } : {}),
    ...(c.ajuda ? { ajuda: c.ajuda } : {}),
    ...(c.opcoes ? { opcoes: c.opcoes } : {}),
  };
}

const UTM_CHAVES = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'] as const;

function urlHttp(s: unknown): URL | null {
  if (typeof s !== 'string' || s.length > 2000) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

/**
 * UTM do envio: o que veio explícito no corpo vence; senão a query da página
 * onde o formulário está e, por último, a do referrer. Valores curtos e
 * só texto; `pagina`/`referrer` sem query (podem carregar dado pessoal).
 */
export function extrairUtm(entrada: { utm?: unknown; pagina?: unknown; referrer?: unknown }): Record<string, string> {
  const explicito = entrada.utm && typeof entrada.utm === 'object' && !Array.isArray(entrada.utm) ? (entrada.utm as Record<string, unknown>) : {};
  const pagina = urlHttp(entrada.pagina);
  const referrer = urlHttp(entrada.referrer);
  const out: Record<string, string> = {};
  for (const k of UTM_CHAVES) {
    const candidatos = [explicito[k], pagina?.searchParams.get(k), referrer?.searchParams.get(k)];
    const v = candidatos.find((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (v) out[k] = v.trim().slice(0, 200);
  }
  if (pagina) out.pagina = `${pagina.origin}${pagina.pathname}`.slice(0, 500);
  if (referrer) out.referrer = `${referrer.origin}${referrer.pathname}`.slice(0, 500);
  return out;
}

/** Valor de célula CSV com proteção contra injeção de fórmula (=, +, -, @). */
export function celulaCsv(v: unknown): string {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : typeof v === 'boolean' ? (v ? 'Sim' : 'Não') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Slug público: minúsculas, números e hífen (4 a 64). */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$/;
export function slugDe(texto: string): string {
  const s = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s.length >= 3 ? s : `pagina-${s}`.replace(/-+$/g, '');
}

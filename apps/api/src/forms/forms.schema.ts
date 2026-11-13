import { z } from 'zod';
import { ListaCamposSchema, SLUG_RE, type CampoPublico, type TipoCampoPublico, type ValorResposta } from '../common/public-fields';

/**
 * Formulários (Q4.1): contrato da configuração e regras puras de montagem do
 * envio. Sem banco: o serviço decide o QUE gravar a partir daqui.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

const urlHttps = z
  .string()
  .trim()
  .max(500)
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || (u.protocol === 'http:' && process.env.NODE_ENV !== 'production');
    } catch {
      return false;
    }
  }, 'use um endereço https:// válido');

export const EstiloFormSchema = z
  .object({
    cor: z.string().regex(HEX_RE, 'cor em hexadecimal (#RRGGBB)').optional(),
    logoUrl: urlHttps.optional(),
    titulo: z.string().trim().max(160).optional(),
    descricao: z.string().trim().max(1000).optional(),
    textoBotao: z.string().trim().min(1).max(40).optional(),
    mensagemSucesso: z.string().trim().max(500).optional(),
    redirecionarUrl: urlHttps.optional(),
  })
  .strict();
export type EstiloForm = z.infer<typeof EstiloFormSchema>;

export const CriarFormSchema = z
  .object({
    nome: z.string().trim().min(1, 'informe o nome').max(120),
    slug: z.string().trim().toLowerCase().regex(SLUG_RE, 'link: letras minúsculas, números e hífen (4 a 64)').optional(),
    campos: ListaCamposSchema.optional(),
    estilo: EstiloFormSchema.optional(),
    ativo: z.boolean().optional(),
    tag: z.string().trim().min(1).max(40).nullable().optional(),
    stageId: z.string().uuid().nullable().optional(),
  })
  .strict();
export type CriarFormInput = z.infer<typeof CriarFormSchema>;
export const AtualizarFormSchema = CriarFormSchema.partial().strict();
export type AtualizarFormInput = z.infer<typeof AtualizarFormSchema>;

/** Corpo do envio público. `website` é o campo isca (honeypot). */
export const EnvioPublicoSchema = z
  .object({
    respostas: z.record(z.unknown()).default({}),
    carimbo: z.string().max(200).optional(),
    website: z.unknown().optional(),
    utm: z.record(z.unknown()).optional(),
    pagina: z.string().max(2000).optional(),
    referrer: z.string().max(2000).optional(),
  })
  .strip();

/** Campos padrão de um formulário novo: o essencial para virar contato. */
export function camposPadrao(): CampoPublico[] {
  return [
    { id: 'nome', tipo: 'text', rotulo: 'Nome completo', obrigatorio: true, largura: 'inteira', mapear: { tipo: 'nativo', campo: 'nome' } },
    { id: 'email', tipo: 'email', rotulo: 'E-mail', obrigatorio: true, largura: 'metade', mapear: { tipo: 'nativo', campo: 'email' } },
    { id: 'telefone', tipo: 'phone', rotulo: 'WhatsApp', obrigatorio: false, largura: 'metade', mapear: { tipo: 'nativo', campo: 'telefone' } },
    { id: 'consentimento', tipo: 'consentimento', rotulo: 'Autorizo o contato e o tratamento dos meus dados para este atendimento, conforme a LGPD.', obrigatorio: true, largura: 'inteira' },
  ];
}

/** Tipos do campo personalizado (Q2.3) que aceitam cada tipo de pergunta. */
const COMPATIVEIS: Record<TipoCampoPublico, readonly string[]> = {
  text: ['text', 'textarea', 'url', 'phone', 'email'],
  textarea: ['textarea', 'text'],
  email: ['email', 'text'],
  phone: ['phone', 'text'],
  number: ['number', 'money', 'text'],
  date: ['date', 'text'],
  select: ['select', 'text'],
  multiselect: ['multiselect'],
  checkbox: ['boolean'],
  consentimento: [],
};
const TIPO_NATIVO: Record<'nome' | 'email' | 'telefone' | 'empresa', readonly TipoCampoPublico[]> = {
  nome: ['text'],
  empresa: ['text'],
  email: ['email'],
  telefone: ['phone'],
};

export interface DefCustom {
  chave: string;
  tipo: string;
  rotulo: string;
}

/**
 * Regras de montagem do formulário além do formato: cada campo nativo ligado
 * a no máximo uma pergunta, tipo compatível, campo personalizado existente e
 * ativo. Formulário ATIVO precisa de e-mail ou telefone ligado ao contato
 * (sem isso não há como achar a mesma pessoa e cada envio duplicaria contato).
 */
export function problemasDosCampos(campos: readonly CampoPublico[], defs: readonly DefCustom[], ativo: boolean): string[] {
  const erros: string[] = [];
  const nativos = new Map<string, string>();
  const customs = new Map<string, string>();
  const porChave = new Map(defs.map((d) => [d.chave, d]));
  for (const c of campos) {
    const m = c.mapear;
    if (!m) continue;
    if (m.tipo === 'nativo') {
      if (nativos.has(m.campo)) erros.push(`"${c.rotulo}" e "${nativos.get(m.campo)}" estão ligados ao mesmo campo do contato (${m.campo})`);
      nativos.set(m.campo, c.rotulo);
      if (!TIPO_NATIVO[m.campo].includes(c.tipo)) erros.push(`"${c.rotulo}": o tipo da pergunta não combina com o campo ${m.campo} do contato`);
    } else {
      const def = porChave.get(m.chave);
      if (!def) erros.push(`"${c.rotulo}": o campo personalizado "${m.chave}" não existe ou está arquivado`);
      else if (!COMPATIVEIS[c.tipo].includes(def.tipo)) erros.push(`"${c.rotulo}": o tipo da pergunta não combina com o campo "${def.rotulo}"`);
      if (customs.has(m.chave)) erros.push(`"${c.rotulo}" e "${customs.get(m.chave)}" estão ligados ao mesmo campo personalizado`);
      customs.set(m.chave, c.rotulo);
    }
  }
  if (ativo && !nativos.has('email') && !nativos.has('telefone')) {
    erros.push('ligue uma pergunta de e-mail ou de telefone ao contato para publicar o formulário');
  }
  return erros;
}

export interface DadosContatoDoEnvio {
  nome: string | null;
  email: string | null;
  telefone: string | null;
  empresa: string | null;
  camposCustom: Record<string, unknown>;
  consentimento: { texto: string } | null;
}

/**
 * Respostas validadas → dados do contato, pelo mapeamento de cada pergunta.
 * Consentimento: vale a primeira caixa de consentimento MARCADA (texto dela
 * vai junto como prova do que a pessoa aceitou).
 */
export function dadosDoContato(campos: readonly CampoPublico[], valores: Record<string, ValorResposta>): DadosContatoDoEnvio {
  const out: DadosContatoDoEnvio = { nome: null, email: null, telefone: null, empresa: null, camposCustom: {}, consentimento: null };
  for (const c of campos) {
    const v = valores[c.id];
    if (c.tipo === 'consentimento') {
      if (v === true && !out.consentimento) out.consentimento = { texto: c.rotulo };
      continue;
    }
    if (v === undefined || v === '' || !c.mapear) continue;
    if (c.mapear.tipo === 'nativo') out[c.mapear.campo] = String(v);
    else out.camposCustom[c.mapear.chave] = v;
  }
  return out;
}

/** CSV das respostas (cabeçalho com os rótulos atuais; campos removidos no fim, pelo id). */
export function linhasCsv(
  campos: readonly CampoPublico[],
  envios: readonly { createdAt: Date; respostas: Record<string, unknown>; utm: Record<string, unknown> }[],
  celula: (v: unknown) => string,
): string {
  const ids = campos.map((c) => c.id);
  const extras = [...new Set(envios.flatMap((e) => Object.keys(e.respostas)).filter((k) => !ids.includes(k)))];
  const utmChaves = [...new Set(envios.flatMap((e) => Object.keys(e.utm)))].sort();
  const cabecalho = ['Enviado em', ...campos.map((c) => c.rotulo), ...extras, ...utmChaves];
  const linhas = envios.map((e) => [
    e.createdAt.toISOString(),
    ...ids.map((id) => e.respostas[id]),
    ...extras.map((id) => e.respostas[id]),
    ...utmChaves.map((k) => e.utm[k]),
  ]);
  // BOM: o Excel em pt-BR abre UTF-8 com acento certo.
  return '﻿' + [cabecalho, ...linhas].map((l) => l.map(celula).join(',')).join('\r\n') + '\r\n';
}

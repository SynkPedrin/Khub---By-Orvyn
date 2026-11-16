import { BadRequestException } from '@nestjs/common';
import { z, type ZodError } from 'zod';

/**
 * Catálogo do Daily da agência (db/074, ADR-0050): valores aceitos, validação
 * de entrada e as regras puras de transição. Fica separado do service para
 * ser testado sem banco.
 */
export const TIPOS = ['post', 'carrossel', 'reel', 'criativo', 'copy', 'trafego', 'landing_page', 'branding', 'reuniao', 'administrativo', 'outro'] as const;
export const TIPOS_CONTEUDO = ['post', 'carrossel', 'reel', 'criativo'] as const;
export const STATUS = ['backlog', 'a_fazer', 'em_andamento', 'em_revisao', 'aguardando_aprovacao', 'concluida'] as const;
export const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente'] as const;
export const APROVACOES = ['em_producao', 'revisao_interna', 'aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado'] as const;
export const PLATAFORMAS = ['instagram', 'tiktok', 'facebook', 'linkedin', 'youtube', 'outra'] as const;
export const PRAZOS = ['atrasadas', 'hoje', 'semana', 'sem'] as const;

export type Tipo = (typeof TIPOS)[number];
export type Status = (typeof STATUS)[number];
export type Aprovacao = (typeof APROVACOES)[number];

export const ehConteudo = (tipo: string): boolean => (TIPOS_CONTEUDO as readonly string[]).includes(tipo);

const texto = (max: number) => z.string().trim().max(max, `máximo de ${max} caracteres`);
const opcional = (max: number) => texto(max).nullable().optional().transform((v) => (v ? v : v === undefined ? undefined : null));
const data = z.string().datetime({ offset: true, message: 'data inválida' }).transform((v) => new Date(v));
const id = z.string().uuid('id inválido');

const camposTarefa = {
  titulo: texto(200).min(1, 'informe o título'),
  descricao: opcional(20000),
  tipo: z.enum(TIPOS),
  status: z.enum(STATUS),
  prioridade: z.enum(PRIORIDADES),
  clientId: id.nullable(),
  responsavelId: id.nullable(),
  inicioEm: data.nullable(),
  prazoEm: data.nullable(),
  plataformas: z.array(z.enum(PLATAFORMAS)).max(PLATAFORMAS.length).transform((l) => [...new Set(l)]),
  objetivo: opcional(500),
  legenda: opcional(5000),
  hashtags: opcional(1000),
  cta: opcional(300),
  exigeLegenda: z.boolean(),
  publicarEm: data.nullable(),
  aprovacao: z.enum(APROVACOES),
};

export const CriarTarefaSchema = z
  .object({ ...camposTarefa, parentId: id.nullable() })
  .partial()
  .required({ titulo: true })
  .strict();
export type CriarTarefaInput = z.infer<typeof CriarTarefaSchema>;

export const AtualizarTarefaSchema = z
  .object({ ...camposTarefa, posicao: z.number().finite(), arquivada: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nada para alterar');
export type AtualizarTarefaInput = z.infer<typeof AtualizarTarefaSchema>;

export const ChecklistSchema = z.object({ texto: texto(300).min(1, 'informe o item') }).strict();
export const AtualizarChecklistSchema = z
  .object({ texto: texto(300).min(1, 'informe o item'), feito: z.boolean() })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nada para alterar');
export const ComentarioSchema = z.object({ corpo: texto(5000).min(1, 'escreva o comentário') }).strict();

const camposEvento = {
  titulo: texto(200).min(1, 'informe o título'),
  inicioEm: data,
  fimEm: data.nullable(),
  diaInteiro: z.boolean(),
  local: opcional(300),
  notas: opcional(5000),
  clientId: id.nullable(),
  participantes: z.array(id).max(50).transform((l) => [...new Set(l)]),
};
export const CriarEventoSchema = z
  .object(camposEvento)
  .partial()
  .required({ titulo: true, inicioEm: true })
  .strict()
  .refine((v) => !v.fimEm || v.fimEm >= v.inicioEm, { message: 'o fim precisa ser depois do início', path: ['fimEm'] });
export type CriarEventoInput = z.infer<typeof CriarEventoSchema>;
export const AtualizarEventoSchema = z
  .object(camposEvento)
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'nada para alterar');
export type AtualizarEventoInput = z.infer<typeof AtualizarEventoSchema>;

export function validar<S extends z.ZodTypeAny>(schema: S, bruto: unknown): z.infer<S> {
  const r = schema.safeParse(bruto ?? {});
  if (!r.success) throw erroZod(r.error);
  return r.data;
}

function erroZod(e: ZodError): BadRequestException {
  const problemas = e.issues.map((i) => i.message);
  return new BadRequestException({ message: problemas[0] ?? 'dados inválidos', code: 'daily_invalido', problemas });
}

/** Filtros de listagem vindos da query string. Valores desconhecidos são ignorados (nunca 400 por filtro). */
export interface FiltrosTarefa {
  escopo: 'minhas' | 'todas';
  clientId?: string;
  responsavel?: string;
  status: Status[];
  tipo: Tipo[];
  prioridade: string[];
  prazo?: (typeof PRAZOS)[number];
  q?: string;
  arquivadas: boolean;
  /** Só conteúdos (Studio). */
  studio: boolean;
  aprovacao: Aprovacao[];
  plataforma: string[];
}

const lista = <T extends string>(v: unknown, validos: readonly T[]): T[] =>
  typeof v === 'string' ? v.split(',').filter((x): x is T => (validos as readonly string[]).includes(x)) : [];
const uuid = (v: unknown): string | undefined => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : undefined);

export function lerFiltros(q: Record<string, unknown>, studio = false): FiltrosTarefa {
  const prazo = typeof q.prazo === 'string' && (PRAZOS as readonly string[]).includes(q.prazo) ? (q.prazo as FiltrosTarefa['prazo']) : undefined;
  const responsavel = q.responsavel === 'eu' || q.responsavel === 'nenhum' ? q.responsavel : uuid(q.responsavel);
  return {
    escopo: q.escopo === 'minhas' ? 'minhas' : 'todas',
    clientId: q.cliente === 'interno' ? 'interno' : uuid(q.cliente),
    responsavel,
    status: lista(q.status, STATUS),
    tipo: lista(q.tipo, studio ? TIPOS_CONTEUDO : TIPOS),
    prioridade: lista(q.prioridade, PRIORIDADES),
    prazo,
    q: typeof q.q === 'string' && q.q.trim() ? q.q.trim().slice(0, 100) : undefined,
    arquivadas: q.arquivadas === '1',
    studio,
    aprovacao: lista(q.aprovacao, APROVACOES),
    plataforma: lista(q.plataforma, PLATAFORMAS),
  };
}

/**
 * Efeitos colaterais de uma mudança de status/aprovação, como no KROMA:
 * - concluir marca `concluidaEm`; reabrir limpa;
 * - aprovação "publicado" conclui a tarefa e marca `publicadoEm`;
 * - sair de "publicado" limpa `publicadoEm` e reabre a tarefa;
 * - virar tipo de conteúdo ganha aprovação "em produção".
 */
export function transicao(
  atual: { status: string; tipo: string; aprovacao: string | null; concluidaEm: Date | null; publicadoEm: Date | null },
  patch: { status?: string; tipo?: string; aprovacao?: string },
  agora = new Date(),
): { status?: string; aprovacao?: string | null; concluidaEm?: Date | null; publicadoEm?: Date | null } {
  const out: { status?: string; aprovacao?: string | null; concluidaEm?: Date | null; publicadoEm?: Date | null } = {};
  const tipo = patch.tipo ?? atual.tipo;
  let aprovacao = patch.aprovacao ?? atual.aprovacao;
  if (ehConteudo(tipo) && !aprovacao) aprovacao = 'em_producao';
  if (aprovacao !== atual.aprovacao) out.aprovacao = aprovacao;

  let status = patch.status ?? atual.status;
  if (patch.aprovacao && patch.aprovacao !== atual.aprovacao) {
    if (patch.aprovacao === 'publicado') {
      status = 'concluida';
      out.publicadoEm = atual.publicadoEm ?? agora;
    } else if (atual.aprovacao === 'publicado') {
      out.publicadoEm = null;
      if (!patch.status && status === 'concluida') status = 'em_andamento';
    }
  }
  if (status !== atual.status) out.status = status;
  if (status === 'concluida' && atual.status !== 'concluida') out.concluidaEm = agora;
  if (status !== 'concluida' && atual.status === 'concluida') out.concluidaEm = null;
  return out;
}

/** Início do dia (00:00) no fuso informado, como instante UTC. */
export function inicioDoDia(fuso: string, base = new Date(), somarDias = 0): Date {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(base);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: fuso, timeZoneName: 'longOffset' })
    .formatToParts(base)
    .find((p) => p.type === 'timeZoneName')?.value.replace('GMT', '') || '+00:00';
  const d = new Date(`${partes}T00:00:00${offset}`);
  d.setUTCDate(d.getUTCDate() + somarDias);
  return d;
}

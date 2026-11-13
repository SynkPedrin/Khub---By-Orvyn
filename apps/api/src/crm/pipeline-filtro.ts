import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Filtro do quadro/lista do Pipeline (Q2.1). Lido da query string de
 * `GET /v1/crm/pipeline` e convertido em `Prisma.DealWhereInput` (nada vira
 * SQL concatenado). A web guarda os mesmos nomes na URL, então um link
 * filtrado é compartilhável.
 *
 * `status` padrão é `abertos`: o contrato anterior do quadro (ganhos e
 * perdidos fora) continua igual para quem não pede outra coisa.
 */

export const STATUS_FILTRO = ['abertos', 'ganhos', 'perdidos', 'todos'] as const;
export type StatusFiltro = (typeof STATUS_FILTRO)[number];
const STATUS_DEAL: Record<Exclude<StatusFiltro, 'todos'>, string> = { abertos: 'aberto', ganhos: 'ganho', perdidos: 'perdido' };

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const VALOR = z.coerce.number().finite().min(0).max(1e12);

export const filtroNegociosSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    /** identityId do dono, ou `nenhum` para "sem dono". */
    ownerId: z.union([z.string().uuid(), z.literal('nenhum')]).optional(),
    origem: z.string().trim().min(1).max(80).optional(),
    /** Tag do CONTATO do negócio (tag principal ou lista de tags). */
    tag: z.string().trim().min(1).max(40).optional(),
    valorMin: VALOR.optional(),
    valorMax: VALOR.optional(),
    status: z.enum(STATUS_FILTRO).optional(),
    criadoDe: z.string().regex(DATA).optional(),
    criadoAte: z.string().regex(DATA).optional(),
  })
  .strict();
export type FiltroNegocios = z.infer<typeof filtroNegociosSchema>;

export const CHAVES_FILTRO_NEGOCIOS = ['q', 'ownerId', 'origem', 'tag', 'valorMin', 'valorMax', 'status', 'criadoDe', 'criadoAte'] as const;

/**
 * Query string → filtro validado. Chave desconhecida é ignorada (`pipelineId`,
 * cache-buster); chave conhecida com valor inválido é 400. Vazio = ausente.
 */
export function filtroNegociosDaQuery(query: Record<string, unknown>): FiltroNegocios {
  const bruto: Record<string, unknown> = {};
  for (const k of CHAVES_FILTRO_NEGOCIOS) {
    const v = query[k];
    const valor = Array.isArray(v) ? v[v.length - 1] : v;
    if (typeof valor === 'string' && valor.trim() !== '') bruto[k] = valor;
  }
  const r = filtroNegociosSchema.safeParse(bruto);
  if (!r.success) throw new BadRequestException(`filtro inválido: ${r.error.issues.map((i) => `${i.path.join('.') || 'filtro'} ${i.message}`).join('; ')}`);
  const f = r.data;
  if (f.q === '') delete f.q;
  if (f.valorMin !== undefined && f.valorMax !== undefined && f.valorMin > f.valorMax) throw new BadRequestException('filtro inválido: valor mínimo maior que o máximo');
  if (f.criadoDe && f.criadoAte && f.criadoDe > f.criadoAte) throw new BadRequestException('filtro inválido: "criado de" depois de "criado até"');
  return f;
}

/** Início do dia em Brasília (UTC-3, sem horário de verão desde 2019), igual ao filtro de contatos. */
const inicioDoDiaBR = (d: string) => new Date(`${d}T00:00:00.000-03:00`);

/** Filtro → `where` dos negócios de UM funil. */
export function whereDosNegocios(pipelineId: string, f: FiltroNegocios): Prisma.DealWhereInput {
  const and: Prisma.DealWhereInput[] = [{ pipelineId }];
  const like = (v: string) => ({ contains: v, mode: 'insensitive' as const });
  const status = f.status ?? 'abertos';
  if (status !== 'todos') and.push({ status: STATUS_DEAL[status] });
  if (f.q) and.push({ OR: [{ titulo: like(f.q) }, { contact: { nome: like(f.q) } }] });
  if (f.ownerId) and.push({ ownerId: f.ownerId === 'nenhum' ? null : f.ownerId });
  if (f.origem) and.push({ origem: { equals: f.origem, mode: 'insensitive' } });
  if (f.tag) and.push({ contact: { OR: [{ tags: { has: f.tag } }, { tag: { equals: f.tag, mode: 'insensitive' } }] } });
  if (f.valorMin !== undefined) and.push({ valor: { gte: f.valorMin } });
  if (f.valorMax !== undefined) and.push({ valor: { lte: f.valorMax } });
  if (f.criadoDe) and.push({ createdAt: { gte: inicioDoDiaBR(f.criadoDe) } });
  if (f.criadoAte) {
    const fim = inicioDoDiaBR(f.criadoAte);
    fim.setUTCDate(fim.getUTCDate() + 1);
    and.push({ createdAt: { lt: fim } });
  }
  return { AND: and };
}

/** Quantos filtros de verdade estão ligados (`status=abertos` é o padrão, não conta). */
export function filtrosAtivos(f: FiltroNegocios): number {
  return CHAVES_FILTRO_NEGOCIOS.filter((k) => f[k] !== undefined && !(k === 'status' && f.status === 'abertos')).length;
}

export interface TotaisFunil {
  negocios: number;
  valor: number;
  abertos: number;
  valorAberto: number;
  ganhos: number;
  valorGanho: number;
  perdidos: number;
  valorPerdido: number;
}

/** Totais do funil sobre os negócios já filtrados (o topo da tela respeita o filtro). */
export function totaisDoFunil(negocios: { status: string; valor: number }[]): TotaisFunil {
  const t: TotaisFunil = { negocios: 0, valor: 0, abertos: 0, valorAberto: 0, ganhos: 0, valorGanho: 0, perdidos: 0, valorPerdido: 0 };
  for (const n of negocios) {
    t.negocios++;
    t.valor += n.valor;
    if (n.status === 'ganho') { t.ganhos++; t.valorGanho += n.valor; }
    else if (n.status === 'perdido') { t.perdidos++; t.valorPerdido += n.valor; }
    else { t.abertos++; t.valorAberto += n.valor; }
  }
  return t;
}

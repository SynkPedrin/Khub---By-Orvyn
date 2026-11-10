import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { soDigitos } from './telefone';

/**
 * Contrato ÚNICO de filtro da lista de Leads/Contatos (Q2.2). O mesmo objeto
 * serve a três lugares, e é isso que garante que eles não divergem:
 *   1. a query string de `GET /v1/crm/contacts`;
 *   2. o modo "todos os do filtro" de `POST /v1/crm/contacts/bulk`;
 *   3. o jsonb `filtros` de uma lista salva (`contact_views`).
 * Nada daqui vira SQL por concatenação: vira `Prisma.ContactWhereInput`.
 */

export const ORDENS = ['recentes', 'antigos', 'nome_az', 'nome_za', 'valor_desc', 'atualizados'] as const;
export type OrdemContatos = (typeof ORDENS)[number];

/** Colunas que a tela sabe exibir (lista salva guarda um subconjunto, em ordem). */
export const COLUNAS = ['nome', 'email', 'telefone', 'empresa', 'tags', 'etapa', 'origem', 'dono', 'valor', 'criadoEm', 'ultimoContato', 'naoPerturbe'] as const;

const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** Mesma regra de chave de campo personalizado usada no import. */
export const CHAVE_CAMPO = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;

export const filtroSchema = z
  .object({
    q: z.string().trim().max(120).optional(),
    stageId: z.string().uuid().optional(),
    origem: z.string().trim().min(1).max(80).optional(),
    tag: z.string().trim().min(1).max(40).optional(),
    /** identityId do dono, ou `nenhum` para "sem dono". */
    ownerId: z.union([z.string().uuid(), z.literal('nenhum')]).optional(),
    naoPerturbe: z.enum(['sim', 'nao']).optional(),
    criadoDe: z.string().regex(DATA).optional(),
    criadoAte: z.string().regex(DATA).optional(),
    /** Campo personalizado: igualdade textual em `campos_custom->>chave`. */
    cf: z.record(z.string().regex(CHAVE_CAMPO), z.string().trim().min(1).max(200)).optional(),
  })
  .strict();
export type FiltroContatos = z.infer<typeof filtroSchema>;

/** Valida um filtro vindo de JSON (bulk, lista salva). */
export function parseFiltro(bruto: unknown): FiltroContatos {
  const r = filtroSchema.safeParse(bruto ?? {});
  if (!r.success) throw new BadRequestException(`filtro inválido: ${r.error.issues.map((i) => `${i.path.join('.') || 'filtro'} ${i.message}`).join('; ')}`);
  // vazio é igual a ausente: `?tag=` não pode virar "tag igual a nada"
  const f: FiltroContatos = {};
  for (const [k, v] of Object.entries(r.data) as [keyof FiltroContatos, unknown][]) {
    if (v === undefined || v === '') continue;
    if (k === 'cf' && v && typeof v === 'object' && !Object.keys(v).length) continue;
    (f as Record<string, unknown>)[k] = v;
  }
  if (f.criadoDe && f.criadoAte && f.criadoDe > f.criadoAte) throw new BadRequestException('filtro inválido: "criado de" depois de "criado até"');
  return f;
}

const CHAVES_QUERY = new Set(['q', 'stageId', 'origem', 'tag', 'ownerId', 'naoPerturbe', 'criadoDe', 'criadoAte']);

/**
 * Lê o filtro da query string (`cf_<chave>=<valor>` vira `cf.chave`). Chave
 * desconhecida é ignorada (cache-buster, `cursor`, `limit`...), mas chave
 * conhecida com valor inválido é 400.
 */
export function filtroDaQuery(query: Record<string, unknown>): FiltroContatos {
  const bruto: Record<string, unknown> = {};
  const cf: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) {
    const valor = Array.isArray(v) ? v[v.length - 1] : v;
    if (typeof valor !== 'string' || valor === '') continue;
    if (k.startsWith('cf_')) cf[k.slice(3)] = valor;
    else if (CHAVES_QUERY.has(k)) bruto[k] = valor;
  }
  if (Object.keys(cf).length) bruto.cf = cf;
  return parseFiltro(bruto);
}

export function parseOrdem(v: unknown): OrdemContatos {
  if (v === undefined || v === null || v === '') return 'recentes';
  if (typeof v === 'string' && (ORDENS as readonly string[]).includes(v)) return v as OrdemContatos;
  throw new BadRequestException(`ordem inválida (use: ${ORDENS.join(', ')})`);
}

/**
 * Ordenação SEMPRE com `id` como desempate: o cursor nativo do Prisma (keyset)
 * só é estável com ordem total. Só colunas NOT NULL entram aqui — keyset com
 * coluna nula pula linhas (comparação com NULL não é verdadeira nem falsa).
 */
export function orderByDaOrdem(ordem: OrdemContatos): Prisma.ContactOrderByWithRelationInput[] {
  switch (ordem) {
    case 'antigos': return [{ createdAt: 'asc' }, { id: 'asc' }];
    case 'nome_az': return [{ nome: 'asc' }, { id: 'asc' }];
    case 'nome_za': return [{ nome: 'desc' }, { id: 'desc' }];
    case 'valor_desc': return [{ valorEstimado: 'desc' }, { id: 'desc' }];
    case 'atualizados': return [{ updatedAt: 'desc' }, { id: 'desc' }];
    default: return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

/** Dígitos suficientes para valer a busca por telefone normalizado. */
export function digitosDaBusca(q: string | undefined): string | null {
  if (!q) return null;
  // só quando o termo é "cara de telefone" (dígitos, espaço, + ( ) -)
  if (!/^[\d\s+().-]+$/.test(q)) return null;
  const d = soDigitos(q);
  return d.length >= 4 ? d : null;
}

/** Início do dia em Brasília (UTC-3, sem horário de verão desde 2019). */
const inicioDoDiaBR = (d: string) => new Date(`${d}T00:00:00.000-03:00`);

/**
 * Filtro → `where` do Prisma. `idsPorTelefone` são os contatos cujo telefone
 * NORMALIZADO contém os dígitos buscados (resolvido no banco pelo serviço):
 * `+55 11 97777-1234` precisa aparecer quando a pessoa digita `977771234`.
 */
export function whereDoFiltro(f: FiltroContatos, idsPorTelefone: string[] = [], condicoesCampos?: Prisma.ContactWhereInput[]): Prisma.ContactWhereInput {
  const and: Prisma.ContactWhereInput[] = [];
  const like = (v: string) => ({ contains: v, mode: 'insensitive' as const });

  if (f.q) {
    // empresa e tag continuam na busca livre (contrato anterior de `?q=`)
    const or: Prisma.ContactWhereInput[] = [{ nome: like(f.q) }, { email: like(f.q) }, { telefone: like(f.q) }, { empresa: like(f.q) }, { tag: like(f.q) }];
    if (idsPorTelefone.length) or.push({ id: { in: idsPorTelefone } });
    and.push({ OR: or });
  }
  if (f.stageId) and.push({ deals: { some: { stageId: f.stageId, status: 'aberto' } } });
  if (f.origem) {
    and.push({ OR: [{ origem: { equals: f.origem, mode: 'insensitive' } }, { camposCustom: { path: ['lead_origem'], equals: f.origem } }] });
  }
  if (f.tag) and.push({ OR: [{ tags: { has: f.tag } }, { tag: { equals: f.tag, mode: 'insensitive' } }] });
  if (f.ownerId) and.push({ ownerId: f.ownerId === 'nenhum' ? null : f.ownerId });
  if (f.naoPerturbe) and.push({ optedOutAt: f.naoPerturbe === 'sim' ? { not: null } : null });
  if (f.criadoDe) and.push({ createdAt: { gte: inicioDoDiaBR(f.criadoDe) } });
  if (f.criadoAte) {
    const fim = inicioDoDiaBR(f.criadoAte);
    fim.setUTCDate(fim.getUTCDate() + 1);
    and.push({ createdAt: { lt: fim } });
  }
  // Com as definições (Q2.3, `filtroCamposContato`) o filtro respeita o tipo
  // (número, data com _min/_max, multiselect); sem elas, igualdade textual.
  if (condicoesCampos) and.push(...condicoesCampos);
  else for (const [chave, valor] of Object.entries(f.cf ?? {})) and.push({ camposCustom: { path: [chave], equals: valor } });

  return and.length ? { AND: and } : {};
}

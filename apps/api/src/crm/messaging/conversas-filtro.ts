import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Filtros da lista de Conversas (desenho do mockup da LP, 2026-11-11): canal,
 * status, etiqueta, tipo e busca. Puro (sem banco) para ser testado sozinho;
 * o serviço só monta a consulta com o fragmento devolvido aqui, SEMPRE dentro
 * de `withTenant` (o RLS decide o tenant, o filtro só estreita).
 */

/** Canais que a coluna "Canais" conhece (valor gravado em `conversations.canal`). */
export const CANAIS = ['WhatsApp', 'Instagram', 'Messenger', 'Facebook', 'YouTube', 'TikTok', 'E-mail', 'Site'] as const;
export type CanalConversa = (typeof CANAIS)[number];

/**
 * Status da coluna "Status". Derivados, não gravados (exceto `resolvidas`):
 * - `nao_lidas`: tem mensagem não lida e não está resolvida;
 * - `em_atendimento`: aberta e com alguém respondendo (responsável humano OU a IA);
 * - `aguardando`: aberta e a última mensagem é do CLIENTE (ele espera a resposta da equipe);
 * - `resolvidas`: marcada como resolvida (`conversations.status = 'resolvida'`).
 */
export const STATUS_CONVERSA = ['todas', 'nao_lidas', 'em_atendimento', 'aguardando', 'resolvidas'] as const;
export type StatusConversa = (typeof STATUS_CONVERSA)[number];

export const TIPOS_CONVERSA = ['dm', 'comentario'] as const;
export type TipoConversa = (typeof TIPOS_CONVERSA)[number];

export interface FiltroConversas {
  canal?: CanalConversa;
  status: StatusConversa;
  etiqueta?: string;
  tipo?: TipoConversa;
  q?: string;
}

const um = (v: unknown): string | undefined => {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : undefined;
};

/** Query string → filtro validado. Valor desconhecido = 400 (nunca ignorado em silêncio). */
export function filtroConversasDaQuery(query: Record<string, unknown>): FiltroConversas {
  const canal = um(query.canal);
  if (canal && canal !== 'todos' && !(CANAIS as readonly string[]).includes(canal)) {
    throw new BadRequestException(`canal inválido: use ${CANAIS.join(', ')}`);
  }
  const status = um(query.status) ?? 'todas';
  if (!(STATUS_CONVERSA as readonly string[]).includes(status)) throw new BadRequestException(`status inválido: use ${STATUS_CONVERSA.join(', ')}`);
  const tipo = um(query.tipo);
  if (tipo && !(TIPOS_CONVERSA as readonly string[]).includes(tipo)) throw new BadRequestException('tipo inválido: use dm ou comentario');
  const etiqueta = um(query.etiqueta);
  if (etiqueta && etiqueta.length > 40) throw new BadRequestException('etiqueta muito longa');
  const q = um(query.q);
  if (q && q.length > 120) throw new BadRequestException('busca muito longa');
  return {
    canal: canal && canal !== 'todos' ? (canal as CanalConversa) : undefined,
    status: status as StatusConversa,
    etiqueta,
    tipo: tipo as TipoConversa | undefined,
    q,
  };
}

/** Autor da última mensagem da conversa `c` (subconsulta; índice idx_messages_conv). */
export const ULTIMO_AUTOR = Prisma.sql`(SELECT m.autor_tipo FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1)`;

/** Condição SQL de cada status sobre `c` (conversations). */
export function condicaoStatus(status: StatusConversa): Prisma.Sql {
  switch (status) {
    case 'nao_lidas':
      return Prisma.sql`c.nao_lidas > 0 AND c.status <> 'resolvida'`;
    case 'em_atendimento':
      return Prisma.sql`c.status <> 'resolvida' AND (c.assignee_id IS NOT NULL OR c.atendimento = 'ia')`;
    case 'aguardando':
      return Prisma.sql`c.status <> 'resolvida' AND ${ULTIMO_AUTOR} = 'contato'`;
    case 'resolvidas':
      return Prisma.sql`c.status = 'resolvida'`;
    default:
      return Prisma.sql`TRUE`;
  }
}

/** Escapa `%`, `_` e `\` para o ILIKE tratar a busca como texto literal. */
export function literalLike(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * WHERE completo sobre `c` (conversations) e `ct` (contacts, LEFT JOIN).
 * Etiqueta compara sem caixa contra a tag principal e as tags do contato.
 */
export function whereConversas(f: FiltroConversas): Prisma.Sql {
  const partes: Prisma.Sql[] = [condicaoStatus(f.status)];
  if (f.canal) partes.push(Prisma.sql`c.canal = ${f.canal}`);
  if (f.tipo) partes.push(Prisma.sql`c.tipo = ${f.tipo}`);
  if (f.etiqueta) {
    partes.push(Prisma.sql`(lower(ct.tag) = lower(${f.etiqueta}) OR EXISTS (SELECT 1 FROM unnest(ct.tags) t WHERE lower(t) = lower(${f.etiqueta})))`);
  }
  if (f.q) {
    const like = literalLike(f.q);
    const digitos = f.q.replace(/\D/g, '');
    partes.push(
      digitos.length >= 4
        ? Prisma.sql`(c.nome ILIKE ${like} OR c.ultima_previa ILIKE ${like} OR regexp_replace(coalesce(ct.telefone, ''), '\\D', '', 'g') LIKE ${'%' + digitos + '%'})`
        : Prisma.sql`(c.nome ILIKE ${like} OR c.ultima_previa ILIKE ${like})`,
    );
  }
  return Prisma.join(partes, ' AND ');
}

/** Etiquetas únicas de um contato (tag principal + tags), na ordem, sem vazias. */
export function etiquetasDoContato(c: { tag?: string | null; tags?: string[] | null } | null | undefined): string[] {
  if (!c) return [];
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const t of [c.tag ?? '', ...(c.tags ?? [])]) {
    const v = t.trim();
    if (!v || vistas.has(v.toLowerCase())) continue;
    vistas.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}

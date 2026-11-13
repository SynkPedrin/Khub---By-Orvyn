import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { filtroSchema, parseFiltro, whereDoFiltro, type FiltroContatos } from '../crm/contatos-filtro';
import { idsPorTelefone } from '../crm/contatos-sql';
import { filtroCamposContato } from '../crm/custom-fields.service';
import { soDigitos } from '../crm/telefone';

/**
 * Segmento de um disparo (Q4.3). Reusa o contrato ÚNICO de filtro da lista de
 * Leads (contatos-filtro.ts: tag, etapa, origem, dono, `cf_*`...) e soma:
 *   * `tags`: qualquer uma destas tags (o filtro da lista aceita uma só);
 *   * `viewId`: uma lista salva (`contact_views`, db/052), cujos filtros
 *     entram em AND com os demais.
 * Nada vira SQL por concatenação: tudo vira `Prisma.ContactWhereInput`.
 */
export const segmentoSchema = z
  .object({
    filtro: filtroSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    viewId: z.string().uuid().optional(),
  })
  .strict();
export type Segmento = z.infer<typeof segmentoSchema>;

export type Canal = 'whatsapp' | 'email';

export function parseSegmento(bruto: unknown): Segmento {
  const r = segmentoSchema.safeParse(bruto ?? {});
  if (!r.success) throw new BadRequestException(`segmento inválido: ${r.error.issues.map((i) => `${i.path.join('.') || 'segmento'} ${i.message}`).join('; ')}`);
  return { ...r.data, filtro: r.data.filtro ? parseFiltro(r.data.filtro) : undefined };
}

/** Filtro da lista salva + filtro do disparo (o do disparo vence em chave repetida). */
async function filtroEfetivo(tx: Prisma.TransactionClient, seg: Segmento, identityId: string | null): Promise<FiltroContatos> {
  if (!seg.viewId) return seg.filtro ?? {};
  const view = await tx.contactView.findUnique({ where: { id: seg.viewId }, select: { filtros: true, compartilhada: true, ownerIdentityId: true } });
  if (!view) throw new BadRequestException('lista salva não encontrada');
  if (identityId && !view.compartilhada && view.ownerIdentityId !== identityId) throw new BadRequestException('lista salva é particular de outra pessoa');
  const daLista = parseFiltro(view.filtros);
  const meu = seg.filtro ?? {};
  return { ...daLista, ...meu, ...(daLista.cf || meu.cf ? { cf: { ...(daLista.cf ?? {}), ...(meu.cf ?? {}) } } : {}) };
}

/** `where` do segmento (dentro da transação do chamador, sob RLS). */
export async function whereDoSegmento(tx: Prisma.TransactionClient, seg: Segmento, identityId: string | null): Promise<Prisma.ContactWhereInput> {
  const f = await filtroEfetivo(tx, seg, identityId);
  const base = whereDoFiltro(f, await idsPorTelefone(tx, f.q), await filtroCamposContato(tx, f.cf));
  if (!seg.tags?.length) return base;
  const tags = seg.tags;
  const porTag: Prisma.ContactWhereInput = { OR: [{ tags: { hasSome: tags } }, ...tags.map((t) => ({ tag: { equals: t, mode: 'insensitive' as const } }))] };
  return { AND: [base, porTag] };
}

export type Elegibilidade = 'elegivel' | 'ignorado_optout' | 'ignorado_sem_canal';

/** Destino do canal (telefone em dígitos ou e-mail), ou null se não serve. */
export function destinoDoContato(canal: Canal, c: { telefone: string | null; email: string | null }): string | null {
  if (canal === 'whatsapp') {
    const d = soDigitos(c.telefone);
    return d.length >= 10 && d.length <= 15 ? d : null;
  }
  const e = (c.email ?? '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e.toLowerCase() : null;
}

/** Opt-out vence tudo (LGPD); depois, sem canal. */
export function elegibilidade(canal: Canal, c: { telefone: string | null; email: string | null; optedOutAt: Date | null }): Elegibilidade {
  if (c.optedOutAt) return 'ignorado_optout';
  return destinoDoContato(canal, c) ? 'elegivel' : 'ignorado_sem_canal';
}

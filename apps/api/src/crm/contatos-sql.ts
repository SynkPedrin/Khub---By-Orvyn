import type { Prisma } from '@prisma/client';
import { digitosDaBusca } from './contatos-filtro';

/** Teto de ids que a busca por telefone injeta no `where` (é um `IN (...)`). */
const MAX_IDS_TELEFONE = 2000;

/**
 * Contatos cujo telefone NORMALIZADO contém os dígitos buscados. O banco guarda
 * o telefone como veio (`+55 11 97777-1234`); `contains` do Prisma sobre o
 * texto cru não acha `977771234`. Mesma expressão `[^0-9]` do helper de
 * telefone (ver o comentário de armadilhas em telefone.ts).
 */
export async function idsPorTelefone(tx: Prisma.TransactionClient, q: string | undefined): Promise<string[]> {
  const d = digitosDaBusca(q);
  if (!d) return [];
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM contacts
    WHERE telefone IS NOT NULL
      AND regexp_replace(telefone, '[^0-9]', '', 'g') LIKE ${`%${d}%`}
    LIMIT ${MAX_IDS_TELEFONE}::int`;
  return rows.map((r) => r.id);
}

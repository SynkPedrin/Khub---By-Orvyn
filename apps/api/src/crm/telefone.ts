import type { Prisma } from '@prisma/client';

/** `+55 11 97777-1234` → `5511977771234`. */
export const soDigitos = (t: string | null | undefined): string => (t ?? '').replace(/\D/g, '');

/**
 * Comprimento da comparação. Os últimos 8 dígitos são o número local sem DDD —
 * o pedaço que não muda entre `+55 11 97777-1234`, `5511977771234` e
 * `011977771234`. Comparar mais que isso faz o mesmo contato virar duas pessoas
 * (foi o que aconteceu: BUG-012); comparar menos gera falso positivo.
 */
const CAUDA = 8;

/**
 * Acha o contato pelo telefone **normalizando os dois lados**.
 *
 * O erro clássico aqui é comparar dígitos crus (`77771234`) com o valor
 * formatado do banco (`+55 11 97777-1234`): o traço quebra o match e o sistema
 * cria um contato duplicado. Por isso a normalização acontece no SQL, com
 * índice funcional (db/012) sustentando a igualdade.
 */
export async function acharContatoPorTelefone(
  tx: Prisma.TransactionClient,
  telefone: string | null | undefined,
): Promise<string | null> {
  const d = soDigitos(telefone);
  if (d.length < CAUDA) return null;
  const cauda = d.slice(-CAUDA);
  // Duas armadilhas nesta query, ambas custaram bug:
  //  1. `::int` — o driver manda número JS como bigint e não existe
  //     `right(text, bigint)`: a função não resolve (42883). Igual ao BUG-007.
  //  2. `[^0-9]` em vez de `\D` — em template literal do JS, '\D' vira 'D'
  //     (a barra some em escape desconhecido) e o Postgres receberia
  //     `regexp_replace(telefone,'D','','g')`, que apaga a LETRA D e não a
  //     máscara. A query rodava sem erro e simplesmente não achava ninguém.
  //     O índice de db/012 usa esta MESMA expressão — se divergir, vira scan.
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM contacts
    WHERE telefone IS NOT NULL
      AND right(regexp_replace(telefone, '[^0-9]', '', 'g'), ${CAUDA}::int) = ${cauda}
    ORDER BY created_at ASC
    LIMIT 1`;
  return rows[0]?.id ?? null;
}

import { Prisma } from '@prisma/client';

type Tx = Prisma.TransactionClient;

export interface LinhaOutbox {
  id: string;
  status: string;
  /** false = o evento já existia (reentrega do provedor). */
  novo: boolean;
}

/**
 * Grava um evento no outbox de forma IDEMPOTENTE e atômica.
 *
 * `prisma.outboxEvent.upsert` faz SELECT e depois INSERT: duas entregas do
 * mesmo webhook ao mesmo tempo (o provedor reenvia quando a primeira demora)
 * passam as duas pelo SELECT e a segunda estoura a unique (tenant_id,
 * dedupe_key) → HTTP 500 → o provedor reenvia de novo (BUG-041, produção
 * 15/11). Aqui o próprio Postgres resolve: `ON CONFLICT DO NOTHING` espera a
 * outra transação, não aborta a nossa, e a releitura devolve a linha que já
 * existia — reentrega reconhecida, resposta 2xx, efeito uma vez só.
 */
export async function registrarNoOutbox(
  tx: Tx,
  e: { tenantId: string; kind: string; dedupeKey: string; payload: unknown },
): Promise<LinhaOutbox> {
  const json = JSON.stringify(e.payload ?? {});
  const inseridas = await tx.$queryRaw<{ id: string; status: string }[]>`
    INSERT INTO outbox_events (tenant_id, kind, dedupe_key, payload)
    VALUES (${e.tenantId}::uuid, ${e.kind}, ${e.dedupeKey}, ${json}::jsonb)
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING
    RETURNING id, status`;
  if (inseridas[0]) return { ...inseridas[0], novo: true };
  const existente = await tx.$queryRaw<{ id: string; status: string }[]>`
    SELECT id, status FROM outbox_events WHERE tenant_id = ${e.tenantId}::uuid AND dedupe_key = ${e.dedupeKey}`;
  if (!existente[0]) throw new Error('outbox: conflito sem linha existente (dedupe_key)');
  return { ...existente[0], novo: false };
}

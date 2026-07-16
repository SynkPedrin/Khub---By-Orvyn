#!/usr/bin/env node
/**
 * Backfill de embeddings do RAG (Sprint G). Preenche rag_chunks.embedding dos
 * chunks que estão NULL (ex.: a camada global ingerida sem Voyage).
 *
 * Escrita em base compartilhada (global/nicho) roda FORA do request path e como
 * role de serviço (BYPASSRLS) — invariante 2.
 *
 *   VOYAGE_API_KEY=... DATABASE_URL="postgresql://orvyn_service:...@localhost:5432/orvyn" \
 *     node apps/api/scripts/backfill-embeddings.mjs
 *
 * Sem VOYAGE_API_KEY o RAG continua funcionando por BM25 (fallback) — ver RegrasNegocio §6.2.
 */
import { PrismaClient } from '@prisma/client';

const KEY = process.env.VOYAGE_API_KEY;
const MODEL = process.env.VOYAGE_MODEL ?? 'voyage-3-large';
const BATCH = Number(process.env.RAG_EMBED_BATCH ?? 96);

if (!KEY) {
  console.error('VOYAGE_API_KEY ausente — nada a fazer (retrieval segue em BM25).');
  process.exit(1);
}

const prisma = new PrismaClient();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Voyage com retry exponencial + degradação explícita. */
async function embed(texts) {
  let lastErr;
  for (let a = 0; a < 4; a++) {
    try {
      const r = await fetch('https://api.voyageai.com/v1/embeddings', {
        method: 'POST',
        headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ input: texts, model: MODEL, input_type: 'document' }),
      });
      if (r.ok) {
        const j = await r.json();
        return j.data.sort((x, y) => x.index - y.index).map((d) => d.embedding);
      }
      const body = (await r.text()).slice(0, 200);
      if (r.status === 429 || r.status >= 500) { lastErr = new Error(`Voyage ${r.status}: ${body}`); await sleep(800 * 2 ** a); continue; }
      throw new Error(`Voyage ${r.status}: ${body}`);
    } catch (e) {
      lastErr = e;
      await sleep(800 * 2 ** a);
    }
  }
  throw lastErr ?? new Error('Voyage: falhou');
}

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT id::text AS id, conteudo FROM rag_chunks
    WHERE embedding IS NULL AND status = 'published' ORDER BY created_at`;
  console.log(`chunks sem embedding: ${rows.length} (modelo ${MODEL})`);
  if (!rows.length) return;

  let done = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const b = rows.slice(i, i + BATCH);
    const vecs = await embed(b.map((x) => x.conteudo));
    for (let k = 0; k < b.length; k++) {
      const literal = `[${vecs[k].join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE rag_chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3::uuid`,
        literal, MODEL, b[k].id,
      );
      done++;
    }
    console.log(`  ${done}/${rows.length}`);
  }
  console.log(`backfill concluído: ${done} chunks com embedding ${MODEL}`);
}

main()
  .catch((e) => { console.error(String(e)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

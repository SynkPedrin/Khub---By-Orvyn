#!/usr/bin/env node
/**
 * Re-embed LOCAL de todos os chunks publicados via Ollama (mxbai-embed-large,
 * 1024 dims — mesma dimensão da coluna vector(1024)).
 *
 * Por que TODOS e não só os que faltam: espaços vetoriais de modelos
 * diferentes não se misturam. Metade Voyage + metade mxbai na mesma coluna
 * tornaria a busca híbrida sem sentido. Depois deste script, tudo (documento
 * e query) fala o mesmo espaço vetorial — e sem depender da cota da Voyage.
 *
 *   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/orvyn" \
 *     node --env-file=.env scripts/reembed-ollama.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BASE = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '');
const MODEL = process.env.OLLAMA_EMBED_MODEL ?? 'mxbai-embed-large';
const BATCH = Number(process.env.RAG_EMBED_BATCH ?? 32);

async function embed(texts) {
  const r = await fetch(`${BASE}/api/embed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return (await r.json()).embeddings;
}

const rows = await prisma.$queryRaw`
  SELECT id::text AS id, conteudo FROM rag_chunks
  WHERE status = 'published' AND (embedding IS NULL OR embedding_model IS DISTINCT FROM ${MODEL})
  ORDER BY created_at`;
console.log(`re-embed local: ${rows.length} chunks (modelo ${MODEL})`);

let done = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const b = rows.slice(i, i + BATCH);
  const vecs = await embed(b.map((x) => x.conteudo.slice(0, 30_000)));
  for (let k = 0; k < b.length; k++) {
    await prisma.$executeRawUnsafe(
      `UPDATE rag_chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3::uuid`,
      `[${vecs[k].join(',')}]`, MODEL, b[k].id,
    );
    done++;
  }
  console.log(`  ${done}/${rows.length}`);
}
console.log(`concluído: ${done} chunks no espaço vetorial ${MODEL}`);
await prisma.$disconnect();

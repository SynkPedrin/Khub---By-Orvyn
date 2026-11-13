#!/usr/bin/env node
/**
 * Backfill de embeddings do RAG (Sprint G). Preenche rag_chunks.embedding dos
 * chunks que estão NULL (ex.: a camada global ingerida sem Voyage).
 *
 * Escrita em base compartilhada (global/nicho) roda FORA do request path e como
 * role de serviço (BYPASSRLS) — invariante 2.
 *
 *   VOYAGE_API_KEY=... DATABASE_URL="postgresql://khub_service:...@localhost:5432/orvyn" \
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
      // 429 no plano free da Voyage = janela de 60s saturada: espera a janela
      // virar (65s) em vez do backoff curto, que só queimava as 4 tentativas.
      if (r.status === 429) { lastErr = new Error(`Voyage 429: ${body}`); await sleep(65_000); continue; }
      if (r.status >= 500) { lastErr = new Error(`Voyage ${r.status}: ${body}`); await sleep(800 * 2 ** a); continue; }
      throw new Error(`Voyage ${r.status}: ${body}`);
    } catch (e) {
      lastErr = e;
      await sleep(800 * 2 ** a);
    }
  }
  throw lastErr ?? new Error('Voyage: falhou');
}

const estTokens = (s) => Math.ceil(s.length / 4);
/** Plano free: 10K TPM por minuto. Lote por ORÇAMENTO DE TOKENS (não por
 *  contagem): um chunk gigante num lote de N fazia toda tentativa voltar 429,
 *  eternamente. Chunk que SOZINHO passa do teto vai truncado — embedding de
 *  texto truncado é prática padrão e não muda o conteúdo gravado. */
const ORCAMENTO_LOTE = Number(process.env.RAG_EMBED_TOKEN_BUDGET ?? 8000);
const MAX_CHARS_CHUNK = ORCAMENTO_LOTE * 4 - 200;

async function main() {
  const rows = await prisma.$queryRaw`
    SELECT id::text AS id, conteudo FROM rag_chunks
    WHERE embedding IS NULL AND status = 'published' ORDER BY created_at`;
  console.log(`chunks sem embedding: ${rows.length} (modelo ${MODEL})`);
  if (!rows.length) return;

  const lotes = [];
  let atual = [];
  let tokensAtual = 0;
  for (const r of rows) {
    const t = estTokens(r.conteudo);
    if (atual.length && (atual.length >= BATCH || tokensAtual + t > ORCAMENTO_LOTE)) {
      lotes.push(atual); atual = []; tokensAtual = 0;
    }
    atual.push(r); tokensAtual += t;
  }
  if (atual.length) lotes.push(atual);

  let done = 0;
  for (const b of lotes) {
    const vecs = await embed(b.map((x) => x.conteudo.slice(0, MAX_CHARS_CHUNK)));
    for (let k = 0; k < b.length; k++) {
      const literal = `[${vecs[k].join(',')}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE rag_chunks SET embedding = $1::vector, embedding_model = $2 WHERE id = $3::uuid`,
        literal, MODEL, b[k].id,
      );
      done++;
    }
    console.log(`  ${done}/${rows.length}`);
    // Respiro entre lotes (RAG_EMBED_INTERVAL_MS) — plano sem billing da Voyage
    // limita a ~3 RPM; sem pausa o retry exponencial curto não aguenta.
    const intervalo = Number(process.env.RAG_EMBED_INTERVAL_MS ?? 0);
    if (intervalo > 0 && done < rows.length) await sleep(intervalo);
  }
  console.log(`backfill concluído: ${done} chunks com embedding ${MODEL}`);
}

main()
  .catch((e) => { console.error(String(e)); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

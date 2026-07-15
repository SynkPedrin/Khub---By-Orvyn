#!/usr/bin/env node
/**
 * Ingestão da CAMADA GLOBAL do RAG (inteligência de marketing/operação da Nyro).
 * Lê Nyro IA/cerebro/RAG/conhecimento/global/{marketing,operacao}/*.md, parseia o
 * frontmatter -> metadados, faz chunk por seção `##` e EMITE SQL para inserir em
 * rag_documents/rag_chunks com escopo='global'.
 *
 * Bases global/nicho são conhecimento COMPARTILHADO: escritas fora do request path
 * (invariante 2). Aplicar como orvyn_service/superuser:
 *   node apps/api/scripts/seed-global-rag.mjs | docker exec -i orvyn-postgres psql -U postgres -d orvyn -v ON_ERROR_STOP=1
 *
 * embedding fica NULL (busca por BM25/tsvector já funciona). Backfill dos vetores
 * quando VOYAGE_API_KEY existir (job rag.reembed / R4.4).
 */
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..', 'Nyro IA', 'cerebro', 'RAG', 'conhecimento', 'global');
const DOMAINS = ['marketing', 'operacao'];
const DOLLAR = '$ORV$'; // dollar-quote tag (o conteúdo não contém esta sequência)

const dq = (s) => `${DOLLAR}${s ?? ''}${DOLLAR}`;
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const estTokens = (s) => Math.ceil(s.length / 4);

function parseFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fm: {}, body: raw };
  const fm = {};
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (!kv) continue;
    let v = kv[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) {
      v = v.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, '');
    }
    fm[kv[1]] = v;
  }
  return { fm, body: m[2] };
}

/** Chunk por seção `##`. O bloco antes da 1ª `##` (título + intro) vira o chunk 0. */
function chunkBySection(body, titulo) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let cur = { head: null, buf: [] };
  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      if (cur.buf.join('').trim()) sections.push(cur);
      cur = { head: h[1].trim(), buf: [line] };
    } else {
      cur.buf.push(line);
    }
  }
  if (cur.buf.join('').trim()) sections.push(cur);
  return sections.map((s, i) => ({
    ordem: i,
    breadcrumb: s.head ? `${titulo} > ${s.head}` : titulo,
    conteudo: s.buf.join('\n').trim(),
  }));
}

async function main() {
  const out = [];
  out.push('-- Gerado por seed-global-rag.mjs — inteligência global da Nyro (marketing/operação)');
  out.push('SET ROLE orvyn_service;'); // escrita de base compartilhada (BYPASSRLS)

  let docs = 0;
  let chunks = 0;
  for (const dominio of DOMAINS) {
    let files = [];
    try { files = (await readdir(join(ROOT, dominio))).filter((f) => f.endsWith('.md')); } catch { continue; }
    for (const file of files.sort()) {
      const raw = await readFile(join(ROOT, dominio, file), 'utf8');
      const { fm, body } = parseFrontmatter(raw);
      const slug = fm.id || basename(file, '.md');
      const titulo = fm.titulo || slug;
      const hash = sha256(raw);
      const metadados = {
        slug,
        dominio: fm.dominio || dominio,
        framework: fm.framework || null,
        persona_owner: fm.persona_owner || null,
        comando_relacionado: fm.comando_relacionado || null,
        scope_fit_min_plano: fm.scope_fit_min_plano || 'growth',
        intencoes: fm.intencoes || [],
        aplica_a_nichos: fm.aplica_a_nichos || [],
      };
      const cks = chunkBySection(body, titulo);
      docs++;
      chunks += cks.length;

      out.push('');
      out.push('DO $DO$');
      out.push('DECLARE v_doc uuid;');
      out.push('BEGIN');
      out.push(`  DELETE FROM rag_documents WHERE escopo='global' AND metadados->>'slug' = ${dq(slug)};`);
      out.push(`  INSERT INTO rag_documents (escopo, titulo, fonte, content_hash, status, metadados, published_at)`);
      out.push(`  VALUES ('global', ${dq(titulo)}, ${dq(fm.fonte || 'C-Level Squad')}, '${hash}', 'published', ${dq(JSON.stringify(metadados))}::jsonb, now())`);
      out.push('  RETURNING id INTO v_doc;');
      for (const c of cks) {
        out.push(`  INSERT INTO rag_chunks (document_id, tenant_id, escopo, ordem, breadcrumb, conteudo, tokens, status)`);
        out.push(`  VALUES (v_doc, NULL, 'global', ${c.ordem}, ${dq(c.breadcrumb)}, ${dq(c.conteudo)}, ${estTokens(c.conteudo)}, 'published');`);
      }
      out.push('END $DO$;');
    }
  }
  out.push('RESET ROLE;');
  out.push(`-- resumo: ${docs} documentos, ${chunks} chunks`);
  process.stdout.write(out.join('\n') + '\n');
  process.stderr.write(`seed-global-rag: ${docs} documentos, ${chunks} chunks gerados\n`);
}

main().catch((e) => { process.stderr.write(String(e) + '\n'); process.exit(1); });

#!/usr/bin/env node
/**
 * Semeia o RAG com o corpus do cérebro (Nyro IA/cerebro/RAG/conhecimento).
 * Mapeia a pasta -> escopo/nicho e envia cada arquivo para POST /v1/rag/documents.
 *
 *   node apps/api/scripts/seed-rag.mjs --dry-run   # só mostra o plano (sem API/DB)
 *   node apps/api/scripts/seed-rag.mjs             # ingere de verdade (precisa API + DB + VOYAGE_API_KEY)
 *
 * Bases global/nicho são conhecimento COMPARTILHADO: em produção a ingestão
 * roda como khub_service (BYPASSRLS). Ver db/README.md.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, dirname, basename, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(__dirname, '..', '..', '..', 'Nyro IA', 'cerebro', 'RAG', 'conhecimento');
const API = process.env.KHUB_API ?? process.env.ORVYN_API ?? 'http://localhost:3333';
const DRY = process.argv.includes('--dry-run');

const NICHOS = new Set(['medico', 'juridico', 'contabil']);

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isDirectory()) out.push(...(await walk(full)));
    else if (name.toLowerCase().endsWith('.md') && !name.startsWith('_')) out.push(full);
  }
  return out;
}

function classify(fullPath) {
  const rel = fullPath.slice(CORPUS.length + 1);
  const top = rel.split(sep)[0];
  if (NICHOS.has(top)) return { escopo: 'nicho', nicho: top };
  if (top === 'global') return { escopo: 'global', nicho: null };
  return { escopo: 'global', nicho: null };
}

function tituloFrom(md, fallback) {
  const m = md.match(/^#\s+(.+?)\s*$/m);
  return (m ? m[1] : fallback).replace(/[*_`]/g, '').trim().slice(0, 300);
}

async function main() {
  const files = (await walk(CORPUS)).sort();
  console.log(`Corpus: ${CORPUS}`);
  console.log(`Arquivos: ${files.length} | API: ${API} | modo: ${DRY ? 'DRY-RUN' : 'INGESTÃO'}\n`);

  let ok = 0;
  let fail = 0;
  for (const f of files) {
    const content = await readFile(f, 'utf8');
    const { escopo, nicho } = classify(f);
    const titulo = tituloFrom(content, basename(f, '.md'));
    const rel = f.slice(CORPUS.length + 1);
    const line = `[${escopo}${nicho ? `:${nicho}` : ''}] ${rel} -> "${titulo}" (${content.length} chars)`;

    if (DRY) {
      console.log('  ' + line);
      ok++;
      continue;
    }
    try {
      const res = await fetch(`${API}/v1/rag/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ escopo, nicho: nicho ?? undefined, titulo, fonte: 'playbook_interno', content }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
      const body = await res.json();
      console.log(`  OK   ${line} -> id=${body.id} ${body.deduped ? '(dedupe)' : ''}`);
      ok++;
    } catch (e) {
      console.error(`  FAIL ${line} -> ${e.message}`);
      fail++;
    }
  }
  console.log(`\nResumo: ${ok} ok, ${fail} falhas.`);
  if (!DRY && fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

// Runner de migração ORDENADO e RASTREADO. Registra cada arquivo aplicado em
// `schema_migrations` (com checksum) e pula o que já rodou — idempotente.
// Divide statements pelo sentinela `-- ==SPLIT==` (preserva `$$...$$` e blocos DO).
//
//   node scripts/apply-sql.mjs                    # aplica TODOS os db/*.sql pendentes (com ==SPLIT==)
//   node scripts/apply-sql.mjs db/018_tags.sql    # aplica arquivos específicos
//
// Observação: os arquivos legados (000–017) usam funções/DO sem sentinela e são
// aplicados via psql (ver .github/workflows/ci.yml) — o canônico de histórico
// completo é o psql; este runner cobre as migrações com ==SPLIT== localmente.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const ADMIN = process.env.ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/orvyn';
const prisma = new PrismaClient({ datasources: { db: { url: ADMIN } } });
const ROOT = resolve(process.cwd(), '..', '..');
const sha = (s) => createHash('sha256').update(s).digest('hex');

async function ensureTable() {
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
}

function pickFiles() {
  const args = process.argv.slice(2);
  if (args.length) return args;
  // Sem args: todos os db/*.sql que têm sentinela ==SPLIT== (aplicáveis por este runner), em ordem.
  return readdirSync(resolve(ROOT, 'db'))
    .filter((f) => f.endsWith('.sql') && !/isolation|_test/i.test(f))
    .sort()
    .map((f) => `db/${f}`)
    .filter((rel) => readFileSync(resolve(ROOT, rel), 'utf8').includes('==SPLIT=='));
}

async function main() {
  await ensureTable();
  const applied = new Set((await prisma.$queryRawUnsafe(`SELECT filename FROM schema_migrations`)).map((r) => r.filename));

  for (const f of pickFiles()) {
    const base = f.split('/').pop();
    const sql = readFileSync(resolve(ROOT, f), 'utf8');
    if (applied.has(base)) { console.log(`= ${f} (já aplicada)`); continue; }
    const stmts = sql.split(/^--\s*==SPLIT==\s*$/m).map((s) => s.trim()).filter(Boolean);
    process.stdout.write(`▶ ${f} — ${stmts.length} stmt(s) `);
    for (const s of stmts) {
      try { await prisma.$executeRawUnsafe(s); process.stdout.write('✓'); }
      catch (e) { console.error(`\n  ✗ falhou:\n${s}\n→ ${e.message}`); await prisma.$disconnect(); process.exit(1); }
    }
    await prisma.$executeRawUnsafe(`INSERT INTO schema_migrations (filename, checksum) VALUES ($1,$2)`, base, sha(sql));
    console.log(' ok');
  }
  await prisma.$disconnect();
  console.log('✅ migrações em dia');
}

main();

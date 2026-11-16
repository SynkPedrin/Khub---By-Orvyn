#!/usr/bin/env node
/**
 * Executa SQL SOMENTE LEITURA no Neon de produção (NEON_ADMIN_URL de deploy/.env.render).
 * Recusa qualquer comando que não seja SELECT/WITH/EXPLAIN/SHOW. Nunca imprime a URL.
 * uso: echo "SELECT 1" | node scripts/operar/neon-select.mjs
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const arq = readFileSync(join(aqui, '../../../../deploy/.env.render'), 'utf8');
const url = arq.split('\n').find((l) => l.startsWith('NEON_ADMIN_URL='))?.slice('NEON_ADMIN_URL='.length).trim();
if (!url) throw new Error('NEON_ADMIN_URL não encontrado em deploy/.env.render');

const sql = readFileSync(0, 'utf8').trim();
if (!/^(select|with|explain|show)\b/i.test(sql)) {
  console.error('recusado: apenas SELECT/WITH/EXPLAIN/SHOW');
  process.exit(2);
}

const r = spawnSync('docker', ['run', '--rm', '-i', '-e', 'U', '-e', 'SQL', 'postgres:16', 'sh', '-c', 'printf %s "$SQL" | psql "$U" -At -F " | " -f -'], {
  encoding: 'utf8',
  input: sql,
  env: { ...process.env, U: url, SQL: sql },
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(r.stdout || '');
if (r.status !== 0) {
  process.stderr.write((r.stderr || '').replace(/postgres(ql)?:\/\/\S+/g, '[url]'));
  process.exit(r.status ?? 1);
}

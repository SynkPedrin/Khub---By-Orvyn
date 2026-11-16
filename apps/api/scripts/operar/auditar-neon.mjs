// Roda o auditar-neon.sql (SOMENTE LEITURA) no Neon de produção.
// Mesmo padrão do corrigir-agenda.mjs: NEON_ADMIN_URL vem de deploy/.env.render e nunca é impressa.
// uso: node scripts/operar/auditar-neon.mjs
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const sql = join(aqui, 'auditar-neon.sql');
const arq = readFileSync(join(aqui, '../../../../deploy/.env.render'), 'utf8');
const url = arq.split('\n').find((l) => l.startsWith('NEON_ADMIN_URL='))?.slice('NEON_ADMIN_URL='.length).trim();
if (!url) throw new Error('NEON_ADMIN_URL não encontrado em deploy/.env.render');

const r = spawnSync('docker', ['run', '--rm', '-e', 'U', '-v', `${sql}:/dados/auditar.sql:ro`, 'postgres:16', 'sh', '-c', 'psql "$U" -At -F " | " -f /dados/auditar.sql'], {
  encoding: 'utf8',
  env: { ...process.env, U: url },
  maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(r.stdout);
if (r.status !== 0) { process.stderr.write(r.stderr.replace(/postgres(ql)?:\/\/\S+/g, '[url]')); process.exit(r.status ?? 1); }

#!/usr/bin/env node
/**
 * RECLASSIFICA mensagens importadas do GHL como AUTOMAÇÃO.
 *
 * A importação gravava todo outbound como 'humano' ("Equipe"). O export do
 * GHL marca o remetente em `source`: 'workflow' = automação (os menus
 * "#list|...", follow-ups, lembretes). Este script casa `messages.idempotency_key`
 * ('ghl:<id>') com o `source` do export e corrige o autor — só leitura do
 * retrato, UPDATE só no autor_tipo. Idempotente.
 *
 *   cd apps/api
 *   DATABASE_URL=... node scripts/operar/reclassificar-automacao-ghl.mjs --tenant UUID --location ID [--aplicar]
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TENANT = arg('--tenant');
const LOC = arg('--location') ?? process.env.GHL_MIGRATION_LOCATION_ID;
const APLICAR = process.argv.includes('--aplicar');
if (!TENANT || !LOC) {
  console.error('uso: --tenant UUID --location ID [--aplicar]');
  process.exit(1);
}
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/revenue-audit/evidence/ghl', LOC);
const msgs = JSON.parse(readFileSync(join(DIR, 'messages.json'), 'utf8'));
const automacao = msgs.filter((m) => m.direction === 'outbound' && m.source === 'workflow').map((m) => `ghl:${m.id}`);
console.log(`retrato: ${msgs.length} mensagens · ${automacao.length} de workflow (automação)`);

const psql = (q) => execFileSync('docker', ['run', '--rm', '-i', 'postgres:16', 'psql', process.env.NEON_ADMIN_URL ?? process.env.DATABASE_URL, '-At', '-c', q]).toString().trim();
const total = Number(psql(`select count(*) from messages where tenant_id='${TENANT}' and autor_tipo='automacao'`));
console.log(`já marcadas como automacao no tenant: ${total}`);
if (!APLICAR) {
  console.log('SIMULAÇÃO — nada gravado. Rode com --aplicar.');
  process.exit(0);
}
let feitas = 0;
const LOTE = 400;
for (let i = 0; i < automacao.length; i += LOTE) {
  const lote = automacao.slice(i, i + LOTE).map((k) => `'${k}'`).join(',');
  feitas += Number(psql(`update messages set autor_tipo='automacao' where tenant_id='${TENANT}' and autor_tipo<>'automacao' and idempotency_key in (${lote}) returning 1`) .split('\n').length);
  console.log(`  ${Math.min(i + LOTE, automacao.length)}/${automacao.length}…`);
}
console.log(`reclassificadas nesta passada: ${feitas}`);

#!/usr/bin/env node
/**
 * FOTOS DE PERFIL — backfill em massa (db/037).
 *
 *   cd apps/api
 *   node --env-file=.env scripts/operar/sincronizar-avatares.mjs --tenant UUID            # simulação
 *   node --env-file=.env scripts/operar/sincronizar-avatares.mjs --tenant UUID --aplicar  # grava
 *
 * Pula contatos com foto revalidada nas últimas 20h (a URL do WhatsApp é
 * assinada e expira ~24h). Espaça as chamadas (350ms) para não tropeçar no
 * rate-limit da SM v2. Só roda se o tenant tiver instância stevo_api
 * conectada; sem vínculo, sai sem fazer nada.
 */
import { PrismaClient } from '@prisma/client';

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TENANT = arg('--tenant');
const APLICAR = process.argv.includes('--aplicar');
if (!TENANT || !/^[0-9a-f-]{36}$/i.test(TENANT)) {
  console.error('uso: --tenant UUID [--aplicar]');
  process.exit(1);
}

const TTL_MS = 20 * 60 * 60 * 1000;
const INTERVALO_MS = 350;
const MGMT = (process.env.STEVO_API_BASE_URL || 'https://openapi.stevo.chat').replace(/\/+$/, '');
const KEY = process.env.STEVO_REVENUE_API_KEY;
if (!KEY) {
  console.error('STEVO_REVENUE_API_KEY não definida no .env');
  process.exit(1);
}

const prisma = new PrismaClient();
const soDigitos = (s) => (s ?? '').replace(/\D+/g, '');

const { contatos, instanciaId } = await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
  const vinculo = await tx.integration.findFirst({
    where: { tenantId: TENANT, provider: 'stevo_api', status: 'connected' },
    select: { externalBusinessId: true },
  });
  const contatos = await tx.contact.findMany({
    where: { tenantId: TENANT, telefone: { not: null } },
    select: { id: true, nome: true, telefone: true, fotoEm: true },
    orderBy: { ultimoContatoAt: 'desc' },
  });
  return { contatos, instanciaId: vinculo?.externalBusinessId ?? null };
});

if (!instanciaId) {
  console.log('tenant sem instância stevo_api conectada — nada a fazer.');
  await prisma.$disconnect();
  process.exit(0);
}

const pendentes = contatos.filter((c) => !c.fotoEm || Date.now() - c.fotoEm.getTime() > TTL_MS);
console.log(`contatos com telefone: ${contatos.length} · precisam de foto: ${pendentes.length}`);
if (!APLICAR) {
  console.log('SIMULAÇÃO — nada gravado. Rode com --aplicar para buscar e gravar.');
  await prisma.$disconnect();
  process.exit(0);
}

// Credenciais da instância (server_url + token SM v2) — resolvidas na hora, nunca persistidas.
const inst = await fetch(`${MGMT}/v1/instances/${instanciaId}`, { headers: { authorization: `Bearer ${KEY}` } })
  .then((r) => r.json())
  .then((j) => j.data ?? j);
if (!inst.server_url || !inst.token) {
  console.error('instância sem server_url/token — abortando.');
  await prisma.$disconnect();
  process.exit(1);
}

let ok = 0, semFoto = 0, falhas = 0;
for (const c of pendentes) {
  const numero = soDigitos(c.telefone);
  try {
    const res = await fetch(`${inst.server_url.replace(/\/+$/, '')}/user/avatar`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: inst.token, authorization: `Bearer ${inst.token}` },
      body: JSON.stringify({ number: numero, preview: false }),
      signal: AbortSignal.timeout(15_000),
    });
    const url = res.ok ? ((await res.json().catch(() => ({})))?.data?.url ?? null) : null;
    if (url) {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.current_tenant_id', ${TENANT}, true)`;
        await tx.contact.update({ where: { id: c.id, tenantId: TENANT }, data: { fotoUrl: url, fotoEm: new Date() } });
      });
      ok++;
    } else {
      semFoto++;
    }
  } catch (e) {
    falhas++;
    console.error(`  falha em ${c.nome}: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, INTERVALO_MS));
}
console.log(`concluído: ${ok} com foto · ${semFoto} sem foto no WhatsApp · ${falhas} falhas`);
await prisma.$disconnect();

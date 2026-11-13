#!/usr/bin/env node
/**
 * BACKFILL DE FOTOS DURÁVEIS (db/066) — baixa a foto do WhatsApp de todos os
 * contatos do tenant e guarda a IMAGEM em contact_fotos (não some quando a
 * URL assinada expira). Usa o caminho oficial: AvatarContatoService.
 *
 *   cd apps/api
 *   DATABASE_URL=... node scripts/operar/backfill-fotos-duraveis.mjs --tenant UUID
 *
 * Idempotente: pula quem já tem foto durável em dia (TTL 3 dias). Espaça
 * 350 ms por contato para não tropeçar no rate-limit da SM v2.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TENANT = arg('--tenant');
if (!TENANT || !/^[0-9a-f-]{36}$/i.test(TENANT)) {
  console.error('uso: --tenant UUID');
  process.exit(1);
}

const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { AvatarContatoService } = require('../../dist/crm/messaging/avatar-contato.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const avatares = app.get(AvatarContatoService);
  const r = await avatares.sincronizarTenant(TENANT, 350);
  console.log(`concluído: ${r.atualizados} fotos guardadas · ${r.falhas} sem foto/falha`);
} finally {
  await app.close();
}

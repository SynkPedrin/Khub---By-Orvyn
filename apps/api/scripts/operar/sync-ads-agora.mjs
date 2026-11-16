#!/usr/bin/env node
/**
 * Sync IMEDIATO de anúncios: roda AdsSyncService.run para cada integração de
 * ads conectada (Meta etc.), sem esperar o agendador de 6h. Sobe o AppModule
 * como papel API (não vira worker, não consome fila).
 * Uso (de apps/api): node --env-file=.env scripts/operar/sync-ads-agora.mjs
 */
import { createRequire } from 'node:module';
const API = '/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api';
const require = createRequire(API + '/package.json'); require('reflect-metadata');
const D = API + '/' + (process.env.BENCH_DIST || 'dist');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(D + '/app.module');
const { PrismaService } = require(D + '/prisma/prisma.service');
const { AdsSyncService } = require(D + '/integrations/ads-sync.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const sync = app.get(AdsSyncService);
  const integracoes = await prisma.$queryRaw`
    SELECT id, tenant_id, provider FROM integrations
    WHERE provider = 'meta' AND status = 'connected' AND credentials_encrypted IS NOT NULL`;
  console.log(`${integracoes.length} integração(ões) de ads conectada(s)`);
  for (const i of integracoes) {
    try {
      const r = await sync.run(i.tenant_id, i.id);
      console.log(`OK  ${i.provider} ${i.id} → ${r.records} registros`);
    } catch (e) {
      console.log(`FALHOU ${i.provider} ${i.id} → ${e.message}`);
    }
  }
} finally {
  await app.close();
}

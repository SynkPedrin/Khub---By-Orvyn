#!/usr/bin/env node
/**
 * Ajusta a config da Ritinha (Studio da Beleza) para o teste local:
 * análise no qwen3.5:4b (rápido) — a resposta continua no modelo do agente.
 *   node --env-file=.env scripts/operar/ajustar-ritinha.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { resolverConfig, mesclarConfig } = require('../../dist/agents/config/agent-config');

const TENANT = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  await prisma.withTenant(TENANT, async (tx) => {
    const a = await tx.agent.findFirst({ where: { nome: 'Ritinha' } });
    const { config } = resolverConfig(a.config);
    const nova = mesclarConfig(config, { inteligencia: { ...config.inteligencia, modeloAnalise: 'qwen3.5:4b' } });
    await tx.agent.update({ where: { id: a.id }, data: { config: nova } });
    console.log('ok: modeloAnalise = qwen3.5:4b (resposta continua em', a.modelo + ')');
  });
} finally {
  await app.close();
}

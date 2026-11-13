#!/usr/bin/env node
/** Dump da config efetiva da Ritinha (somente leitura). */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

const TENANT = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const a = await prisma.withTenant(TENANT, (tx) => tx.agent.findFirst({ where: { nome: 'Ritinha' } }));
  console.log('=== INSTRUÇÕES ===\n' + a.instrucoes);
  console.log('\n=== CONFIG ===\n' + JSON.stringify(a.config, null, 1));
} finally {
  await app.close();
}

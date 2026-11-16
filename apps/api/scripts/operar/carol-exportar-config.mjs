#!/usr/bin/env node
/** Exporta a config efetiva da Carol para docs/carol/02_CONFIGURACAO_CAROL.json (auditoria). */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

const T = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
await prisma.withTenant(T, async (tx) => {
  const carol = await tx.agent.findFirst({ where: { nome: 'Carol' } });
  const regras = await tx.agentFollowupRule.findMany({ where: { agentId: carol.id } });
  const fontes = await tx.agentKnowledgeSource.findMany({ where: { agentId: carol.id } });
  const docs = await tx.ragDocument.findMany({ where: { id: { in: fontes.map((f) => f.documentId) } }, select: { id: true, titulo: true, status: true } });
  const campos = await tx.customFieldDef.findMany({ where: { chave: { startsWith: 'carol_' } }, select: { chave: true, rotulo: true, tipo: true, opcoes: true } });
  const pipeline = await tx.pipeline.findFirst({ where: { nome: 'Comercial — Tricologia (Carol)' }, include: { stages: { orderBy: { ordem: 'asc' }, select: { nome: true, ordem: true } } } });
  const out = {
    exportadoEm: new Date().toISOString(),
    tenant: { id: T, nome: 'Dra. Bárbara Lopes' },
    agente: { ...carol, instrucoes: 'ver docs/carol/01_PROMPT_CAROL.md' },
    followupRules: regras,
    baseConhecimento: docs,
    customFields: campos,
    pipeline,
  };
  writeFileSync(new URL('../../../../docs/carol/02_CONFIGURACAO_CAROL.json', import.meta.url), JSON.stringify(out, null, 2));
  console.log('exportado:', carol.ferramentas.length, 'ferramentas,', regras.length, 'regras,', docs.length, 'docs,', campos.length, 'campos');
});
await app.close(); process.exit(0);

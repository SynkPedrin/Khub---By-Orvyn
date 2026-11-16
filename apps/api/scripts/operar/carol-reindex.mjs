#!/usr/bin/env node
/**
 * Reprocessa os documentos da base da Carol e ESPERA a indexação terminar
 * (a fila in-process é fire-and-forget; scripts que saem cedo matam o chunking).
 *   node --env-file=.env scripts/operar/carol-reindex.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { KnowledgeService } = require('../../dist/agents/knowledge/knowledge.service');

const T = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'log'] });
const prisma = app.get(PrismaService);
const conhecimento = app.get(KnowledgeService);

try {
  const carol = await prisma.withTenant(T, (tx) => tx.agent.findFirst({ where: { nome: 'Carol' }, select: { id: true } }));
  const fontes = await prisma.withTenant(T, (tx) => tx.agentKnowledgeSource.findMany({ where: { agentId: carol.id, ativo: true } }));
  for (const f of fontes) {
    await conhecimento.reprocessar(T, carol.id, f.id);
    console.log('reprocessando:', f.id);
  }
  // Espera todos publicarem (ou falharem), até 90s.
  const ids = fontes.map((f) => f.documentId);
  const t0 = Date.now();
  for (;;) {
    const docs = await prisma.withTenant(T, (tx) => tx.ragDocument.findMany({ where: { id: { in: ids } }, select: { id: true, titulo: true, status: true } }));
    const pendentes = docs.filter((d) => d.status === 'pending' || d.status === 'processing');
    if (!pendentes.length || Date.now() - t0 > 90_000) {
      for (const d of docs) {
        const chunks = await prisma.withTenant(T, (tx) => tx.ragChunk.count({ where: { documentId: d.id } }));
        console.log(`${d.status} | ${chunks} chunks | ${d.titulo}`);
      }
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
} finally {
  await app.close();
  process.exit(0);
}

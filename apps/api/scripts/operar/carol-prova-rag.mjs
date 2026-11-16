#!/usr/bin/env node
/** Prova de recuperação: a base da Carol responde perguntas reais de paciente. */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { AgentToolsService } = require('../../dist/agents/agent-tools.service');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { resolverConfig } = require('../../dist/agents/config/agent-config');

const T = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const tools = app.get(AgentToolsService);
const prisma = app.get(PrismaService);
const carol = await prisma.withTenant(T, (tx) => tx.agent.findFirst({ where: { nome: 'Carol' } }));
const docIds = await prisma.withTenant(T, async (tx) =>
  (await tx.agentKnowledgeSource.findMany({ where: { agentId: carol.id, ativo: true } })).map((f) => f.documentId));
const ctx = { tenantId: T, agentId: carol.id, agentNome: 'Carol', conversationId: null, contactId: null, nicho: 'Clínica médica', subespecialidade: 'Tricologia', escopos: ['tenant'], simulacao: true, documentIds: docIds };
for (const pergunta of ['quanto custa a consulta para quem tem convênio?', 'o que é a tricoscopia?', 'vocês fazem transplante capilar?', 'qual o valor do sinal e como pago?']) {
  const r = await tools.executar('buscar_conhecimento', { pergunta }, ctx, new Set(['buscar_conhecimento']));
  const trechos = r.dados?.trechos ?? [];
  console.log(`\nQ: ${pergunta}\n   → ${trechos.length ? trechos.map((t) => t.fonte).join(' | ') : 'VAZIO'}`);
  if (trechos[0]) console.log('   trecho:', trechos[0].texto.slice(0, 140).replace(/\n/g, ' '));
}
await app.close(); process.exit(0);

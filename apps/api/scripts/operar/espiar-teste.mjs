#!/usr/bin/env node
/** Espia o andamento do teste: runs, blocos e mensagens da conversa do Pedro. */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

const TENANT = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const CONV = 'c5b53245-a897-423c-a220-82384b1fa079';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  await prisma.withTenant(TENANT, async (tx) => {
    const conv = await tx.conversation.findUnique({ where: { id: CONV }, select: { atendimento: true, agentId: true } });
    console.log('conversa:', JSON.stringify(conv));
    const runs = await tx.agentRun.findMany({ where: { conversationId: CONV }, orderBy: { createdAt: 'desc' }, take: 3 });
    for (const r of runs) console.log('RUN:', r.status, '| modelo:', r.modelo, '| intenção:', r.intencao, '| blocos:', r.blocos, '| latência:', r.latenciaMs, 'ms', r.motivo ? `| motivo: ${r.motivo}` : '');
    const blocos = await tx.agentDelivery.findMany({ where: { conversationId: CONV }, orderBy: [{ createdAt: 'desc' }, { ordem: 'asc' }], take: 10 });
    for (const b of blocos.reverse()) console.log(`BLOCO ${b.ordem}/${b.total} [${b.status}] (${b.atrasoMs}ms)${b.motivo ? ` motivo="${b.motivo}"` : ''}: """${b.texto}"""`);
    const msgs = await tx.message.findMany({ where: { conversationId: CONV }, orderBy: { createdAt: 'desc' }, take: 12, select: { autorTipo: true, corpo: true, deliveryStatus: true, deliveryError: true, createdAt: true } });
    console.log('\nMENSAGENS (recentes):');
    for (const m of msgs.reverse()) console.log(`  [${m.autorTipo}|${m.deliveryStatus}${m.deliveryError ? '|' + m.deliveryError : ''}] ${m.createdAt.toISOString()} """${m.corpo.slice(0, 300)}"""`);
  });
} finally {
  await app.close();
}

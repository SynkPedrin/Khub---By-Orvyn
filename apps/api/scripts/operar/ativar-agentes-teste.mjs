import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AppModule } = require(process.cwd() + '/dist/app.module');
const { PrismaService } = require(process.cwd() + '/dist/prisma/prisma.service');
const { AgentsService } = require(process.cwd() + '/dist/agents/agents.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const agents = app.get(AgentsService);
  for (const [tenant, nome] of [['1cc7e839-f72c-414b-9d3f-a8b4131008c8', 'Ritinha'], ['c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3', 'Carol']]) {
    const dono = await prisma.withTenant(tenant, (tx) => tx.membership.findFirst({ where: { tenantId: tenant, role: { in: ['owner', 'admin'] } }, select: { identityId: true } }));
    const a = await prisma.withTenant(tenant, (tx) => tx.agent.findFirst({ where: { nome } }));
    await agents.mudarStatus(tenant, { identityId: dono.identityId, role: 'admin' }, a.id, 'ativo');
    console.log(`+ ${nome} ATIVO (sem padrao — teste seguro) em ${nome === 'Ritinha' ? 'Studio' : 'Bárbara'}`);
  }
} finally { await app.close(); }

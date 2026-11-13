#!/usr/bin/env node
/** Pré-valida os rascunhos importados do GHL com a MESMA validação da publicação. */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { WorkflowsService } = require('../../dist/automations/workflows.service');

const STUDIO = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const NOMES = ['Novo Lead 🚀 (importado do GHL v14)', 'Notificação Interna 🔔 (importado do GHL)', 'Agendamento Confirmado 📅', 'Disparo de Mensagem📨', 'Resposta na Dm'];

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
try {
  const prisma = app.get(PrismaService);
  const wf = app.get(WorkflowsService);
  let falhas = 0;
  for (const nome of NOMES) {
    const v = await prisma.withTenant(STUDIO, (tx) =>
      tx.workflowVersion.findFirst({ where: { workflow: { nome }, publicadoEm: null }, orderBy: { versao: 'desc' }, select: { grafo: true } }),
    );
    if (!v) { console.log(`! sem rascunho: ${nome}`); falhas++; continue; }
    const problemas = wf.validar(v.grafo);
    if (problemas.length) { falhas++; console.log(`✗ ${nome}: ${JSON.stringify(problemas)}`); }
    else console.log(`✓ ${nome} — válido (${v.grafo.nos.length} nós)`);
  }
  process.exitCode = falhas ? 1 : 0;
} finally { await app.close(); }

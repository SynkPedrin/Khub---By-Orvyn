#!/usr/bin/env node
/**
 * Auditoria SOMENTE LEITURA da subconta do Instituto Bárbara Lopes.
 * Nunca imprime segredo. Uso:
 *   pnpm build && node --env-file=.env scripts/operar/inspecionar-barbara.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);

const j = (v) => JSON.stringify(v, null, 1);

try {
  const tenants = await prisma.tenant.findMany({ select: { id: true, nome: true, nicho: true, subespecialidade: true } });
  console.log('TENANTS:');
  for (const t of tenants) console.log('-', j(t));

  const alvo = tenants.find((t) => /b[aá]rbara/i.test(t.nome));
  if (!alvo) {
    console.log('\n!! TENANT BÁRBARA NÃO ENCONTRADO — abortando.');
    process.exit(1);
  }
  console.log('\n=== SUBCONTA ALVO:', alvo.nome, alvo.id, '===');
  const T = alvo.id;

  await prisma.withTenant(T, async (tx) => {
    const agentes = await tx.agent.findMany({ select: { id: true, nome: true, status: true, padrao: true, modelo: true, tom: true, maxCaracteres: true, conhecimentoAtivo: true, canais: true, updatedAt: true } });
    console.log('\nAGENTES:');
    for (const a of agentes) console.log('-', j(a));

    const pipelines = await tx.pipeline.findMany({ include: { stages: { orderBy: { ordem: 'asc' }, select: { id: true, nome: true, ordem: true } } } });
    console.log('\nPIPELINES:');
    for (const p of pipelines) console.log('-', p.nome, p.id, '=>', p.stages.map((s) => s.nome).join(' | '));

    const campos = await tx.customFieldDef.findMany({ select: { id: true, chave: true, rotulo: true, tipo: true, entidade: true } }).catch((e) => 'sem customFieldDef: ' + e.message);
    console.log('\nCUSTOM FIELDS:', typeof campos === 'string' ? campos : j(campos));

    const integracoes = await tx.integration.findMany({ select: { provider: true, externalBusinessId: true, status: true, health: true } });
    console.log('\nINTEGRATIONS:', j(integracoes));

    const canais = await tx.channelConnection.findMany({ select: { rede: true, nome: true, externalId: true, erro: true } }).catch((e) => 'sem channelConnection: ' + e.message);
    console.log('\nCHANNEL CONNECTIONS:', typeof canais === 'string' ? canais : j(canais));

    const paginasBooking = await tx.bookingPage.findMany({ select: { id: true, slug: true, titulo: true, ativo: true, intervaloMin: true, duracaoMin: true, ownerId: true, horarios: true, fuso: true } }).catch((e) => 'sem bookingPage: ' + e.message);
    console.log('\nBOOKING PAGES:', typeof paginasBooking === 'string' ? paginasBooking : j(paginasBooking));

    const compromissos = await tx.agendaCompromisso.count().catch(() => 'sem agendaCompromisso');
    console.log('\nAGENDA COMPROMISSOS (count):', compromissos);

    const workflows = await tx.workflow.findMany({ select: { id: true, nome: true, status: true, updatedAt: true } });
    console.log('\nWORKFLOWS:');
    for (const w of workflows) console.log('-', j(w));

    const docs = await tx.ragDocument.findMany({ select: { id: true, titulo: true, escopo: true, status: true } });
    console.log('\nDOCS RAG:', j(docs));

    const contatos = await tx.contact.count();
    const conversas = await tx.conversation.count();
    const mensagens = await tx.message.count();
    console.log('\nVOLUME:', j({ contatos, conversas, mensagens }));
  });
} finally {
  await app.close();
}

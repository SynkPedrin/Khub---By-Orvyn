#!/usr/bin/env node
/**
 * Diagnóstico do estado da virada GHL → KHUB (Studio da Beleza / Ritinha).
 * Somente leitura. Nunca imprime segredo.
 *
 *   pnpm build && node --env-file=.env scripts/operar/inspecionar-studio.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

const TENANT_STUDIO = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const FONE_PEDRO = '18991652039';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);

try {
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_STUDIO }, select: { id: true, nome: true, nicho: true, subespecialidade: true } });
  console.log('TENANT:', JSON.stringify(tenant));

  await prisma.withTenant(TENANT_STUDIO, async (tx) => {
    const agentes = await tx.agent.findMany({ select: { id: true, nome: true, status: true, padrao: true, modelo: true, tom: true, maxCaracteres: true, conhecimentoAtivo: true, createdAt: true, updatedAt: true } });
    console.log('\nAGENTES:');
    for (const a of agentes) console.log('-', JSON.stringify(a));

    const conexoes = await tx.integration.findMany({ select: { provider: true, externalBusinessId: true, status: true, health: true, lastSyncAt: true } });
    console.log('\nINTEGRATIONS:', JSON.stringify(conexoes));

    const contato = await tx.contact.findFirst({ where: { OR: [{ telefone: { contains: FONE_PEDRO } }, { telefone: { contains: '5518991652039' } }] }, select: { id: true, nome: true, telefone: true, optedOutAt: true } });
    console.log('\nCONTATO PEDRO:', JSON.stringify(contato));

    if (contato) {
      const convs = await tx.conversation.findMany({ where: { contactId: contato.id }, select: { id: true, canal: true, atendimento: true, agentId: true, updatedAt: true }, orderBy: { updatedAt: 'desc' } });
      console.log('CONVERSAS DO PEDRO:', JSON.stringify(convs));
    }

    const fontes = await tx.agentKnowledgeSource.findMany({ select: { agentId: true, documentId: true, categoria: true, ativo: true } });
    const docs = fontes.length ? await tx.ragDocument.findMany({ where: { id: { in: fontes.map((f) => f.documentId) } }, select: { id: true, titulo: true, escopo: true, status: true } }) : [];
    console.log('\nFONTES DE CONHECIMENTO:', JSON.stringify(fontes.map((f) => ({ ...f, doc: docs.find((d) => d.id === f.documentId) ?? null })), null, 1));
  });

  // Versões publicadas da Ritinha
  const ritinha = await prisma.withTenant(TENANT_STUDIO, (tx) => tx.agent.findFirst({ where: { nome: 'Ritinha' } }));
  if (ritinha) {
    console.log('\nRITINHA id:', ritinha.id);
    console.log('config.fragmentacao:', JSON.stringify(ritinha.config?.comunicacao?.fragmentacao ?? null));
    console.log('config.comunicacao:', JSON.stringify(ritinha.config?.comunicacao ?? null));
    console.log('config.horario:', JSON.stringify(ritinha.config?.horario ?? null));
    console.log('instrucoes (primeiros 1500):\n', (ritinha.instrucoes ?? '').slice(0, 1500));
    const versoes = await prisma.withTenant(TENANT_STUDIO, (tx) => tx.agentVersion.findMany({ where: { agentId: ritinha.id }, orderBy: { numero: 'desc' }, take: 3, select: { id: true, numero: true, status: true, publicadaEm: true, notas: true } }).catch(() => []));
    console.log('\nVERSÕES:', JSON.stringify(versoes));
  }
} finally {
  await app.close();
}

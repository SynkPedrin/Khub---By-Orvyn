#!/usr/bin/env node
/**
 * Homologação Carol — envio controlado para o número de teste autorizado.
 * Só envia para a conversa do contato marcado com qa_id=QA-CAROL-20261116,
 * no tenant da Dra. Bárbara, com trava de dev (STEVO_TEST_NUMBER) ativa.
 * uso: pnpm build && node --env-file=.env scripts/operar/carol-homologacao-enviar.mjs "texto" <chave-idempotencia>
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const [texto, chave] = [process.argv[2], process.argv[3]];
if (!texto || !chave) {
  console.error('uso: carol-homologacao-enviar.mjs "texto" <chave-idempotencia>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { MessagesService } = require('../../dist/crm/messaging/messages.service');

const TENANT = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';
const CAROL = '4894728f-6c53-4a90-8cfa-d07707e39ea9';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  if (process.env.NODE_ENV === 'production') throw new Error('recusado em produção');
  if (process.env.STEVO_TEST_NUMBER !== '5518991652039') throw new Error('trava de dev ausente: STEVO_TEST_NUMBER != número autorizado');

  const conv = await prisma.withTenant(TENANT, async (tx) => {
    const rows = await tx.$queryRaw`SELECT v.id FROM conversations v JOIN contacts c ON c.id=v.contact_id
      WHERE v.tenant_id=${TENANT}::uuid AND c.campos_custom->>'qa_id'='QA-CAROL-20261116' AND v.canal='WhatsApp'
        AND v.atendimento='ia' AND v.agent_id=${CAROL}::uuid LIMIT 1`;
    return rows[0]?.id ?? null;
  });
  if (!conv) throw new Error('conversa QA não encontrada ou não está roteada para a Carol');

  const r = await app.get(MessagesService).send(TENANT, conv, texto, chave, undefined, { tipo: 'ia', agentId: CAROL });
  console.log('enviado:', JSON.stringify({ id: r.id, status: r.status, erro: r.erro }));
} finally {
  await app.close();
  process.exit(0);
}

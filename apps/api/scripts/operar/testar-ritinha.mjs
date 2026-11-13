#!/usr/bin/env node
/**
 * Teste ao vivo da Ritinha (Studio da Beleza) no WhatsApp.
 *
 *   node --env-file=.env scripts/operar/testar-ritinha.mjs "mensagem do cliente"
 *
 * Entrega a conversa do contato de teste (STEVO_TEST_NUMBER → Pedro) para a
 * Ritinha, simula a mensagem de entrada e acompanha: run do agente, blocos
 * fragmentados e status de envio. O envio real sai pela instância Stevo do
 * Studio — em desenvolvimento a trava redireciona para STEVO_TEST_NUMBER.
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { randomUUID } = require('node:crypto');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { MessagesService } = require('../../dist/crm/messaging/messages.service');
const { AtendimentoService } = require('../../dist/crm/messaging/atendimento.service');

const TENANT = '1cc7e839-f72c-414b-9d3f-a8b4131008c8'; // Studio da Beleza
const FONE_PEDRO = '+5518991652039';
const texto = process.argv[2] || 'Oi! Queria saber mais sobre alongamento de gel, quanto custa e quanto tempo demora?';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const mensagens = app.get(MessagesService);
  const atendimento = app.get(AtendimentoService);

  const preparo = await prisma.withTenant(TENANT, async (tx) => {
    const ritinha = await tx.agent.findFirst({ where: { nome: 'Ritinha', status: 'ativo' } });
    if (!ritinha) throw new Error('Ritinha não encontrada/ativa');
    const contato = await tx.contact.findFirst({ where: { telefone: { contains: '18991652039' } } });
    if (!contato) throw new Error('contato do Pedro não encontrado');
    const dono = await tx.membership.findFirst({ where: { tenantId: TENANT, role: { in: ['owner', 'admin'] } }, select: { identityId: true } });
    return { ritinha, contato, donoId: dono.identityId };
  });
  console.log(`agente: ${preparo.ritinha.nome} (${preparo.ritinha.id})`);

  // 1) conversa do contato entregue à Ritinha
  let conv = await prisma.withTenant(TENANT, (tx) => tx.conversation.findFirst({ where: { contactId: preparo.contato.id, canal: 'WhatsApp' }, orderBy: { updatedAt: 'desc' } }));
  conv ??= await prisma.withTenant(TENANT, (tx) => tx.conversation.create({ data: { tenantId: TENANT, contactId: preparo.contato.id, nome: preparo.contato.nome, canal: 'WhatsApp' } }));
  const estado = await atendimento.devolverParaIa(TENANT, conv.id, preparo.donoId, preparo.ritinha.id);
  console.log(`conversa ${conv.id} → atendimento=${estado.atendimento}, agente=${estado.agentId}`);

  // 2) mensagem de entrada (mesmo caminho do webhook Stevo)
  const r = await mensagens.receiveInbound({ tenantId: TENANT, fromNumber: FONE_PEDRO, fromName: 'Pedro Venegeroles', text: texto, providerMessageId: `teste-${randomUUID()}` });
  console.log('entrada:', JSON.stringify(r));

  // 3) acompanha o processamento (outbox → fila de agentes → entrega fragmentada)
  const t0 = Date.now();
  let vistos = new Set();
  while (Date.now() - t0 < 180_000) {
    const snap = await prisma.withTenant(TENANT, async (tx) => ({
      runs: await tx.agentRun.findMany({ where: { conversationId: conv.id, createdAt: { gte: new Date(t0 - 10_000) } }, orderBy: { createdAt: 'desc' }, take: 3, select: { id: true, status: true, motivo: true, modelo: true, intencao: true, blocos: true, latenciaMs: true, custoUsd: true } }),
      blocos: await tx.agentDelivery.findMany({ where: { conversationId: conv.id, createdAt: { gte: new Date(t0 - 10_000) } }, orderBy: { ordem: 'asc' }, select: { id: true, ordem: true, status: true, texto: true, atrasoMs: true, motivo: true, enviadoEm: true } }),
    }));
    const run = snap.runs[0];
    if (run && !vistos.has(`run-${run.id}-${run.status}`)) {
      vistos.add(`run-${run.id}-${run.status}`);
      console.log(`\nRUN ${run.status} | modelo=${run.modelo} | intenção=${run.intencao} | blocos=${run.blocos} | ${run.latenciaMs}ms${run.motivo ? ` | motivo: ${run.motivo}` : ''}`);
    }
    for (const b of snap.blocos) {
      const k = `bloco-${b.id}-${b.status}`;
      if (!vistos.has(k)) {
        vistos.add(k);
        console.log(`\n[BLOCO ${b.ordem}] status=${b.status} (atraso ${b.atrasoMs}ms${b.enviadoEm ? ', enviado ' + b.enviadoEm.toISOString() : ''})${b.motivo ? `\n  motivo: ${b.motivo}` : ''}\n  """${b.texto}"""`);
      }
    }
    if (run && ['respondido', 'transferido', 'ignorado', 'erro'].includes(run.status) && snap.blocos.every((b) => ['enviado', 'falhou', 'cancelado'].includes(b.status))) break;
    if (run && ['transferido', 'ignorado', 'erro'].includes(run.status) && !snap.blocos.length) break;
    await new Promise((res) => setTimeout(res, 3000));
  }
  console.log('\nfim do acompanhamento.');
} finally {
  await app.close();
}

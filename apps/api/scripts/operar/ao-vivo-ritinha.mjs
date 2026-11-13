#!/usr/bin/env node
/**
 * Teste AO VIVO da Ritinha: contato de teste (número fictício, conversa limpa)
 * manda mensagens; o worker (dist-ritinha) responde pela instância Stevo do
 * Studio e, pela trava de dev, TUDO sai para STEVO_TEST_NUMBER (Pedro).
 * Uso (de apps/api): node --env-file=.env ao-vivo.mjs
 */
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const API = '/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api';
const require = createRequire(API + '/package.json'); require('reflect-metadata');
const D = API + '/' + (process.env.BENCH_DIST || 'dist');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(D + '/app.module');
const { PrismaService } = require(D + '/prisma/prisma.service');
const { MessagesService } = require(D + '/crm/messaging/messages.service');
const { AtendimentoService } = require(D + '/crm/messaging/atendimento.service');

const T = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const FONE = process.env.FONE || '+5518900000101';
const NOME = process.env.NOME || 'Mariana (teste IA)';
// Cada passo = rajada de mensagens (intervalo em ms entre elas).
const ROTEIRO = process.env.ROTEIRO ? JSON.parse(process.env.ROTEIRO) : [
  { msgs: ['Oii, tudo bem? vi vcs no insta'] },
  { msgs: ['quanto ta a manicure e a pedicure?'] },
  { msgs: ['queria fazer as duas sexta de manhã', 'consegue?'], intervalo: 3000 },
  { msgs: ['aceita cartão?'] },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService), msgs = app.get(MessagesService), atend = app.get(AtendimentoService);
  const prep = await prisma.withTenant(T, async (tx) => {
    const ritinha = await tx.agent.findFirst({ where: { nome: 'Ritinha', status: 'ativo' } });
    const dono = await tx.membership.findFirst({ where: { tenantId: T, role: { in: ['owner', 'admin'] } }, select: { identityId: true } });
    let c = await tx.contact.findFirst({ where: { telefone: FONE } });
    c ??= await tx.contact.create({ data: { tenantId: T, nome: NOME, telefone: FONE, tag: 'Lead', origem: 'WhatsApp' } });
    let conv = await tx.conversation.findFirst({ where: { contactId: c.id, canal: 'WhatsApp' } });
    conv ??= await tx.conversation.create({ data: { tenantId: T, contactId: c.id, nome: NOME, canal: 'WhatsApp' } });
    return { ritinha, dono: dono.identityId, conv };
  });
  await atend.devolverParaIa(T, prep.conv.id, prep.dono, prep.ritinha.id);
  console.log(`conversa ${prep.conv.id} com ${prep.ritinha.nome}\n`);

  for (const passo of ROTEIRO) {
    const t0 = new Date();
    for (const [i, m] of passo.msgs.entries()) {
      if (i) await sleep(passo.intervalo ?? 2000);
      await msgs.receiveInbound({ tenantId: T, fromNumber: FONE, fromName: NOME, text: m, providerMessageId: `teste-${randomUUID()}` });
      console.log(`CLIENTE ${new Date().toISOString().slice(11, 19)}: ${m}`);
    }
    // espera: todos os runs do passo fechados e nenhum bloco pendente
    const ini = Date.now();
    let ultimoEstado = '';
    while (Date.now() - ini < 240_000) {
      await sleep(2500);
      const s = await prisma.withTenant(T, async (tx) => ({
        runs: await tx.agentRun.findMany({ where: { conversationId: prep.conv.id, createdAt: { gte: t0 } }, select: { status: true, motivo: true, latenciaMs: true, intencao: true, tools: true } }),
        blocos: await tx.agentDelivery.findMany({ where: { conversationId: prep.conv.id, createdAt: { gte: t0 } }, orderBy: { ordem: 'asc' }, select: { ordem: true, status: true, texto: true, enviadoEm: true, motivo: true } }),
      }));
      const abertos = s.runs.filter((r) => r.status === 'processando').length;
      const pend = s.blocos.filter((b) => ['pendente', 'enviando'].includes(b.status)).length;
      const estado = `${s.runs.length}r/${abertos}a/${s.blocos.length}b/${pend}p`;
      if (estado !== ultimoEstado) ultimoEstado = estado;
      if (s.runs.length >= passo.msgs.length && !abertos && !pend) {
        for (const r of s.runs) console.log(`  run: ${r.status}${r.motivo ? ` (${r.motivo})` : ''} | ${r.latenciaMs}ms | ${r.intencao} | tools ${(r.tools ?? []).map((x) => x.nome).join(',') || '-'}`);
        const autos = await prisma.withTenant(T, (tx) => tx.message.findMany({ where: { conversationId: prep.conv.id, autorTipo: 'automacao', createdAt: { gte: t0 } }, select: { corpo: true } }));
        for (const a of autos) console.log(`  AUTOMAÇÃO: ${a.corpo.replace(/\n+/g, ' ⏎ ').slice(0, 160)}`);
        for (const b of s.blocos) console.log(`  RITINHA [${b.ordem}] ${b.status}${b.enviadoEm ? ' ' + b.enviadoEm.toISOString().slice(11, 19) : ''}${b.motivo ? ` (${b.motivo})` : ''}: ${b.texto.replace(/\n/g, ' ⏎ ')}`);
        break;
      }
    }
    console.log('');
    await sleep(4000);
  }
} finally { await app.close(); }

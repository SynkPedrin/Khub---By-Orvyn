#!/usr/bin/env node
/**
 * VIRADA GHL → KHUB — roda DEPOIS que o GHL foi desligado (e só aí).
 *
 * Enquanto o GHL estiver ativo, NÃO rodar com --aplicar: cliente receberia
 * mensagem em dobro (GHL + KHUB) e dois bots responderiam no mesmo número.
 *
 *   cd apps/api && pnpm build
 *   node --env-file=.env scripts/operar/virada-ghl.mjs            # dry-run: só mostra o plano
 *   node --env-file=.env scripts/operar/virada-ghl.mjs --aplicar  # executa a virada
 *
 * O que a virada faz:
 *  Studio da Beleza — publica os 5 fluxos fiéis ao GHL (Novo Lead v14,
 *    Notificação Interna, Agendamento Confirmado, Disparo, Resposta na Dm),
 *    pausa as 2 versões simplificadas duplicadas, mantém o MetaAds Tagging,
 *    e ativa a Ritinha como agente padrão do WhatsApp.
 *  Dra. Bárbara Lopes — ativa a Carol como agente padrão do WhatsApp.
 *
 * Idempotente: fluxo já publicado / agente já ativo é pulado.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { WorkflowsService } = require('../../dist/automations/workflows.service');
const { AgentsService } = require('../../dist/agents/agents.service');

const APLICAR = process.argv.includes('--aplicar');

const STUDIO = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const BARBARA = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';

const PUBLICAR_STUDIO = [
  'Novo Lead 🚀 (importado do GHL v14)',
  'Notificação Interna 🔔 (importado do GHL)',
  'Agendamento Confirmado 📅',
  'Disparo de Mensagem📨',
  'Resposta na Dm',
];
const PAUSAR_STUDIO = ['Novo Lead 🚀', 'Notificação Interna 🔔'];

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const prisma = app.get(PrismaService);
  const wf = app.get(WorkflowsService);
  const agents = app.get(AgentsService);

  const donoDe = async (tenantId) => {
    const d = await prisma.withTenant(tenantId, (tx) =>
      tx.membership.findFirst({ where: { tenantId, role: { in: ['owner', 'admin'] } }, orderBy: { createdAt: 'asc' }, select: { identityId: true, role: true } }),
    );
    if (!d) throw new Error(`tenant ${tenantId} sem owner/admin`);
    return { identityId: d.identityId, role: 'admin' };
  };

  console.log(APLICAR ? '== VIRADA GHL → KHUB (APLICANDO) ==' : '== VIRADA GHL → KHUB (dry-run; rode com --aplicar na hora da virada) ==');

  // ---- Workflows do Studio ----
  const donoStudio = await donoDe(STUDIO);
  const fluxos = await prisma.withTenant(STUDIO, (tx) => tx.workflow.findMany({ select: { id: true, nome: true, status: true } }));
  for (const nome of PUBLICAR_STUDIO) {
    const f = fluxos.find((x) => x.nome === nome);
    if (!f) { console.log(`! ausente (rode ghl-automacoes.mjs antes): ${nome}`); continue; }
    if (f.status === 'ativo') { console.log(`= já ativo: ${nome}`); continue; }
    console.log(`${APLICAR ? '+' : '→'} publicar: ${nome}`);
    if (APLICAR) await wf.publicar(STUDIO, f.id, donoStudio.identityId);
  }
  for (const nome of PAUSAR_STUDIO) {
    const f = fluxos.find((x) => x.nome === nome);
    if (!f) continue;
    if (f.status !== 'ativo') { console.log(`= já não-ativo: ${nome}`); continue; }
    console.log(`${APLICAR ? '-' : '→'} pausar duplicata: ${nome}`);
    if (APLICAR) await wf.mudarStatus(STUDIO, f.id, 'pausado', donoStudio.identityId);
  }

  // ---- Agentes padrão ----
  const ligar = async (tenantId, nome) => {
    const ator = await donoDe(tenantId);
    const a = await prisma.withTenant(tenantId, (tx) => tx.agent.findFirst({ where: { nome }, select: { id: true, status: true, padrao: true } }));
    if (!a) { console.log(`! agente ausente em ${tenantId.slice(0, 8)}: ${nome}`); return; }
    if (a.status === 'ativo' && a.padrao) { console.log(`= ${nome} já é o agente padrão ativo`); return; }
    console.log(`${APLICAR ? '+' : '→'} ativar como padrão do WhatsApp: ${nome} (${tenantId.slice(0, 8)})`);
    if (!APLICAR) return;
    if (a.status !== 'ativo') await agents.mudarStatus(tenantId, ator, a.id, 'ativo');
    await agents.atualizar(tenantId, ator, a.id, { padrao: true });
  };
  await ligar(STUDIO, 'Ritinha');
  await ligar(BARBARA, 'Carol');

  console.log(APLICAR ? '== virada concluída ==' : '== dry-run ok. GHL desligado? Rode com --aplicar ==');
} finally {
  await app.close();
}

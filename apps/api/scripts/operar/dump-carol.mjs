#!/usr/bin/env node
/**
 * Dump SOMENTE LEITURA da config completa da Carol (tenant Dra. Bárbara Lopes).
 *   node --env-file=.env scripts/operar/dump-carol.mjs > /tmp/dump-carol.txt
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');

const TENANT = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
const j = (v) => JSON.stringify(v, null, 1);

try {
  await prisma.withTenant(TENANT, async (tx) => {
    const carol = await tx.agent.findFirst({ where: { nome: 'Carol' } });
    if (!carol) { console.log('CAROL NÃO ENCONTRADA'); process.exit(1); }
    console.log('=== AGENT ROW ===');
    console.log(j({ ...carol, instrucoes: carol.instrucoes ? `[${carol.instrucoes.length} chars — abaixo]` : null }));
    console.log('\n=== INSTRUCOES ===\n' + (carol.instrucoes ?? '(vazio)'));
    console.log('\n=== CONFIG ===\n' + j(carol.config));
    console.log('\n=== FERRAMENTAS ===\n' + j(carol.ferramentas));

    const versoes = await tx.agentVersion.findMany({ where: { agentId: carol.id }, orderBy: { numero: 'desc' }, take: 3, select: { id: true, numero: true, origem: true, createdAt: true } });
    console.log('\n=== VERSOES ===\n' + j(versoes));

    const regrasFollowup = await tx.agentFollowupRule.findMany({ where: { agentId: carol.id } });
    console.log('\n=== FOLLOWUP RULES ===\n' + j(regrasFollowup));

    const fontes = await tx.agentKnowledgeSource.findMany({ where: { agentId: carol.id } });
    console.log('\n=== KNOWLEDGE SOURCES ===\n' + j(fontes));

    const intencoes = await tx.agentIntentCategory.findMany({ select: { chave: true, nome: true, ativo: true } });
    console.log('\n=== INTENT CATEGORIES ===\n' + j(intencoes));

    const profissionais = await tx.profissional.findMany({ select: { id: true, nome: true, ativo: true } }).catch(() => 'sem model');
    console.log('\n=== PROFISSIONAIS ===\n' + j(profissionais));

    const servicos = await tx.servico.findMany({ select: { id: true, nome: true, duracaoMin: true, precoCentavos: true, ativo: true } }).catch((e) => 'sem servico: ' + e.message);
    console.log('\n=== SERVICOS ===\n' + (typeof servicos === 'string' ? servicos : j(servicos)));

    const usuarios = await tx.user.findMany({ select: { id: true, nome: true, email: true, papel: true } }).catch((e) => 'sem user: ' + e.message);
    console.log('\n=== USERS ===\n' + (typeof usuarios === 'string' ? usuarios : j(usuarios)));

    const tags = await tx.crmTag.findMany({ select: { nome: true, cor: true } }).catch(() => null);
    if (tags) console.log('\n=== TAGS ===\n' + j(tags));
  });
} finally {
  await app.close();
}

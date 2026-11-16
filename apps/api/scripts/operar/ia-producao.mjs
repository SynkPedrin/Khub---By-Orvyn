#!/usr/bin/env node
/**
 * Diagnóstico da IA de atendimento ("ativei a IA, mandei mensagem e nada
 * aconteceu") e ajuste do modelo para Claude Sonnet 5.5. Nunca imprime segredo
 * nem telefone/mensagem de cliente.
 *
 * Precisa SÓ do banco (não sobe a API, não usa Redis): a DATABASE_URL de
 * produção (Render > khub-api > Environment, ou Neon > Connect).
 *
 *   cd apps/api && pnpm build
 *   DATABASE_URL='postgres://…' node scripts/operar/ia-producao.mjs --nome "Studio"   # só lê
 *   DATABASE_URL='postgres://…' node scripts/operar/ia-producao.mjs --nome "Studio" --aplicar --devolver-ia
 *
 * O que ele mostra (ordem do caminho da mensagem até a resposta):
 *  1. (o provedor/chave de IA ficam no ambiente do servidor: confira lá
 *     AI_PROVIDER=anthropic e que NÃO existe ANTHROPIC_MODEL_FORCE);
 *  2. agentes: status, padrão, canais, modelo da VERSÃO PUBLICADA (é ela que o
 *     runtime usa), modelo de análise/fallback — modelo de Ollama (qwen…) com o
 *     provedor Anthropic = toda chamada falha;
 *  3. conversas das últimas 48 h: quantas estão com a IA e quantas com humano
 *     (conversa nasce com a IA só se JÁ havia agente padrão ativo no canal);
 *  4. últimas execuções do agente: status e motivo (erro de modelo, limite,
 *     fora do horário, passou para humano…). Nenhuma execução = a mensagem
 *     nunca chegou ao agente (conversa em "humano" ou worker parado).
 *
 * `--aplicar`: modelo de resposta = claude-sonnet-5-5, análise e fallback =
 * "o mesmo do agente" (null), e publica uma versão nova (mesmo serviço da tela,
 * com auditoria). `--devolver-ia`: conversas ABERTAS das últimas 48 h em
 * "humano" e sem responsável voltam para o agente padrão do canal.
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
let TENANT = arg('--tenant');
const NOME = arg('--nome');
const APLICAR = process.argv.includes('--aplicar');
const DEVOLVER = process.argv.includes('--devolver-ia');
const MODELO = 'claude-sonnet-5-5';
if (!TENANT && !NOME) {
  console.error('uso: --tenant UUID | --nome "parte do nome" [--aplicar] [--devolver-ia]');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('defina DATABASE_URL (a de produção) antes do comando');
  process.exit(1);
}
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { VersioningService } = require('../../dist/agents/versioning/versioning.service');
const { AtendimentoService } = require('../../dist/crm/messaging/atendimento.service');
const { resolverConfig, mesclarConfig } = require('../../dist/agents/config/agent-config');

const ehOllama = (m) => !!m && !/^claude-/.test(m);

// Só os serviços usados, montados à mão: sem Redis, sem fila, sem socket.
// O "tempo real" da tela não é avisado daqui; o evento durável sai pelos
// gatilhos do banco (migration 022), como em qualquer escrita.
const prisma = new PrismaService();
await prisma.$connect();
const versoes = new VersioningService(prisma);
const atendimento = new AtendimentoService(prisma, { publicar() {} });
try {
  if (!TENANT) {
    const achados = await prisma.tenant.findMany({ where: { nome: { contains: NOME, mode: 'insensitive' } }, select: { id: true, nome: true } });
    if (achados.length !== 1) {
      console.log(achados.length ? `"${NOME}" bate com ${achados.length} subcontas, rode de novo com --tenant:` : `nenhuma subconta com "${NOME}" no nome`);
      for (const t of achados) console.log(`   ${t.id}  ${t.nome}`);
      process.exitCode = 1;
      throw null;
    }
    TENANT = achados[0].id;
    console.log(`subconta: ${achados[0].nome} (${TENANT})`);
  }
  // Provedor de produção (Render): os agentes rodam na Anthropic.
  const provedor = 'anthropic';
  console.log('1) provedor e chave de IA: confira no servidor (AI_PROVIDER=anthropic, ANTHROPIC_API_KEY definida, sem ANTHROPIC_MODEL_FORCE)');

  const dados = await prisma.withTenant(TENANT, async (tx) => {
    const agentes = await tx.agent.findMany({ where: { status: { not: 'arquivado' } }, orderBy: { createdAt: 'asc' } });
    const efetivos = [];
    for (const a of agentes) efetivos.push({ a, e: await versoes.efetivo(tx, a) });
    const desde = new Date(Date.now() - 48 * 3600_000);
    const conversas = await tx.conversation.groupBy({ by: ['canal', 'atendimento', 'status'], where: { updatedAt: { gte: desde } }, _count: { _all: true } });
    const runs = await tx.agentRun.findMany({ orderBy: { createdAt: 'desc' }, take: 15, select: { status: true, motivo: true, modelo: true, createdAt: true, latenciaMs: true } });
    const dono = await tx.membership.findFirst({ where: { tenantId: TENANT, role: { in: ['owner', 'admin'] } }, orderBy: { createdAt: 'asc' }, select: { identityId: true } });
    return { efetivos, conversas, runs, dono };
  });

  console.log('2) agentes (o runtime usa a versão PUBLICADA):');
  if (!dados.efetivos.length) console.log('   ! nenhum agente: a IA não tem quem responda');
  for (const { a, e } of dados.efetivos) {
    const intel = e.config?.inteligencia ?? {};
    const alertas = [];
    if (a.status !== 'ativo') alertas.push(`status ${a.status}`);
    if (provedor === 'anthropic' && ehOllama(e.modelo)) alertas.push(`modelo ${e.modelo} é do Ollama, a Anthropic recusa`);
    if (provedor === 'anthropic' && ehOllama(intel.modeloAnalise)) alertas.push(`análise em ${intel.modeloAnalise} (Ollama)`);
    if (provedor === 'anthropic' && ehOllama(intel.modeloFallback)) alertas.push(`fallback em ${intel.modeloFallback} (Ollama)`);
    if (a.modelo !== e.modelo) alertas.push(`rascunho em ${a.modelo}, publicado em ${e.modelo} (publicar)`);
    console.log(`   - ${a.nome}: ${a.status}${a.padrao ? ' · PADRÃO' : ''} · canais ${a.canais.join('/')} · modelo ${e.modelo}` +
      ` · análise ${intel.modeloAnalise ?? '(mesmo)'} · fallback ${intel.modeloFallback ?? '(nenhum)'}${alertas.length ? `\n     ! ${alertas.join(' | ')}` : ''}`);
  }
  if (!dados.efetivos.some(({ a }) => a.padrao && a.status === 'ativo')) {
    console.log('   · nenhum agente PADRÃO ativo: conversa nova nasce com HUMANO; só o nó "Ativar IA" de uma automação (ou o botão na conversa) liga a IA');
  }

  console.log('3) conversas movimentadas nas últimas 48 h (canal · atendimento · status: quantidade):');
  for (const c of dados.conversas) console.log(`   - ${c.canal} · ${c.atendimento} · ${c.status}: ${c._count._all}`);
  if (!dados.conversas.length) console.log('   (nenhuma): a mensagem nem chegou ao CRM → webhook/Stevo, não a IA');

  console.log('4) últimas execuções do agente:');
  if (!dados.runs.length) console.log('   (nenhuma): a mensagem nunca chegou ao agente — conversa em "humano" ou worker parado');
  for (const r of dados.runs) console.log(`   - ${r.createdAt.toISOString().slice(0, 16)} · ${r.status} · ${r.modelo ?? '-'} · ${(r.motivo ?? '').slice(0, 120)}`);

  if (APLICAR) {
    if (!dados.dono) throw new Error('tenant sem dono/admin para assinar a publicação');
    for (const { a } of dados.efetivos.filter(({ a }) => a.status === 'ativo')) {
      await prisma.withTenant(TENANT, async (tx) => {
        const { config } = resolverConfig(a.config);
        const nova = mesclarConfig(config, { inteligencia: { ...config.inteligencia, modeloAnalise: null, modeloFallback: null } });
        await tx.agent.update({ where: { id: a.id }, data: { modelo: MODELO, config: nova } });
      });
      await versoes.publicar(TENANT, { identityId: dados.dono.identityId }, a.id, { notas: `modelo ${MODELO} (operação)`, origem: 'publicacao' });
      console.log(`+ ${a.nome}: ${MODELO} publicado`);
    }
  }

  if (DEVOLVER) {
    const alvo = await prisma.withTenant(TENANT, (tx) => tx.conversation.findMany({
      where: { atendimento: 'humano', assigneeId: null, status: { not: 'resolvida' }, updatedAt: { gte: new Date(Date.now() - 48 * 3600_000) } },
      select: { id: true },
    }));
    let ok = 0;
    for (const c of alvo) {
      try { await atendimento.ativarIaSistema(TENANT, c.id); ok++; } catch (e) { console.log(`   ! conversa ${c.id.slice(0, 8)}…: ${e.message}`); }
    }
    console.log(`+ ${ok}/${alvo.length} conversas devolvidas para a IA`);
  }
} catch (e) {
  if (e === null) { /* já explicado acima */ } else console.error('ERRO:', e?.response?.message ?? e?.message ?? e);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

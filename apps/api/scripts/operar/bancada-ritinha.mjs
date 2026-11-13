#!/usr/bin/env node
/**
 * Bancada da Ritinha: roda o MESMO Intelligence Core do atendimento em modo
 * simulação (nada é enviado nem gravado). Uso (de apps/api):
 *   node --env-file=.env bench-ritinha.mjs [cenario1,cenario2] [--json saida.json]
 * Variações por env: BENCH_ANALISE=off|mesmo|<modelo>, BENCH_MODELO, BENCH_TIMEOUT,
 * BENCH_SEM_KB=1, BENCH_INSTR=<arquivo de instruções>, BENCH_DIST=dist|dist-ritinha
 */
import { createRequire } from 'node:module';
import { writeFileSync, readFileSync } from 'node:fs';
const API = '/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api';
const require = createRequire(API + '/package.json');
require('reflect-metadata');
const D = API + '/' + (process.env.BENCH_DIST || 'dist');
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require(D + '/app.module');
const { PrismaService } = require(D + '/prisma/prisma.service');
const { IntelligenceCoreService } = require(D + '/agents/intelligence/intelligence-core.service');
const { VersioningService } = require(D + '/agents/versioning/versioning.service');
const { KnowledgeService } = require(D + '/agents/knowledge/knowledge.service');
const { perfilVazio } = require(D + '/agents/intelligence/profile.service');

const TENANT = '1cc7e839-f72c-414b-9d3f-a8b4131008c8';
const AGENTE = '29c232e5-418e-40fe-b449-911e9ce37e26';

const CENARIOS = [
  { id: 'gel-sabado', turnos: [['Oi, tudo bem? Queria saber quanto tá o alongamento de gel e se vocês atendem sábado']] },
  { id: 'oi-seco', turnos: [['oi'], ['qnt ta a sobrancelha']] },
  { id: 'luzes-mani', turnos: [['Oii vim do site e gostaria de saber mais sobre: Luzes'], ['quero saber tambem quanto fica a manicure junto'], ['pode ser tudo junto', 'aceita cartão?']] },
  { id: 'preco-caro', turnos: [['quanto custa o lash lift?'], ['nossa achei caro, faz desconto?']] },
  { id: 'reclamacao', turnos: [['Estou muito chateada, marquei ontem e ninguém me atendeu, fiquei esperando 40 minutos!']] },
  { id: 'digitacao', turnos: [['oi qero sabe o preso da progresiva', 'vcs atende sabadu?']] },
  { id: 'noiva', turnos: [['Boa tarde! Vou casar em março e queria fazer cabelo e maquiagem com vocês, como funciona?']] },
  { id: 'fora-escopo', turnos: [['vcs vendem produto de cabelo? queria comprar um shampoo']] },
  { id: 'escolha', turnos: [['quero fazer manicure e pedicure sexta de manhã', 'tem horário?'], ['pode ser às 9'], ['sim']] },
  { id: 'agendar', turnos: [['quero agendar manicure e pedicure pra sexta de manhã']] },
];

const filtro = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;
const jsonIdx = process.argv.indexOf('--json');
const saidaJson = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const resultados = [];
try {
  const prisma = app.get(PrismaService);
  const core = app.get(IntelligenceCoreService);
  const versoes = app.get(VersioningService);
  const conhecimento = app.get(KnowledgeService);
  const { efetivo, tenant, contato } = await prisma.withTenant(TENANT, async (tx) => {
    const a = await tx.agent.findUnique({ where: { id: AGENTE } });
    return {
      efetivo: await versoes.efetivo(tx, a),
      tenant: await tx.tenant.findUnique({ where: { id: TENANT }, select: { nome: true, nicho: true, subespecialidade: true } }),
      contato: await tx.contact.findFirst({ where: { telefone: process.env.BANCADA_FONE || '+5518900000101' }, select: { id: true } }),
    };
  });
  if (process.env.BENCH_ANALISE === 'off') efetivo.config.inteligencia.analiseAtiva = false;
  else if (process.env.BENCH_ANALISE) efetivo.config.inteligencia.modeloAnalise = process.env.BENCH_ANALISE === 'mesmo' ? null : process.env.BENCH_ANALISE;
  if (process.env.BENCH_TIMEOUT) efetivo.config.inteligencia.timeoutMs = Number(process.env.BENCH_TIMEOUT);
  if (process.env.BENCH_SEM_KB) efetivo.conhecimentoAtivo = false;
  if (process.env.BENCH_INSTR) efetivo.instrucoes = readFileSync(process.env.BENCH_INSTR, 'utf8');
  if (process.env.BENCH_MODELO) process.env.OLLAMA_MODEL_AGENTE = process.env.BENCH_MODELO;
  const documentIds = await conhecimento.documentosDoAgente(TENANT, AGENTE, efetivo.config.conhecimento);
  console.log(`agente ${efetivo.nome} | provider ${process.env.AI_PROVIDER} | modelo local ${process.env.OLLAMA_MODEL_AGENTE || 'qwen3.5:9b'} | análise ${efetivo.config.inteligencia.analiseAtiva ? 'on' : 'off'} | kb ${efetivo.conhecimentoAtivo}`);

  for (const c of CENARIOS.filter((x) => !filtro || filtro.split(',').some((f) => x.id.includes(f)))) {
    console.log(`\n================ ${c.id} ================`);
    const historico = [];
    const turnos = [];
    for (const rajada of c.turnos) {
      for (const m of rajada) {
        historico.push({ autorTipo: 'contato', corpo: m });
        console.log(`  CLIENTE: ${m}`);
      }
      const t0 = Date.now();
      let r;
      try {
        r = await core.processar({
          tenantId: TENANT, agente: efetivo, empresa: tenant.nome, nicho: tenant.nicho, subespecialidade: tenant.subespecialidade,
          // contato de teste (número fictício): ferramentas de LEITURA (agenda) funcionam; escrita é só descrita (simulacao)
          conversationId: null, contactId: contato?.id ?? null, contatoNome: 'Mariana Souza', messageId: null, runId: null,
          historico: [...historico], perfil: perfilVazio(contato?.id ?? null), memoria: { resumoConversa: null, longoPrazo: [], operacional: [] },
          intencoesExtras: [], regrasJaDisparadas: new Set(), documentIds, simulacao: true, origem: 'simulador',
        });
      } catch (e) {
        console.log(`  !! ERRO: ${e.message}`);
        turnos.push({ cliente: rajada, erro: e.message, ms: Date.now() - t0 });
        break;
      }
      const ms = Date.now() - t0;
      for (const b of r.fragmentacao.blocos) console.log(`  RITINHA [${b.ordem}]: ${b.texto}`);
      console.log(`    · ${r.decisao}${r.motivo ? ` (${r.motivo})` : ''} | ${ms}ms (análise ${r.tempos.analiseMs} / base ${r.tempos.conhecimentoMs} / geração ${r.tempos.geracaoMs}) | tokens ${r.tokensEntrada}/${r.tokensSaida} | intenção ${r.analise.intencao} | tools ${r.ferramentas.map((f) => `${f.nome}${f.ok ? '' : '(erro: ' + f.erro + ')'}`).join(',') || '-'}${r.validacao.length ? ` | validação: ${r.validacao.join('; ')}` : ''}`);
      turnos.push({ cliente: rajada, blocos: r.fragmentacao.blocos.map((b) => b.texto), decisao: r.decisao, motivo: r.motivo, ms, tempos: r.tempos, tokens: [r.tokensEntrada, r.tokensSaida], intencao: r.analise.intencao, tools: r.ferramentas });
      for (const b of r.fragmentacao.blocos) historico.push({ autorTipo: 'ia', corpo: b.texto });
      if (r.decisao !== 'responder') break;
    }
    resultados.push({ id: c.id, turnos });
  }
} finally {
  await app.close();
  if (saidaJson) writeFileSync(saidaJson, JSON.stringify(resultados, null, 2));
}

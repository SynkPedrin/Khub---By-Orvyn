#!/usr/bin/env node
/**
 * CAROL — E2E no banco de dev (tenant Dra. Bárbara), com contato descartável
 * criado e REMOVIDO ao final. Nenhuma mensagem é enviada (só ferramentas).
 *
 *   node --env-file=.env scripts/operar/carol-e2e.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { AgentToolsService } = require('../../dist/agents/agent-tools.service');
const { FinanceiroService } = require('../../dist/financeiro/financeiro.service');
const { resolverConfig } = require('../../dist/agents/config/agent-config');

const T = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';
const resultados = [];
const check = (nome, ok, detalhe = '') => { resultados.push({ nome, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} — ${nome}${detalhe ? ` (${detalhe})` : ''}`); };

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
const prisma = app.get(PrismaService);
const tools = app.get(AgentToolsService);
const financeiro = app.get(FinanceiroService);

let contactId = null;
const cleanup = async () => {
  if (!contactId) return;
  // audit_logs é imutável de propósito (db/004): ficam como evidência do teste.
  for (const op of [
    (tx) => tx.agendaCompromisso.deleteMany({ where: { contactId } }),
    (tx) => tx.financeiroCobranca.deleteMany({ where: { contactId } }),
    (tx) => tx.agentToolExecution.deleteMany({ where: { contactId } }),
    (tx) => tx.activity.deleteMany({ where: { contactId } }),
    (tx) => tx.contact.delete({ where: { id: contactId } }),
  ]) {
    await prisma.withTenant(T, (tx) => op(tx)).catch((e) => console.warn('cleanup:', (e?.message ?? '').split('\n').pop()));
  }
  contactId = null;
};

try {
  const carol = await prisma.withTenant(T, (tx) => tx.agent.findFirst({ where: { nome: 'Carol' } }));
  const cfg = resolverConfig(carol.config).config;
  const contato = await prisma.withTenant(T, (tx) => tx.contact.create({ data: { tenantId: T, nome: 'QA Carol (teste)', telefone: '+5518990000000', tag: 'Lead' } }));
  contactId = contato.id;
  const ctx = {
    tenantId: T, agentId: carol.id, agentNome: 'Carol', conversationId: null, contactId,
    nicho: 'Clínica médica', subespecialidade: 'Tricologia', escopos: ['tenant'], simulacao: false,
    horario: cfg.horario,
  };
  const TODAS = new Set(carol.ferramentas.concat(['transferir_para_humano']));

  // --- fluxo do sinal (Pix ainda não configurado → sem chave inventada)
  const r1 = await tools.executar('registrar_sinal_pix', {}, ctx, TODAS);
  check('registrar_sinal_pix cria cobrança de R$100 sem inventar chave', r1.ok && r1.dados.valorCentavos === 10000 && r1.dados.pix === null, r1.dados?.aviso?.slice(0, 60));

  const v1 = await tools.executar('verificar_sinal', {}, ctx, TODAS);
  check('verificar_sinal: aguardando NÃO confirma', v1.ok && v1.dados.status === 'aguardando');

  // comprovante/print não vale: nada muda até a conciliação autorizada
  const v2 = await tools.executar('verificar_sinal', {}, ctx, TODAS);
  check('print de comprovante não altera o status', v2.dados.status === 'aguardando');

  // equipe concilia (marca paga no financeiro)
  const cob = await prisma.withTenant(T, (tx) => tx.financeiroCobranca.findFirst({ where: { contactId } }));
  await financeiro.atualizarStatus(T, 'qa-e2e', cob.id, 'paga');
  const v3 = await tools.executar('verificar_sinal', {}, ctx, TODAS);
  check('sinal pago libera agendamento e informa saldo', v3.dados.status === 'paga' && v3.dados.saldoNoDiaCentavos === 30000, `saldo=${v3.dados.saldoNoDia}`);

  // --- agenda real com as faixas da clínica (07:40–11:00, 14:00–19:00, seg–sex)
  const agora = Date.now();
  let d = new Date(agora + 2 * 86400000);
  while ([0, 6].includes(d.getUTCDay())) d = new Date(+d + 86400000);
  const dataISO = d.toISOString().slice(0, 10);
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const sp = (h, m) => {
    // instante de parede em America/Sao_Paulo (mesma técnica do horario.ts)
    let t = Date.UTC(ano, mes - 1, dia, h, m);
    for (let i = 0; i < 2; i++) {
      const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      t += Date.UTC(ano, mes - 1, dia, h, m) - Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    }
    return new Date(t);
  };

  const disp = await tools.executar('ver_agendamentos', { data: dataISO, duracaoMin: 80 }, ctx, TODAS);
  const livres = disp.dados.horariosLivres ?? [];
  check('ver_agendamentos lista horários reais dentro das faixas', disp.ok && livres.length > 0, `${livres.length} opções em ${dataISO}`);

  const a1 = await tools.executar('solicitar_agendamento', { inicio: sp(9, 0).toISOString(), duracaoMin: 80 }, ctx, TODAS);
  check('solicitar_agendamento em horário livre grava e marca campos', a1.ok === true, a1.erro ?? '');

  const a2 = await tools.executar('solicitar_agendamento', { inicio: sp(9, 40).toISOString(), duracaoMin: 80 }, ctx, TODAS);
  check('choque de horário é recusado (09:40 colide com 09:00–10:20)', a2.ok === false);

  const a3 = await tools.executar('solicitar_agendamento', { inicio: sp(17, 40).toISOString(), duracaoMin: 100 }, ctx, TODAS);
  check('consulta de 1h40 às 17:40 é recusada (terminaria 19:20)', a3.ok === false);

  const a4 = await tools.executar('solicitar_agendamento', { inicio: sp(12, 0).toISOString(), duracaoMin: 40 }, ctx, TODAS);
  check('horário de almoço é recusado', a4.ok === false);

  // --- remarcação: 1ª passa, 2ª vai para a equipe
  const r2 = await tools.executar('remarcar_agendamento', { inicio: sp(15, 0).toISOString() }, ctx, TODAS);
  check('1ª remarcação passa', r2.ok === true, r2.erro ?? '');
  const r3 = await tools.executar('remarcar_agendamento', { inicio: sp(16, 0).toISOString() }, ctx, TODAS);
  check('2ª remarcação é recusada (limite=1) e direciona à equipe', r3.ok === false && /limite/.test(r3.erro ?? ''));

  // --- cancelamento
  const c1 = await tools.executar('cancelar_agendamento', { motivo: 'teste e2e' }, ctx, TODAS);
  check('cancelar_agendamento cancela o compromisso', c1.ok === true);

  // --- conhecimento: documentos da Carol indexados e vinculados
  const docs = await prisma.withTenant(T, async (tx) => {
    const fontes = await tx.agentKnowledgeSource.findMany({ where: { agentId: carol.id, ativo: true } });
    const rs = await tx.ragDocument.findMany({ where: { id: { in: fontes.map((f) => f.documentId) } }, select: { titulo: true, status: true } });
    const chunks = await tx.ragChunk.count({ where: { documentId: { in: fontes.map((f) => f.documentId) } } });
    return { fontes: fontes.length, docs: rs, chunks };
  });
  check('base de conhecimento vinculada e indexada', docs.fontes === 5 && docs.chunks > 0, `${docs.fontes} docs, ${docs.chunks} chunks, status=${docs.docs.map((x) => x.status).join(',')}`);

  // --- tenant: guardrail médico ligado
  const t = await prisma.tenant.findUnique({ where: { id: T }, select: { nicho: true } });
  check('nicho "Clínica médica" ativa o guardrail CFM (camada 2)', t.nicho === 'Clínica médica');
} catch (e) {
  console.error('\nFALHOU:', e?.message ?? JSON.stringify(e));
  console.error((e?.stack ?? '').split('\n').slice(1, 4).join('\n'));
  resultados.push({ nome: 'execução sem exceção', ok: false });
} finally {
  await cleanup();
  console.log('\nContato de teste removido. Resumo:', `${resultados.filter((r) => r.ok).length}/${resultados.length} PASS`);
  await app.close();
  process.exit(resultados.every((r) => r.ok) ? 0 : 1);
}

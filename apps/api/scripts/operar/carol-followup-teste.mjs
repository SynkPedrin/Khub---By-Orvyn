#!/usr/bin/env node
/**
 * Homologação Carol — teste do motor de follow-up (Fase 2, §9).
 * Aceleração de relógio EXPLÍCITA: o follow-up é criado já vencido
 * (agendado_para no passado) para provar o disparo lógico — NÃO significa
 * que 2h reais se passaram. O envio real é restrito ao número de teste
 * (trava STEVO_TEST_NUMBER) e identificado como teste no contexto.
 *
 * Prova: disparo por vencimento; cancelamento por resposta/agendamento/opt-out
 * verificado IMEDIATAMENTE antes do envio; janela de horário.
 *
 * uso: pnpm build && AI_PROVIDER=anthropic node --env-file=.env scripts/operar/carol-followup-teste.mjs
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { FollowupService } = require('../../dist/agents/followup/followup.service');

const TENANT = 'c5b82d42-cd59-443e-bb3d-c0c8cbdad2a3';
const CAROL = '4894728f-6c53-4a90-8cfa-d07707e39ea9';
const REGRA_SEM_RESPOSTA = 'f32be4be-21d2-4145-9e6d-670bdbc65ce1';

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const ok = [];
const falha = [];
const t = (nome, cond, detalhe = '') => (cond ? ok : falha).push(`${nome}${detalhe ? ' — ' + detalhe : ''}`);

try {
  const prisma = app.get(PrismaService);
  const followups = app.get(FollowupService);
  if (process.env.NODE_ENV === 'production') throw new Error('recusado em produção');
  if (process.env.STEVO_TEST_NUMBER !== '5518991652039') throw new Error('trava de dev ausente');

  const alvo = await prisma.withTenant(TENANT, async (tx) => {
    const rows = await tx.$queryRaw`SELECT c.id AS contact_id, v.id AS conversation_id FROM contacts c JOIN conversations v ON v.contact_id=c.id AND v.canal='WhatsApp'
      WHERE c.tenant_id=${TENANT}::uuid AND c.campos_custom->>'qa_id'='QA-CAROL-20261116' LIMIT 1`;
    return rows[0];
  });
  if (!alvo) throw new Error('contato QA não encontrado');

  const limparAgendados = () =>
    prisma.withTenant(TENANT, (tx) =>
      tx.agentFollowup.updateMany({ where: { contactId: alvo.contact_id, status: { in: ['agendado', 'gerando'] } }, data: { status: 'cancelado', motivo: 'preparando cenário de homologação', updatedAt: new Date() } }),
    );

  const criarFollowup = async (minutosAtras, contexto = {}) => {
    await limparAgendados(); // unique: só 1 agendado por contato — cenário começa limpo
    return prisma.withTenant(TENANT, (tx) =>
      tx.agentFollowup.create({
        data: {
          tenantId: TENANT, agentId: CAROL, ruleId: REGRA_SEM_RESPOSTA, contactId: alvo.contact_id, conversationId: alvo.conversation_id,
          cicloId: crypto.randomUUID(), estrategia: 'sem_resposta', tentativa: 1, status: 'agendado',
          agendadoPara: new Date(Date.now() - minutosAtras * 60_000),
          contexto: { referencia: new Date().toISOString(), homologacao: 'QA-CAROL-20261116', ...contexto },
        },
      }),
    );
  };
  const estado = (id) => prisma.withTenant(TENANT, (tx) => tx.agentFollowup.findUnique({ where: { id }, select: { status: true, motivo: true, mensagem: true } }));

  // CENÁRIO 1 — follow-up vencido dispara e envia de verdade (restrito ao nº de teste)
  const SEM_ENVIO = process.argv.includes('--sem-envio');
  let regraAntiga;
  await prisma.withTenant(TENANT, async (tx) => {
    regraAntiga = await tx.agentFollowupRule.findUnique({ where: { id: REGRA_SEM_RESPOSTA }, select: { maxMensagensDia: true } });
    await tx.agentFollowupRule.update({ where: { id: REGRA_SEM_RESPOSTA }, data: { maxMensagensDia: 5 } }); // teto do check constraint: isenta o limite diário durante o teste
  });
  if (SEM_ENVIO) {
    console.log('C1: pulado (--sem-envio) — já provado no 1º run (follow-up real entregue no WhatsApp de teste)');
  } else {
    const fu1 = await criarFollowup(1);
    await followups.processarVencidos(TENANT);
    const f1 = await estado(fu1.id);
    t('C1: follow-up vencido é processado e enviado', f1.status === 'enviado', `status=${f1.status} motivo=${f1.motivo ?? ''}`);
    if (f1.mensagem) console.log('  mensagem enviada:', JSON.stringify(f1.mensagem.slice(0, 200)));
  }

  // CENÁRIO 2 — contato respondeu depois da referência: cancela imediatamente antes do envio
  await prisma.withTenant(TENANT, (tx) => tx.contact.update({ where: { id: alvo.contact_id }, data: { lastInboundAt: new Date() } }));
  const fu2 = await criarFollowup(1, { referencia: new Date(Date.now() - 3_600_000).toISOString() }); // referência 1h atrás → resposta é mais nova
  await followups.executar(TENANT, fu2.id);
  const f2 = await estado(fu2.id);
  t('C2: contato respondeu → follow-up cancelado na hora do envio', f2.status === 'cancelado', `status=${f2.status} motivo=${f2.motivo ?? ''}`);

  // CENÁRIO 3 — contato agendou DEPOIS do follow-up ser criado: cancela
  const fu3 = await criarFollowup(1);
  const comp = await prisma.withTenant(TENANT, async (tx) => {
    const inicio = new Date(Date.now() + 48 * 3_600_000);
    const rows = await tx.$queryRaw`INSERT INTO agenda_compromissos (id, tenant_id, contact_id, inicio, fim, titulo, status, created_at, updated_at)
      VALUES (gen_random_uuid(), ${TENANT}::uuid, ${alvo.contact_id}::uuid, ${inicio}, ${new Date(inicio.getTime() + 80 * 60_000)}, 'TESTE HOMOLOGAÇÃO (descartável)', 'agendado', now(), now()) RETURNING id`;
    return rows[0].id;
  });
  const fu3 = await criarFollowup(1);
  await followups.executar(TENANT, fu3.id);
  const f3 = await estado(fu3.id);
  t('C3: contato com compromisso → follow-up cancelado', f3.status === 'cancelado', `status=${f3.status} motivo=${f3.motivo ?? ''}`);
  await prisma.withTenant(TENANT, (tx) => tx.$executeRaw`DELETE FROM agenda_compromissos WHERE id=${comp}::uuid`);

  // CENÁRIO 6 — opt-out: cancela e não envia
  await prisma.withTenant(TENANT, (tx) => tx.contact.update({ where: { id: alvo.contact_id }, data: { optedOutAt: new Date() } }));
  const fu6 = await criarFollowup(1);
  await followups.executar(TENANT, fu6.id);
  const f6 = await estado(fu6.id);
  t('C6: opt-out → follow-up cancelado sem envio', f6.status === 'cancelado', `status=${f6.status} motivo=${f6.motivo ?? ''}`);
  await prisma.withTenant(TENANT, (tx) => tx.contact.update({ where: { id: alvo.contact_id }, data: { optedOutAt: null } }));

  // CENÁRIO JANELA — fora da janela 08–19: adiado, não enviado
  const fuJ = await criarFollowup(1);
  await prisma.withTenant(TENANT, async (tx) => {
    await tx.agentFollowupRule.update({ where: { id: REGRA_SEM_RESPOSTA }, data: { horarioInicio: 20, horarioFim: 21 } }); // janela que exclui o momento do teste
  });
  await followups.executar(TENANT, fuJ.id).catch(() => {});
  const fJ = await estado(fuJ.id);
  await prisma.withTenant(TENANT, (tx) => tx.agentFollowupRule.update({ where: { id: REGRA_SEM_RESPOSTA }, data: { horarioInicio: 8, horarioFim: 19, maxMensagensDia: regraAntiga?.maxMensagensDia ?? 1 } }));
  t('Janela: fora do horário não envia (adiado/cancelado)', ['adiado', 'cancelado', 'agendado'].includes(fJ.status), `status=${fJ.status} motivo=${fJ.motivo ?? ''}`);
  await prisma.withTenant(TENANT, (tx) => tx.agentFollowup.updateMany({ where: { id: fuJ.id }, data: { status: 'cancelado', motivo: 'fim do teste de janela' } }));

  console.log('\n=== FOLLOW-UP ===');
  for (const s of ok) console.log('PASS —', s);
  for (const s of falha) console.log('FAIL —', s);
  console.log(`Resumo: ${ok.length}/${ok.length + falha.length} PASS`);
  process.exitCode = falha.length ? 1 : 0;
} catch (e) {
  console.error('ERRO:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await app.close();
  process.exit(process.exitCode ?? 0);
}

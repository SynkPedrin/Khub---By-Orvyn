#!/usr/bin/env node
/**
 * Liga a agenda do salão na Ritinha (Studio da Beleza) em PRODUÇÃO.
 * Sem `--aplicar` só LÊ e mostra o que faria. Nunca imprime telefone inteiro.
 *
 * Precisa só do banco (DATABASE_URL de produção) e do build da API com o
 * commit bf9dc46 (agents/salao):
 *
 *   cd apps/api && pnpm build
 *   DATABASE_URL='postgres://…' node scripts/operar/ritinha-agenda-producao.mjs --nome "Studio"
 *   DATABASE_URL='postgres://…' node scripts/operar/ritinha-agenda-producao.mjs --nome "Studio" --aplicar
 *
 * `--aplicar`:
 *  1. Ritinha ganha as ferramentas ver_horarios_salao e reservar_horario_salao,
 *     as instruções v4 (scripts/operar/ritinha-instrucoes-v4.txt) e uma versão
 *     PUBLICADA nova (o runtime usa a publicada).
 *  2. Toda automação ATIVA com "Notificar equipe" para outro número passa a
 *     avisar o número da "Notificação Interna (importado do GHL)": versão nova
 *     da automação (a anterior fica no histórico, dá para voltar).
 * NÃO muda a Ritinha para agente padrão (isso é depois do teste no número autorizado).
 */
import 'reflect-metadata';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
let TENANT = arg('--tenant');
const NOME = arg('--nome');
const APLICAR = process.argv.includes('--aplicar');
const FERRAMENTAS_NOVAS = ['ver_horarios_salao', 'reservar_horario_salao'];
if (!TENANT && !NOME) {
  console.error('uso: --tenant UUID | --nome "parte do nome" [--aplicar]');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('defina DATABASE_URL (a de produção) antes do comando');
  process.exit(1);
}
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { VersioningService } = require('../../dist/agents/versioning/versioning.service');
const { SalaoAgendaService } = require('../../dist/agents/salao/salao-agenda.service');
const mascara = (t) => (t ? `…${String(t).replace(/\D/g, '').slice(-4)}` : '—');

const prisma = new PrismaService();
await prisma.$connect();
const versoes = new VersioningService(prisma);
const salao = new SalaoAgendaService(prisma, { notificarNumero: async () => ({ status: 'nao_enviado', erro: 'script' }) });
try {
  if (!TENANT) {
    const t = await prisma.$queryRaw`SELECT id, nome FROM tenants WHERE nome ILIKE ${'%' + NOME + '%'} ORDER BY created_at LIMIT 2`;
    if (t.length !== 1) throw new Error(`"${NOME}" bate com ${t.length} contas; use --tenant`);
    TENANT = t[0].id;
    console.log(`conta: ${t[0].nome} (${TENANT})`);
  }
  const fuso = process.env.APP_TIMEZONE || 'America/Sao_Paulo';

  // 1) estado
  const { agentes, fluxos, dono, semProf } = await prisma.withTenant(TENANT, async (tx) => ({
    agentes: await tx.agent.findMany({ where: { status: { not: 'arquivado' } }, select: { id: true, nome: true, status: true, padrao: true, ferramentas: true, versaoPublicadaId: true, canais: true } }),
    fluxos: await tx.workflow.findMany({ where: { status: 'ativo', versaoAtivaId: { not: null } }, select: { id: true, nome: true, versaoAtiva: { select: { versao: true, grafo: true } } } }),
    dono: await tx.membership.findFirst({ where: { tenantId: TENANT, role: { in: ['owner', 'admin'] } }, orderBy: { createdAt: 'asc' }, select: { identityId: true } }),
    semProf: await tx.agendaCompromisso.count({ where: { inicio: { gte: new Date() }, status: { in: ['agendado', 'confirmado'] }, profissionalId: null } }),
  }));
  const rita = agentes.find((a) => /ritinha/i.test(a.nome));
  if (!rita) throw new Error(`Ritinha não encontrada (agentes: ${agentes.map((a) => a.nome).join(', ')})`);
  console.log(`\nRitinha: status=${rita.status} padrão=${rita.padrao} publicada=${!!rita.versaoPublicadaId} canais=${rita.canais.join(',')}`);
  console.log(`  ferramentas de salão: ${FERRAMENTAS_NOVAS.map((f) => `${f}=${rita.ferramentas.includes(f) ? 'sim' : 'não'}`).join(' ')}`);

  const fone = await salao.telefoneEquipe(TENANT);
  console.log(`\nnúmero da equipe (Notificação Interna do GHL): ${mascara(fone)}`);
  const nosNotificar = (g) => (g?.nos ?? []).filter((n) => n.tipo === 'acao.notificar_equipe');
  const trocar = [];
  for (const f of fluxos) {
    const nos = nosNotificar(f.versaoAtiva?.grafo);
    if (!nos.length) continue;
    const diferentes = nos.filter((n) => String(n.config?.telefone ?? '').replace(/\D/g, '') !== fone);
    console.log(`  automação "${f.nome}" v${f.versaoAtiva.versao}: ${nos.map((n) => mascara(n.config?.telefone)).join(', ')}${diferentes.length ? '  ← vai para o número do GHL' : ''}`);
    const agendado = (f.versaoAtiva?.grafo?.nos ?? []).some((n) => n.tipo === 'gatilho.agendado');
    if (diferentes.length && !agendado) trocar.push(f);
    if (diferentes.length && agendado) console.log('    (gatilho agendado: trocar pela tela, não por script)');
  }
  console.log(`\natendimentos futuros SEM profissional (a IA não enxerga): ${semProf}`);

  // amostra: o que a Ritinha veria amanhã
  const amanha = new Intl.DateTimeFormat('en-CA', { timeZone: fuso }).format(new Date(Date.now() + 86_400_000));
  for (const servico of ['mão', 'pé', 'escova']) {
    try {
      const r = await salao.horarios(TENANT, { servico, data: amanha }, fuso);
      console.log(`  ${amanha} · ${r.servico.nome} (${r.servico.duracaoMin} min): ${r.profissionais.map((p) => `${p.nome} ${p.horarios.slice(0, 3).join('/')}`).join(' | ') || 'sem vaga'}`);
    } catch (e) {
      console.log(`  ${servico}: ${e.message}`);
    }
  }

  if (!APLICAR) {
    console.log('\n(só leitura; rode com --aplicar para gravar)');
  } else {
    if (!dono) throw new Error('conta sem dono/admin para assinar a publicação');
    if (!fone) throw new Error('nenhuma Notificação Interna ativa com telefone: a reserva não teria a quem avisar');
    const instrucoes = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ritinha-instrucoes-v4.txt'), 'utf8');
    await prisma.withTenant(TENANT, (tx) =>
      tx.agent.update({ where: { id: rita.id }, data: { instrucoes, ferramentas: [...new Set([...rita.ferramentas, ...FERRAMENTAS_NOVAS])] } }),
    );
    await versoes.publicar(TENANT, { identityId: dono.identityId }, rita.id, { notas: 'agenda do salão (ver/reservar horários) + instruções v4', origem: 'publicacao' });
    console.log('\n✔ Ritinha publicada (versão nova) com as ferramentas de agenda e as instruções v4');
    for (const f of trocar) {
      const grafo = structuredClone(f.versaoAtiva.grafo);
      for (const n of nosNotificar(grafo)) n.config = { ...n.config, telefone: fone };
      await prisma.withTenant(TENANT, async (tx) => {
        const max = await tx.workflowVersion.aggregate({ where: { workflowId: f.id }, _max: { versao: true } });
        const nova = await tx.workflowVersion.create({
          data: { tenantId: TENANT, workflowId: f.id, versao: (max._max.versao ?? 0) + 1, grafo, publicadoEm: new Date(), publicadoPor: dono.identityId },
        });
        await tx.workflow.update({ where: { id: f.id }, data: { versaoAtivaId: nova.id, updatedAt: new Date() } });
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id)
          VALUES (${TENANT}::uuid, 'sistema', 'ritinha-agenda-producao', 'workflow.telefone_equipe', 'workflow', ${f.id}::uuid)`;
        console.log(`✔ "${f.nome}" v${nova.versao} avisa ${mascara(fone)}`);
      });
    }
  }
} finally {
  await prisma.$disconnect();
}

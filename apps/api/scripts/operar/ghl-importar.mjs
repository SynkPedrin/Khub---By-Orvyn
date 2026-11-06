#!/usr/bin/env node
/**
 * MIGRAÇÃO GHL → Revenue OS · etapa 2: IMPORTAR o retrato do `ghl-exportar.mjs`.
 *
 *   cd apps/api && pnpm build
 *   node --env-file=.env scripts/operar/ghl-importar.mjs --tenant UUID [--location ID]            # simulação
 *   node --env-file=.env scripts/operar/ghl-importar.mjs --tenant UUID [--location ID] --aplicar  # grava
 *
 * Garantias:
 *  - SIMULAÇÃO por padrão: lê tudo, monta o plano e imprime os números; nada grava.
 *  - HISTÓRICO NÃO DISPARA NADA: os gatilhos do banco criam eventos de outbox
 *    (contact.created, deal.created, message.created). Na MESMA transação eles
 *    são marcados `processed` (last_error = importacao_ghl) — o worker só
 *    despacha `pending`, então nenhuma automação, agente ou envio reage a
 *    mensagem antiga. Nenhuma mensagem é enviada a ninguém.
 *  - IDEMPOTENTE: rodar de novo não duplica. Contato = campos_custom.ghl_id (ou
 *    o mesmo telefone, se já chegou pela Stevo); mensagem = idempotency_key
 *    `ghl:<id>`; conversa = contato + canal; negócio = contato + funil.
 *  - Tudo sob RLS do tenant (withTenant), uma transação por contato.
 *  - Conversas cujo contato foi EXCLUÍDO no GHL não são importadas (respeita a
 *    exclusão); ficam no retrato para decisão humana.
 *  - Conversa importada nasce com atendimento HUMANO — a IA não assume histórico.
 */
import 'reflect-metadata';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const TENANT = arg('--tenant');
const LOC = arg('--location') ?? process.env.GHL_MIGRATION_LOCATION_ID;
const APLICAR = process.argv.includes('--aplicar');
if (!TENANT || !/^[0-9a-f-]{36}$/i.test(TENANT) || !LOC) {
  console.error('uso: --tenant UUID [--location ID] [--aplicar]');
  process.exit(1);
}
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/revenue-audit/evidence/ghl', LOC);
if (!existsSync(join(DIR, 'contacts.json'))) {
  console.error(`retrato não encontrado em ${DIR} — rode ghl-exportar.mjs antes`);
  process.exit(1);
}
const ler = (n) => JSON.parse(readFileSync(join(DIR, `${n}.json`), 'utf8'));

// ---------- leitura do retrato ----------
const contatos = ler('contacts');
const conversasGhl = ler('conversations');
const mensagens = ler('messages');
const oportunidades = ler('opportunities');
const funis = ler('pipelines');
const tags = ler('tags');
const camposDef = ler('custom_fields');
const valores = ler('custom_values');
const local = ler('location');

const nomeCampo = new Map(camposDef.map((c) => [c.id, c.name]));
const contatoPorId = new Map(contatos.map((c) => [c.id, c]));
const convPorId = new Map(conversasGhl.map((c) => [c.id, c]));

const HORA = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', hour12: false });
const hora = (iso) => HORA.format(new Date(iso));
const canalDe = (m) => (m.messageType === 'TYPE_INSTAGRAM' ? 'Instagram' : 'WhatsApp');
const STATUS_DEAL = { open: 'aberto', won: 'ganho', lost: 'perdido', abandoned: 'perdido' };
const CORES = ['#9B4DE0', '#7B2FBE', '#5B1E9E', '#B7791F', '#1E8449', '#2563EB', '#DC2626', '#0891B2'];

function nomeDoContato(c) {
  const n = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return n || c.contactName || c.phone || 'Contato sem nome';
}

function corpoDe(m) {
  const texto = (m.body ?? '').trim();
  const anexos = (m.attachments ?? []).map((a) => `📎 ${a}`);
  return [texto, ...anexos].filter(Boolean).join('\n') || '[mensagem sem conteúdo]';
}

/** Campos personalizados do GHL → `campos_custom` pelo NOME do campo (legível na UI). */
function camposDe(c) {
  const out = { ghl_id: c.id };
  for (const f of c.customFields ?? []) {
    const nome = nomeCampo.get(f.id);
    const v = f.value ?? f.fieldValue;
    if (nome && v !== undefined && v !== null && v !== '') out[nome] = v;
  }
  return out;
}

// ---------- plano ----------
// Mensagens por contato e canal (uma conversa GHL pode misturar WhatsApp e Instagram).
const plano = new Map(); // contactId -> { canais: Map(canal -> msgs[]) }
let orfas = 0;
const convOrfas = new Set();
for (const m of mensagens) {
  const conv = convPorId.get(m.conversationId);
  const cid = conv?.contactId ?? m.contactId;
  if (!contatoPorId.has(cid)) {
    orfas++;
    convOrfas.add(m.conversationId);
    continue;
  }
  const p = plano.get(cid) ?? { canais: new Map() };
  const canal = canalDe(m);
  p.canais.set(canal, [...(p.canais.get(canal) ?? []), m]);
  plano.set(cid, p);
}
for (const p of plano.values()) for (const l of p.canais.values()) l.sort((a, b) => a.dateAdded.localeCompare(b.dateAdded));

const resumo = {
  modo: APLICAR ? 'APLICAR' : 'simulação',
  subconta: local.name,
  contatos: contatos.length,
  conversas: [...plano.values()].reduce((s, p) => s + p.canais.size, 0),
  mensagens: mensagens.length - orfas,
  mensagensDeContatoExcluidoNoGhl: { mensagens: orfas, conversas: convOrfas.size },
  funis: funis.map((f) => `${f.name} (${f.stages.length} etapas)`),
  negocios: oportunidades.filter((o) => contatoPorId.has(o.contactId)).length,
  tags: tags.length,
  baseDeConhecimento: valores.filter((v) => String(v.value ?? '').trim()).length + ' itens',
};
console.log(JSON.stringify(resumo, null, 2));
if (!APLICAR) {
  console.log('\nsimulação — nada foi gravado. Repita com --aplicar para importar.');
  process.exit(0);
}

// ---------- aplicação ----------
const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('../../dist/app.module');
const { PrismaService } = require('../../dist/prisma/prisma.service');
const { IngestionService } = require('../../dist/rag/ingestion/ingestion.service');
const { acharContatoPorTelefone } = require('../../dist/crm/telefone');

const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const prisma = app.get(PrismaService);
const cont = { contatosCriados: 0, contatosMesclados: 0, contatosJaImportados: 0, conversasCriadas: 0, mensagensInseridas: 0, negociosCriados: 0, negociosJaExistiam: 0, eventosNeutralizados: 0, tagsCriadas: 0 };

/**
 * Eventos de outbox gerados NESTA transação (created_at = now() = início da tx)
 * viram `processed`: histórico importado não dispara automação nem agente.
 */
async function neutralizarOutbox(tx) {
  const n = await tx.$executeRaw`UPDATE outbox_events SET status='processed', processed_at=now(), last_error='importacao_ghl: histórico, não dispara'
    WHERE tenant_id=${TENANT}::uuid AND status='pending' AND created_at=now()`;
  cont.eventosNeutralizados += Number(n);
}

try {
  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT }, select: { nome: true } });
  if (!tenant) throw new Error('tenant não encontrado');
  console.log(`\nimportando para o tenant "${tenant.nome}"…`);

  // 1. Tags (catálogo)
  await prisma.withTenant(TENANT, async (tx) => {
    for (const t of tags) {
      const n = await tx.$executeRaw`INSERT INTO crm_tags (tenant_id, name) VALUES (${TENANT}::uuid, ${t.name}) ON CONFLICT (tenant_id, lower(name)) DO NOTHING`;
      cont.tagsCriadas += Number(n);
    }
  });

  // 2. Funis e etapas (idempotente por nome)
  const etapaMap = new Map(); // ghl stage id -> { pipelineId, stageId }
  for (const f of funis) {
    await prisma.withTenant(TENANT, async (tx) => {
      let p = await tx.pipeline.findFirst({ where: { nome: f.name } });
      if (!p) p = await tx.pipeline.create({ data: { tenantId: TENANT, nome: f.name, tipo: 'vendas' } });
      const existentes = await tx.stage.findMany({ where: { pipelineId: p.id } });
      for (const [i, s] of f.stages.entries()) {
        let st = existentes.find((e) => e.nome === s.name);
        if (!st) st = await tx.stage.create({ data: { tenantId: TENANT, pipelineId: p.id, nome: s.name, ordem: i, cor: CORES[i % CORES.length] } });
        etapaMap.set(s.id, { pipelineId: p.id, stageId: st.id });
      }
    });
  }

  // 3. Contatos + conversas + mensagens + negócios — uma transação por contato.
  const oppsPorContato = new Map();
  for (const o of oportunidades) oppsPorContato.set(o.contactId, [...(oppsPorContato.get(o.contactId) ?? []), o]);

  let i = 0;
  for (const c of contatos) {
    i++;
    await prisma.withTenant(TENANT, async (tx) => {
      const msgsContato = [...(plano.get(c.id)?.canais.values() ?? [])].flat();
      const ultimaEntrada = msgsContato.filter((m) => m.direction === 'inbound').map((m) => m.dateAdded).sort().at(-1);
      const ultimaMsg = msgsContato.map((m) => m.dateAdded).sort().at(-1);
      const campos = camposDe(c);

      // 3a. contato: já importado (ghl_id) → mantém; mesmo telefone (chegou pela Stevo) → mescla; senão cria.
      let contato = (await tx.$queryRaw`SELECT id, nome, tags, campos_custom AS "camposCustom" FROM contacts WHERE campos_custom->>'ghl_id' = ${c.id} LIMIT 1`)[0];
      if (contato) cont.contatosJaImportados++;
      if (!contato && c.phone) {
        const achado = await acharContatoPorTelefone(tx, c.phone);
        if (achado) {
          const atual = await tx.contact.findUnique({ where: { id: achado } });
          contato = await tx.contact.update({
            where: { id: achado },
            data: {
              // Nome só é trocado se o atual for o próprio número (contato criado pela Stevo).
              ...(/^\+?\d[\d\s()-]*$/.test(atual.nome) ? { nome: nomeDoContato(c) } : {}),
              email: atual.email ?? c.email ?? null,
              tags: [...new Set([...(atual.tags ?? []), ...(c.tags ?? [])])],
              camposCustom: { ...campos, ...(atual.camposCustom ?? {}) },
              createdAt: new Date(c.dateAdded) < atual.createdAt ? new Date(c.dateAdded) : atual.createdAt,
            },
          });
          cont.contatosMesclados++;
        }
      }
      if (!contato) {
        contato = await tx.contact.create({
          data: {
            tenantId: TENANT,
            nome: nomeDoContato(c),
            email: c.email ?? null,
            telefone: c.phone ?? null,
            empresa: c.companyName ?? null,
            tags: c.tags ?? [],
            camposCustom: campos,
            origem: c.attributionSource?.sessionSource ?? c.source ?? null,
            localizacao: [c.city, c.state].filter(Boolean).join(' / ') || null,
            site: c.website ?? null,
            ultimoContatoAt: ultimaMsg ? new Date(ultimaMsg) : null,
            lastInboundAt: ultimaEntrada ? new Date(ultimaEntrada) : null,
            createdAt: new Date(c.dateAdded),
            updatedAt: new Date(c.dateUpdated ?? c.dateAdded),
          },
        });
        cont.contatosCriados++;
      }

      // 3b. conversas por canal + mensagens
      const convGhl = conversasGhl.find((x) => x.contactId === c.id);
      for (const [canal, msgs] of plano.get(c.id)?.canais ?? []) {
        let conv = await tx.conversation.findFirst({ where: { contactId: contato.id, canal } });
        const ultima = msgs.at(-1);
        if (!conv) {
          conv = await tx.conversation.create({
            data: {
              tenantId: TENANT,
              contactId: contato.id,
              nome: contato.nome,
              canal,
              status: 'aberta',
              atendimento: 'humano',
              ultimaPrevia: corpoDe(ultima).slice(0, 140),
              ultimaHora: hora(ultima.dateAdded),
              // Não lidas do GHL ficam no canal da última mensagem da conversa.
              naoLidas: convGhl && canalDe({ messageType: convGhl.lastMessageType }) === canal ? convGhl.unreadCount ?? 0 : 0,
              createdAt: new Date(msgs[0].dateAdded),
              updatedAt: new Date(ultima.dateAdded),
            },
          });
          cont.conversasCriadas++;
        }
        const r = await tx.message.createMany({
          skipDuplicates: true,
          data: msgs.map((m) => {
            const saida = m.direction === 'outbound';
            return {
              tenantId: TENANT,
              conversationId: conv.id,
              autorTipo: saida ? 'humano' : 'contato',
              corpo: corpoDe(m),
              hora: hora(m.dateAdded),
              createdAt: new Date(m.dateAdded),
              idempotencyKey: `ghl:${m.id}`,
              ...(saida ? { deliveryStatus: m.status === 'failed' ? 'failed' : 'delivered', sentAt: new Date(m.dateAdded), ...(m.status === 'failed' ? { deliveryError: 'falhou no GHL' } : {}) } : {}),
            };
          }),
        });
        cont.mensagensInseridas += r.count;
      }

      // 3c. negócios (um por contato + funil)
      for (const o of oppsPorContato.get(c.id) ?? []) {
        const alvo = etapaMap.get(o.pipelineStageId);
        if (!alvo) continue;
        const existe = await tx.deal.findFirst({ where: { contactId: contato.id, pipelineId: alvo.pipelineId }, select: { id: true } });
        if (existe) {
          cont.negociosJaExistiam++;
          continue;
        }
        await tx.deal.create({
          data: {
            tenantId: TENANT,
            titulo: o.name || contato.nome,
            contactId: contato.id,
            pipelineId: alvo.pipelineId,
            stageId: alvo.stageId,
            valor: o.monetaryValue ?? 0,
            origem: o.source ?? null,
            status: STATUS_DEAL[o.status] ?? 'aberto',
            createdAt: new Date(o.createdAt),
            updatedAt: new Date(o.updatedAt ?? o.createdAt),
          },
        });
        cont.negociosCriados++;
      }
      await neutralizarOutbox(tx);
    });
    if (i % 50 === 0) process.stdout.write(`\r  contatos ${i}/${contatos.length}`);
  }
  process.stdout.write('\r');

  // 4. Base de conhecimento: custom values do GHL (preços, políticas, tom da assistente…)
  const itens = valores.filter((v) => String(v.value ?? '').trim());
  const conteudo = `# ${local.name} — base importada do GHL\n\n` + itens.map((v) => `## ${v.name}\n\n${String(v.value).trim()}\n`).join('\n');
  const ingest = app.get(IngestionService);
  const doc = await ingest.register({ tenantId: TENANT, escopo: 'tenant', titulo: `${local.name} — base importada do GHL`, fonte: 'importacao_ghl', content: conteudo });
  // Espera o processamento (fila in-process, neste mesmo processo). Um documento
  // reprocessado começa em `failed` — só `published` ou o prazo encerram a espera.
  let statusDoc = doc.status;
  for (let t = 0; t < 90 && statusDoc !== 'published' && !(doc.deduped && statusDoc === 'failed'); t++) {
    await new Promise((r) => setTimeout(r, 1000));
    statusDoc = (await prisma.withTenant(TENANT, (tx) => tx.ragDocument.findUnique({ where: { id: doc.id }, select: { status: true } })))?.status;
  }
  const chunks = await prisma.withTenant(TENANT, (tx) => tx.$queryRaw`SELECT count(*)::int AS n FROM rag_chunks WHERE document_id=${doc.id}::uuid`);

  // 5. Auditoria
  const final = { ...cont, baseConhecimento: { documento: doc.id, status: statusDoc, chunks: chunks[0]?.n ?? 0, jaExistia: doc.deduped }, mensagensDeContatoExcluidoNoGhl: orfas };
  await prisma.withTenant(TENANT, (tx) =>
    tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
      VALUES (${TENANT}::uuid, 'sistema', 'operador', 'migracao.ghl.importada', 'tenant', ${TENANT}, ${JSON.stringify({ locationId: LOC, ...final })}::jsonb)`,
  );
  console.log(JSON.stringify(final, null, 2));
} catch (e) {
  console.error('ERRO:', e?.message ?? e);
  process.exitCode = 1;
} finally {
  await app.close();
}

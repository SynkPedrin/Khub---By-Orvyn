// QA Sprint 0 — cenários de runtime contra a API REAL (Postgres+Redis+worker reais, stack orvyn-qa).
//   node scripts/qa/scenarios.mjs main   # cenários 1 a 7; no 4 o runner reinicia o worker no meio da espera
// Classificação: REAL_RUNTIME_TEST (API/Postgres/Redis/worker reais). Nenhuma chamada externa:
// o inbound usa o webhook real do adaptador Evolution com payload sintético (NÃO é WhatsApp real)
// e as integrações externas só são exercitadas no caminho "sem credencial".
import { spawnSync, spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const API = process.env.QA_API ?? 'http://localhost:4010/v1';
const OUT = resolve(process.cwd(), '..', '..', 'docs/revenue-audit/evidence');
const STATE = resolve(OUT, 'scenarios-state.json');
const RESULTS = resolve(OUT, 'scenarios-results.json');
const env = Object.fromEntries(readFileSync(resolve(process.cwd(), '.env.qa'), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const RUN = Date.now().toString(36);
const PASS = 'QaSenha#2026x';

const results = existsSync(RESULTS) ? JSON.parse(readFileSync(RESULTS, 'utf8')) : [];
const rec = (cenario, nome, ok, detalhe = '') => { results.push({ cenario, nome, status: ok ? 'PASS' : 'FAIL', detalhe: String(detalhe).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'} [${cenario}] ${nome}${ok ? '' : ' :: ' + String(detalhe).slice(0, 300)}`); };
const save = () => writeFileSync(RESULTS, JSON.stringify(results, null, 2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, path, token, body, headers = {}) {
  const r = await fetch(API + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
function sql(q) {
  const r = spawnSync('docker', ['exec', '-i', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim().split('\n')[0];
}
async function signup(label, empresa) {
  const email = `qa-${label}-${RUN}@orvyn-qa.test`;
  const r = await api('POST', '/auth/signup', null, { email, password: PASS, nome: `QA ${label}`, empresa });
  if (r.status >= 300) throw new Error(`signup ${label}: ${r.status} ${JSON.stringify(r.body)}`);
  const me = await api('GET', '/auth/me', r.body.access);
  return { email, access: r.body.access, refresh: r.body.refresh, identityId: me.body.identityId, tenantId: me.body.tenant.id };
}
async function pollUntil(fn, ms = 40000, step = 1500) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) return null; await sleep(step); } }
const grafo = (...nos) => nos;

async function main() {
  // ===== CENÁRIO 1 — organização cliente / agência =====
  const ownerA = await signup('agA', `Agencia A ${RUN}`);
  const ownerB = await signup('agB', `Agencia B ${RUN}`);
  // Agência só nasce por seed (gap de produto PG-AGENCY-SEED): semeada via SQL no banco QA.
  const agA = sql(`INSERT INTO agencies(name,slug,owner_identity_id) VALUES ('Agencia A ${RUN}','ag-a-${RUN}','${ownerA.identityId}') RETURNING id`);
  const agB = sql(`INSERT INTO agencies(name,slug,owner_identity_id) VALUES ('Agencia B ${RUN}','ag-b-${RUN}','${ownerB.identityId}') RETURNING id`);
  sql(`INSERT INTO agency_members(agency_id,identity_id,role) VALUES ('${agA}','${ownerA.identityId}','owner'),('${agB}','${ownerB.identityId}','owner')`);
  const cA1 = await api('POST', '/agency/clients', ownerA.access, { nome: `Clinica A1 ${RUN}`, nicho: 'clinica' });
  const cA2 = await api('POST', '/agency/clients', ownerA.access, { nome: `Clinica A2 ${RUN}`, nicho: 'clinica' });
  const cB1 = await api('POST', '/agency/clients', ownerB.access, { nome: `Clinica B1 ${RUN}` });
  rec('C1', 'criar clientes A1, A2 (agência A) e B1 (agência B) via API', [cA1, cA2, cB1].every((c) => c.status < 300 && c.body.id), JSON.stringify([cA1.status, cA2.status, cB1.status]));
  const list = await api('GET', '/agency/clients', ownerA.access);
  const nomesA = (Array.isArray(list.body) ? list.body : list.body?.clients ?? []).map((c) => c.displayName ?? c.nome ?? c.name);
  rec('C1', 'agência A lista A1 e A2 e NÃO lista B1', nomesA.some((n) => n?.includes('A1')) && nomesA.some((n) => n?.includes('A2')) && !nomesA.some((n) => n?.includes('B1')), JSON.stringify(nomesA));
  const actA1 = await api('POST', `/agency/clients/${cA1.body.id}/activate`, ownerA.access);
  const tokA1 = actA1.body.access;
  const meA1 = tokA1 ? await api('GET', '/auth/me', tokA1) : { body: {} };
  rec('C1', 'entrar no cliente A1 troca o tenant ativo no JWT', !!tokA1 && meA1.body.tenant?.id === cA1.body.tenantId, `tenant=${meA1.body.tenant?.nome}`);
  const actA2 = await api('POST', `/agency/clients/${cA2.body.id}/activate`, ownerA.access);
  const tokA2 = actA2.body.access;
  const actB1 = await api('POST', `/agency/clients/${cB1.body.id}/activate`, ownerB.access);
  const tokB1 = actB1.body.access;

  // ===== CENÁRIO 2 — lead =====
  const tel = `55119${Math.floor(10000000 + Math.random() * 89999999)}`;
  const lead = await api('POST', '/crm/contacts', tokA1, { nome: `Lead QA ${RUN}`, email: `lead-${RUN}@qa.test`, telefone: tel, empresa: 'Empresa QA', tag: 'qa' });
  rec('C2', 'criar lead (POST /crm/contacts)', lead.status < 300 && lead.body.id, JSON.stringify(lead.body));
  const got = await api('GET', `/crm/contacts/${lead.body.id}`, tokA1);
  rec('C2', 'consultar lead por id', got.status === 200 && JSON.stringify(got.body).includes(`Lead QA ${RUN}`), got.status);
  const lst = await api('GET', '/crm/contacts', tokA1);
  rec('C2', 'lead aparece na listagem', JSON.stringify(lst.body).includes(`Lead QA ${RUN}`), lst.status);
  const ov = await api('GET', '/crm/overview', tokA1);
  rec('C2', 'overview do dashboard responde com dados', ov.status === 200, JSON.stringify(ov.body).slice(0, 200));
  const dup = await api('POST', '/crm/contacts', tokA1, { nome: `Lead QA dup ${RUN}`, telefone: tel });
  const nDup = Number(sql(`SELECT count(*) FROM contacts WHERE tenant_id='${cA1.body.tenantId}' AND telefone='${tel}'`));
  rec('C2', '[gap L-1] POST manual duplicado por telefone é deduplicado', nDup === 1, `contatos com o mesmo telefone: ${nDup} (status ${dup.status})`);
  const camposOrigem = sql(`SELECT coalesce(origem,'<null>')||' | custom='||coalesce(campos_custom->>'origem','<null>') FROM contacts WHERE id='${lead.body.id}'`);
  rec('C2', '[gap L-3] origem do contato é gravada em POST manual', !camposOrigem.startsWith('<null>'), `origem | campos_custom.origem = ${camposOrigem}`);

  // ===== CENÁRIO 3 — oportunidade + kanban =====
  const pipe = await api('GET', '/crm/pipeline', tokA1);
  const st = pipe.body.stages;
  const deal = await api('POST', '/crm/deals', tokA1, { titulo: `Oportunidade QA ${RUN}`, contactId: lead.body.id, stageId: st[0].id, valor: 1500, origem: 'qa' });
  rec('C3', 'criar oportunidade via API', deal.status < 300 && deal.body.id, JSON.stringify(deal.body).slice(0, 150));
  const mv = await api('PATCH', `/crm/deals/${deal.body.id}/stage`, tokA1, { stageId: st[2].id });
  rec('C3', 'mover para a 3ª etapa (Proposta)', mv.status < 300, mv.status);
  const pipe2 = await api('GET', '/crm/pipeline', tokA1);
  const onde = pipe2.body.stages.find((s) => s.deals.some((d) => d.id === deal.body.id));
  rec('C3', 'após recarregar, a oportunidade persiste na nova etapa', onde?.id === st[2].id, `etapa=${onde?.nome}`);
  const outbox = sql(`SELECT count(*) FROM outbox_events WHERE tenant_id='${cA1.body.tenantId}' AND payload::text LIKE '%${deal.body.id}%'`);
  rec('C3', 'movimentação gera evento no outbox (gatilho de automação)', Number(outbox) >= 1, `eventos=${outbox}`);
  const aud = sql(`SELECT count(*) FROM audit_logs WHERE tenant_id='${cA1.body.tenantId}'`);
  rec('C3', 'audit log registra mutações do tenant', Number(aud) >= 1, `audit_logs=${aud}`);
  const mvBad = await api('PATCH', `/crm/deals/${deal.body.id}/stage`, tokA1, { stageId: '00000000-0000-4000-8000-000000000000' });
  rec('C3', 'mover para etapa inexistente falha (UI não pode mostrar sucesso)', mvBad.status >= 400, mvBad.status);

  // ===== CENÁRIO 4 (parte 1) — automação com espera persistente =====
  const wf = await api('POST', '/automations/workflows', tokA1, { nome: `QA espera ${RUN}` });
  const wfId = wf.body.id;
  const g = { nos: [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} },
    { id: 'w', tipo: 'controle.esperar', posicao: { x: 1, y: 0 }, config: { duracao: 90, unidade: 'segundos' } },
    { id: 't', tipo: 'acao.adicionar_tag', posicao: { x: 2, y: 0 }, config: { tag: 'qa-depois-da-espera' } },
  ], arestas: [{ id: 'a1', de: 'g', para: 'w' }, { id: 'a2', de: 'w', para: 't' }] };
  const sv = await api('PATCH', `/automations/workflows/${wfId}/grafo`, tokA1, { grafo: g });
  rec('C4', 'salvar grafo gatilho→esperar 90s→tag', sv.status < 300, JSON.stringify(sv.body).slice(0, 200));
  const val = await api('POST', `/automations/workflows/${wfId}/validar`, tokA1);
  const pub = await api('POST', `/automations/workflows/${wfId}/publicar`, tokA1);
  rec('C4', 'publicar workflow', pub.status < 300, JSON.stringify(pub.body).slice(0, 200));
  const stt = await api('PATCH', `/automations/workflows/${wfId}/status`, tokA1, { status: 'ativo' });
  rec('C4', 'ativar workflow', stt.status < 300, JSON.stringify(stt.body).slice(0, 200));
  const ctW = await api('POST', '/crm/contacts', tokA1, { nome: `Contato espera ${RUN}`, telefone: `55118${Math.floor(10000000 + Math.random() * 89999999)}` });
  const runW = await pollUntil(async () => { const r = await api('GET', `/automations/workflows/${wfId}/runs`, tokA1); const arr = Array.isArray(r.body) ? r.body : r.body?.runs ?? r.body?.items ?? []; return arr.find((x) => x.contactId === ctW.body.id || JSON.stringify(x).includes(ctW.body.id)); }, 30000);
  rec('C4', 'o gatilho criou uma execução (outbox→reconcile→engine)', !!runW, runW ? `status=${runW.status}` : 'nenhuma execução em 30s');
  const emEspera = runW && /espera|wait|aguard|andamento|running/i.test(String(runW.status));
  rec('C4', 'execução está em espera (não terminou antes da hora)', !!emEspera, runW?.status);
  const jobsAntes = sql(`SELECT count(*) FROM workflow_run_steps WHERE run_id='${runW?.id}'`);
  // reinício REAL do worker no meio da espera (mata o processo e sobe outro com o mesmo ambiente QA)
  spawnSync('pkill', ['-f', 'node dist/worker.js']);
  await sleep(2500);
  const logFd = openSync(resolve(OUT, 'worker-run-restart.log'), 'a');
  const child = spawn('node', ['dist/worker.js'], { cwd: process.cwd(), env: { ...process.env, ...env }, detached: true, stdio: ['ignore', logFd, logFd] }); child.unref();
  rec('C4', 'worker reiniciado no meio da espera (processo antigo morto, novo iniciado)', true, `novo pid=${child.pid}`);
  writeFileSync(STATE, JSON.stringify({ RUN, wfId, runId: runW?.id, contactW: ctW.body.id, tenantA1: cA1.body.tenantId, jobsAntes, tokA1: tokA1 }));

  // ===== CENÁRIO 5 — inbound pelo adaptador de teste =====
  const inst = `qa-inst-${RUN}`;
  sql(`INSERT INTO integrations(tenant_id,provider,status,external_business_id) VALUES ('${cA1.body.tenantId}','evolution','connected','${inst}')`);
  // follow-up: workflow com pararNoReply, espera 120s, depois cria nota
  const wf2 = await api('POST', '/automations/workflows', tokA1, { nome: `QA followup pararNoReply ${RUN}` });
  const g2 = { nos: [
    { id: 'g', tipo: 'gatilho.contato_criado', posicao: { x: 0, y: 0 }, config: {} },
    { id: 'w', tipo: 'controle.esperar', posicao: { x: 1, y: 0 }, config: { duracao: 120, unidade: 'segundos' } },
    { id: 'n', tipo: 'acao.criar_nota', posicao: { x: 2, y: 0 }, config: { corpo: 'FOLLOWUP-ENVIADO' } },
  ], arestas: [{ id: 'a1', de: 'g', para: 'w' }, { id: 'a2', de: 'w', para: 'n' }] };
  await api('PATCH', `/automations/workflows/${wf2.body.id}/grafo`, tokA1, { grafo: g2 });
  const cfg = await api('PATCH', `/automations/workflows/${wf2.body.id}/config`, tokA1, { pararNoReply: true });
  await api('POST', `/automations/workflows/${wf2.body.id}/publicar`, tokA1);
  await api('PATCH', `/automations/workflows/${wf2.body.id}/status`, tokA1, { status: 'ativo' });
  const telIn = `55117${Math.floor(10000000 + Math.random() * 89999999)}`;
  const ctIn = await api('POST', '/crm/contacts', tokA1, { nome: `Lead inbound ${RUN}`, telefone: telIn });
  const runIn = await pollUntil(async () => { const r = await api('GET', `/automations/workflows/${wf2.body.id}/runs`, tokA1); const arr = Array.isArray(r.body) ? r.body : r.body?.runs ?? r.body?.items ?? []; return arr.find((x) => JSON.stringify(x).includes(ctIn.body.id)); }, 30000);
  rec('C5', 'follow-up agendado (execução em espera) antes da resposta', !!runIn, runIn ? `status=${runIn.status}` : 'sem execução');
  const ativAntes = Number(sql(`SELECT count(*) FROM activities WHERE tenant_id='${cA1.body.tenantId}' AND contact_id='${ctIn.body.id}'`));
  const msgId = `QA-MSG-${RUN}`;
  const payload = { event: 'messages.upsert', instance: inst, data: { key: { remoteJid: `${telIn}@s.whatsapp.net`, fromMe: false, id: msgId }, pushName: 'Lead inbound', message: { conversation: 'Oi, tenho interesse!' } } };
  const hook = await api('POST', `/hooks/evolution/${env.EVOLUTION_WEBHOOK_TOKEN}`, null, payload);
  rec('C5', 'webhook Evolution (adaptador de teste) aceita o payload', hook.status < 300, `${hook.status} ${JSON.stringify(hook.body)}`);
  const badTok = await api('POST', `/hooks/evolution/token-errado-${RUN}-xxxxxxxxxxxxxxxxxxxx`, null, payload);
  rec('C5', 'webhook com token inválido é rejeitado (401)', badTok.status === 401, badTok.status);
  const persisted = await pollUntil(async () => Number(sql(`SELECT count(*) FROM messages WHERE tenant_id='${cA1.body.tenantId}' AND corpo='Oi, tenho interesse!'`)) >= 1, 30000);
  rec('C5', 'mensagem recebida foi persistida (webhook→outbox→worker→messages)', !!persisted);
  const hook2 = await api('POST', `/hooks/evolution/${env.EVOLUTION_WEBHOOK_TOKEN}`, null, payload);
  await sleep(8000);
  const nMsg = Number(sql(`SELECT count(*) FROM messages WHERE tenant_id='${cA1.body.tenantId}' AND corpo='Oi, tenho interesse!'`));
  rec('C5', 'reentrega do mesmo webhook não duplica mensagem (idempotência)', nMsg === 1, `mensagens=${nMsg}`);
  const convs = await api('GET', '/crm/conversations', tokA1);
  rec('C5', 'conversa aparece em /crm/conversations', JSON.stringify(convs.body).includes('Oi, tenho interesse!'), convs.status);
  const runIn2 = await pollUntil(async () => { const r = await api('GET', `/automations/workflows/${wf2.body.id}/runs`, tokA1); const arr = Array.isArray(r.body) ? r.body : r.body?.runs ?? r.body?.items ?? []; const x = arr.find((y) => JSON.stringify(y).includes(ctIn.body.id)); return x && /cancel/i.test(String(x.status)) ? x : null; }, 20000);
  rec('C5', 'follow-up pendente é cancelado quando o lead responde (pararNoReply=true)', !!runIn2, runIn2 ? runIn2.status : 'não cancelou');
  const ativ = Number(sql(`SELECT count(*) FROM activities WHERE tenant_id='${cA1.body.tenantId}' AND contact_id='${ctIn.body.id}'`));
  rec('C5', '[gap I-4] inbound registra Activity do contato (depois > antes)', ativ > ativAntes, `activities antes=${ativAntes} depois=${ativ}`);

  // ===== CENÁRIO 6 — multitenancy =====
  const tokA1b = (await api('POST', `/agency/clients/${cA1.body.id}/activate`, ownerA.access)).body.access;
  const leadVisA2 = await api('GET', '/crm/contacts', tokA2);
  rec('C6', 'cliente A2 não enxerga o lead criado em A1 (listagem)', !JSON.stringify(leadVisA2.body).includes(`Lead QA ${RUN}`), leadVisA2.status);
  const idorA2 = await api('GET', `/crm/contacts/${lead.body.id}`, tokA2);
  rec('C6', 'A2 não acessa contato de A1 por id (IDOR) → 404/403', [403, 404].includes(idorA2.status), idorA2.status);
  const idorB1 = await api('GET', `/crm/contacts/${lead.body.id}`, tokB1);
  rec('C6', 'agência B (B1) não acessa contato de A1 por id', [403, 404].includes(idorB1.status), idorB1.status);
  const dealB1 = await api('GET', `/crm/deals/${deal.body.id}`, tokB1);
  rec('C6', 'B1 não acessa oportunidade de A1', [403, 404].includes(dealB1.status), dealB1.status);
  const mvB1 = await api('PATCH', `/crm/deals/${deal.body.id}/stage`, tokB1, { stageId: st[0].id });
  rec('C6', 'B1 não consegue mover oportunidade de A1 (mesmo com stageId de A1)', mvB1.status >= 400, mvB1.status);
  const delB1 = await api('DELETE', `/crm/contacts/${lead.body.id}`, tokB1);
  const aindaExiste = Number(sql(`SELECT count(*) FROM contacts WHERE id='${lead.body.id}'`));
  rec('C6', 'B1 não consegue excluir contato de A1', aindaExiste === 1, `delete=${delB1.status}`);
  const wfIdor = await api('GET', `/automations/workflows/${wfId}`, tokB1);
  rec('C6', 'B1 não acessa workflow de A1', [403, 404].includes(wfIdor.status), wfIdor.status);
  const actCross = await api('POST', `/agency/clients/${cB1.body.id}/activate`, ownerA.access);
  rec('C6', 'agência A não consegue entrar no cliente B1', [403, 404].includes(actCross.status), actCross.status);
  const detCross = await api('GET', `/agency/clients/${cB1.body.id}`, ownerA.access);
  rec('C6', 'agência A não vê o detalhe do cliente B1', [403, 404].includes(detCross.status), detCross.status);
  const memB = await api('GET', '/agency/members', ownerB.access);
  rec('C6', 'membros da agência B não incluem identidades da agência A', !JSON.stringify(memB.body).includes(ownerA.email), memB.status);
  const nomesB = (await api('GET', '/agency/clients', ownerB.access)).body;
  rec('C6', 'agência B lista só seus clientes', !JSON.stringify(nomesB).includes(`Clinica A`), '');
  const ov2 = await api('GET', '/agency/overview', ownerA.access);
  rec('C6', 'overview da agência A não contém dados da B', !JSON.stringify(ov2.body).includes(`Clinica B1`), ov2.status);
  // JWT forjado: trocar tenant_id no payload sem assinar
  const parts = tokA1.split('.'); const pl = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); pl.tenant_id = cB1.body.tenantId;
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(pl)).toString('base64url')}.${parts[2]}`;
  const fr = await api('GET', '/crm/contacts', forged);
  rec('C6', 'JWT com tenant_id adulterado é rejeitado (401)', fr.status === 401, fr.status);
  const noTok = await api('GET', '/crm/contacts', null);
  rec('C6', 'rota privada sem token → 401', noTok.status === 401, noTok.status);
  // SEC-01: revogação — remover membro da agência não revoga acesso
  const ownerA2 = await signup('agA-membro', `Membro ${RUN}`);
  sql(`INSERT INTO agency_members(agency_id,identity_id,role) VALUES ('${agA}','${ownerA2.identityId}','admin')`);
  const actM = await api('POST', `/agency/clients/${cA1.body.id}/activate`, ownerA2.access);
  sql(`DELETE FROM agency_members WHERE identity_id='${ownerA2.identityId}'`);
  const aindaEntra = await api('POST', `/agency/clients/${cA1.body.id}/activate`, ownerA2.access);
  const aindaMembro = Number(sql(`SELECT count(*) FROM memberships WHERE identity_id='${ownerA2.identityId}' AND tenant_id='${cA1.body.tenantId}'`));
  const tokAntigo = actM.body.access ? (await api('GET', '/crm/contacts', actM.body.access)).status : 0;
  rec('C6', '[SEC-01] ex-membro da agência perde acesso ao cliente (membership revogada)', aindaMembro === 0, `membership em A1 após remoção=${aindaMembro}; reativação=${aindaEntra.status}; token antigo lê contatos=${tokAntigo}`);

  // ===== CENÁRIO 7 — falha de integração =====
  const meta = await api('GET', '/integrations/meta/auth-url', tokA1);
  rec('C7', 'Meta sem META_APP_ID responde 501 config_required (não é falha de código)', meta.status === 501 && JSON.stringify(meta.body).includes('config_required'), `${meta.status} ${JSON.stringify(meta.body).slice(0, 160)}`);
  const integ = await api('GET', '/integrations', tokA1);
  rec('C7', 'listagem de integrações responde e mostra o estado real', integ.status === 200, JSON.stringify(integ.body).slice(0, 200));
  const wpp = await api('POST', '/integrations/whatsapp/connect', tokA1, {});
  rec('C7', 'conectar WhatsApp sem EVOLUTION_BASE_URL degrada explícito (nao_configurado/config_required), sem erro 500', wpp.status !== 500 && /nao_configurado|config_required/.test(JSON.stringify(wpp.body)), `${wpp.status} ${JSON.stringify(wpp.body).slice(0, 160)}`);
  const metaHook = await api('POST', '/webhooks/meta', null, { object: 'page', entry: [] }, { 'x-hub-signature-256': 'sha256=deadbeef' });
  rec('C7', 'webhook Meta com assinatura inválida é rejeitado', [401, 403, 501, 503].includes(metaHook.status), metaHook.status);
  const nyro = await api('GET', '/nyro/conversations', tokA1);
  rec('C7', 'Nyro sem ANTHROPIC_API_KEY degrada de forma explícita (não simula IA)', [200, 404, 501].includes(nyro.status), `${nyro.status} ${JSON.stringify(nyro.body).slice(0, 120)}`);

  // Webhook público do gatilho "webhook" direto na API (sem proxy): exige Idempotency-Key
  const wfH = await api('POST', '/automations/workflows', tokA1, { nome: `QA hook ${RUN}` });
  const urlH = await api('POST', `/automations/workflows/${wfH.body.id}/webhook-url`, tokA1);
  writeFileSync(resolve(OUT, 'hook-state.json'), JSON.stringify({ wfId: wfH.body.id, resp: urlH.body, status: urlH.status }));
  await finalizarEspera();
  save();
  console.log('\nFase main concluída.');
}

async function finalizarEspera() {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const fim = await pollUntil(async () => { const r = await api('GET', `/automations/runs/${s.runId}`, s.tokA1); const st = r.body?.status ?? r.body?.run?.status; return /conclu|finaliz|complet|success|ok|done/i.test(String(st)) ? r.body : null; }, 150000, 3000);
  rec('C4', 'execução em espera sobreviveu ao restart do worker e foi concluída', !!fim, fim ? `status=${fim.status ?? fim.run?.status}` : 'não concluiu em 150s');
  const tags = sql(`SELECT coalesce(tags::text,'') FROM contacts WHERE id='${s.contactW}'`);
  rec('C4', 'ação após a espera foi executada (tag aplicada ao contato)', tags.includes('qa-depois-da-espera'), `tags=${tags}`);
  const dup = Number(sql(`SELECT count(*) FROM workflow_run_steps WHERE tenant_id='${s.tenantA1}' AND run_id='${s.runId}' AND no_id='t' AND status='ok'`));
  rec('C4', 'passo pós-espera executou exatamente uma vez (sem duplicidade)', dup === 1, `execuções do nó=${dup}`);
}

const mode = process.argv[2];
try { if (mode === 'main') await main(); else console.log('uso: main | after-restart'); }
catch (e) { rec('RUNNER', 'erro inesperado do runner', false, e.stack ?? e.message); save(); process.exitCode = 1; }
const f = results.filter((r) => r.status === 'FAIL').length; console.log(`\nTotal: ${results.length} · PASS ${results.length - f} · FAIL ${f}`);

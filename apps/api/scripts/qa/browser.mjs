// QA Sprint 0 — smoke e evidência no NAVEGADOR REAL (Chrome headless) contra o front de QA (:3220) + API de QA (:4010).
//   PW=/caminho/para/node_modules/playwright-core node scripts/qa/browser.mjs
// Pré-requisito: scenarios.mjs main já rodou (cria agências A/B, clientes e dados).
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? 'playwright-core');

const WEB = process.env.QA_WEB ?? 'http://localhost:3220';
const API = process.env.QA_API ?? 'http://localhost:4010/v1';
const OUT = resolve(process.cwd(), '..', '..', 'docs/revenue-audit/evidence');
const SHOTS = resolve(OUT, 'screenshots');
const state = JSON.parse(readFileSync(resolve(OUT, 'scenarios-state.json'), 'utf8'));
const RUN = state.RUN; const PASS = 'QaSenha#2026x';
const report = { run: RUN, pages: [], ctas: [], responsive: [], checks: [] };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const chk = (nome, ok, detalhe = '') => { report.checks.push({ nome, status: ok ? 'PASS' : 'FAIL', detalhe: String(detalhe).slice(0, 300) }); console.log(`${ok ? 'PASS' : 'FAIL'} ${nome}${ok ? '' : ' :: ' + String(detalhe).slice(0, 300)}`); };
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function novoContexto(w, h) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const ev = { console: [], pageerrors: [], failed: [] };
  page.on('console', (m) => { if (m.type() === 'error') ev.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => ev.pageerrors.push(String(e.message).slice(0, 240)));
  page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && !u.includes('_next/static') && !u.includes('favicon')) ev.failed.push(`${r.status()} ${r.request().method()} ${u.replace(WEB, '')}`.slice(0, 200)); });
  page.on('requestfailed', (r) => { const f = r.failure()?.errorText ?? ''; if (!/ABORTED/i.test(f)) ev.failed.push(`FAILED ${r.method()} ${r.url().replace(WEB, '')} ${f}`.slice(0, 200)); });
  return { ctx, page, ev };
}
async function login(page, email) {
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASS);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {}), page.click('button[type=submit]')]);
  await page.waitForLoadState('networkidle').catch(() => {});
}
async function visitar(page, ev, rota, vp, extra = {}) {
  ev.console.length = 0; ev.pageerrors.length = 0; ev.failed.length = 0;
  const t0 = Date.now(); let status = 0;
  try { const r = await page.goto(WEB + rota, { waitUntil: 'networkidle', timeout: 25000 }); status = r?.status() ?? 0; } catch (e) { status = -1; }
  await sleep(500);
  let diag = null;
  if (status === 503) { const acc = (await page.context().cookies()).find((c) => /access/i.test(c.name))?.value; const m = acc ? await fetch(`${API}/auth/me`, { headers: { authorization: 'Bearer ' + acc } }).catch(() => null) : null; diag = { texto: (await page.evaluate(() => document.body.innerText).catch(() => '')).slice(0, 100), meDireto: m?.status ?? 'sem-token', meCorpo: m ? (await m.text()).slice(0, 160) : '' }; }
  const info = await page.evaluate(() => {
    const t = document.body.innerText || '';
    return { url: location.pathname + location.search, h1: document.querySelector('h1')?.innerText?.slice(0, 80) ?? '', textLen: t.length, buttons: document.querySelectorAll('button').length,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      sinais: ['em breve', 'demo', 'lorem', 'não encontrado', 'nao encontrado', 'IA não configurada', 'Nenhum', 'Sem '].filter((k) => t.toLowerCase().includes(k.toLowerCase())) };
  }).catch(() => ({}));
  const file = `${vp}/${extra.prefix ?? ''}${slug(rota)}.png`; mkdirSync(resolve(SHOTS, vp), { recursive: true });
  await page.screenshot({ path: resolve(SHOTS, file), fullPage: false }).catch(() => {});
  const row = { rota, vp, status, ms: Date.now() - t0, ...info, consoleErrors: [...ev.console], pageErrors: [...ev.pageerrors], failedRequests: [...ev.failed], shot: `screenshots/${file}`, ...(diag ? { diag } : {}), ...extra };
  (vp === '1440' ? report.pages : report.responsive).push(row);
  return row;
}

// ---------------- desktop 1440 ----------------
const D = await novoContexto(1440, 900);
const { page, ev } = D;
await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await page.screenshot({ path: resolve((mkdirSync(resolve(SHOTS, '1440'), { recursive: true }), SHOTS), '1440/login.png') });
await login(page, `qa-agA-${RUN}@orvyn-qa.test`);
chk('login pela UI redireciona para fora de /login', !new URL(page.url()).pathname.startsWith('/login'), page.url());
report.landing = new URL(page.url()).pathname;

for (const rota of ['/agency', '/agency/clients', '/agency/equipe', '/agency/configuracoes']) await visitar(page, ev, rota, '1440');

// entrar no cliente A1 pela UI
await page.goto(`${WEB}/agency/clients`, { waitUntil: 'networkidle' });
const textoCliente = `Clinica A1 ${RUN}`;
const cardsTxt = await page.evaluate(() => document.body.innerText.slice(0, 600));
const entrou = await (async () => {
  const card = page.locator(`text=${textoCliente}`).first();
  if (!(await card.count())) return 'cliente-nao-listado';
  await card.click({ trial: false }).catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  const btn = page.getByRole('button', { name: /entrar|acessar|abrir|operar/i }).first();
  if (await btn.count()) { await Promise.all([page.waitForLoadState('networkidle').catch(() => {}), btn.click().catch(() => {})]); }
  await sleep(1500); return page.url();
})();
report.entrarCliente = { resultado: entrou, textoInicial: cardsTxt.slice(0, 200) };
const me = await page.evaluate(async () => (await fetch('/api/auth/me')).json()).catch(() => ({}));
chk('entrar no cliente A1 pela UI muda o tenant ativo da sessão', me?.tenant?.nome === textoCliente, `tenant=${me?.tenant?.nome} url=${page.url()}`);

// se a UI não permitiu, ativa via API pelo cookie de sessão para seguir com o resto da auditoria
if (me?.tenant?.nome !== textoCliente) {
  const list = await page.evaluate(async () => (await fetch('/api/v1/agency/clients')).json()).catch(() => null);
  const arr = Array.isArray(list) ? list : list?.clients ?? [];
  const alvo = arr.find((c) => (c.displayName ?? c.nome) === textoCliente);
  if (alvo) { await page.evaluate(async (id) => { await fetch(`/api/agency/clients/${id}/activate`, { method: 'POST' }); }, alvo.id); }
}

const ROTAS = ['/dashboard', '/leads', '/pipeline', '/conversas', '/inbox', '/contatos', '/automacoes', '/campanhas', '/agenda', '/analytics', '/ia', '/nyro', '/configuracoes', '/marketing', '/marketing/ads', '/empresas', '/tarefas', '/financeiro', '/conhecimento', '/onboarding'];
for (const rota of ROTAS) { const r = await visitar(page, ev, rota, '1440'); console.log(`  ${r.status} ${rota} h1="${r.h1}" err=${r.consoleErrors.length + r.pageErrors.length} req=${r.failedRequests.length} sinais=${(r.sinais ?? []).join('|')}`); }

// detalhe de lead/automação reais
const leadsApi = await page.evaluate(async () => (await fetch('/api/crm/contacts')).json()).catch(() => null);
const primeiro = (leadsApi?.items ?? leadsApi?.contacts ?? leadsApi ?? [])[0];
if (primeiro?.id) { await visitar(page, ev, `/leads/${primeiro.id}`, '1440', { nota: 'detalhe de lead real' }); await visitar(page, ev, `/contatos/${primeiro.id}`, '1440', { nota: 'detalhe de contato real' }); }

// ---------------- CTAs: clicar e ver se algo acontece ----------------
async function testarCTA(rota, rotulo) {
  await page.goto(WEB + rota, { waitUntil: 'networkidle' }).catch(() => {});
  const el = page.getByRole('button', { name: new RegExp(rotulo, 'i') }).first();
  if (!(await el.count())) { report.ctas.push({ rota, rotulo, resultado: 'NAO_ENCONTRADO' }); return; }
  let reqs = 0; const onReq = (r) => { if (!r.url().includes('_next') && r.resourceType() !== 'image') reqs++; }; page.on('request', onReq);
  const antes = await page.evaluate(() => ({ url: location.href, dialogs: document.querySelectorAll('[role=dialog],dialog,[aria-modal=true]').length, html: document.body.innerHTML.length }));
  await el.click({ timeout: 4000 }).catch(() => {}); await sleep(1200);
  const depois = await page.evaluate(() => ({ url: location.href, dialogs: document.querySelectorAll('[role=dialog],dialog,[aria-modal=true]').length, html: document.body.innerHTML.length }));
  page.off('request', onReq);
  const mudou = antes.url !== depois.url || depois.dialogs > antes.dialogs || Math.abs(depois.html - antes.html) > 80 || reqs > 0;
  report.ctas.push({ rota, rotulo, resultado: mudou ? 'RESPONDE' : 'SEM_EFEITO', detalhe: `url:${antes.url === depois.url ? '=' : '→' + depois.url} dialogs:${antes.dialogs}→${depois.dialogs} reqs:${reqs}` });
}
for (const [rota, rotulo] of [['/leads', 'Novo Lead'], ['/pipeline', 'Nova oportunidade'], ['/campanhas', 'Nova campanha'], ['/agenda', 'Nova reunião'], ['/agenda', 'Novo'], ['/automacoes', 'Nova automação'], ['/contatos', 'Novo'], ['/configuracoes', 'Conectar WhatsApp'], ['/dashboard', 'Novo'], ['/conversas', 'Nova']]) await testarCTA(rota, rotulo);
console.log('CTAs:', report.ctas.map((c) => `${c.rotulo}@${c.rota}=${c.resultado}`).join(' | '));

// ---------------- Kanban: drag and drop real ----------------
await page.goto(`${WEB}/pipeline`, { waitUntil: 'networkidle' }); await sleep(800);
const cardSel = page.locator(`text=Oportunidade QA ${RUN}`).first();
const temCard = await cardSel.count();
const dbg = temCard ? '' : await page.evaluate(async () => ({ api: JSON.stringify((await (await fetch('/api/crm/pipeline')).json()).stages.map((s) => [s.nome, s.deals.length])), tela: document.body.innerText.slice(0, 300).replace(/\n+/g, ' | ') }));
  chk('pipeline real mostra a oportunidade criada via API', temCard > 0, temCard ? `cards=${temCard}` : JSON.stringify(dbg));
if (temCard) {
  const colunas = await page.evaluate(() => [...document.querySelectorAll('[data-stage-id],[data-testid*=stage],section,[class*=column]')].slice(0, 12).map((e) => (e.innerText || '').slice(0, 30).replace(/\n/g, ' ')));
  report.kanbanColunas = colunas;
  const antesStage = await page.evaluate(async (run) => { const p = await (await fetch('/api/crm/pipeline')).json(); const s = p.stages.find((x) => x.deals.some((d) => (d.titulo ?? d.title ?? '').includes(run))); return s?.nome; }, RUN);
  const alvoNome = /Negocia/.test(antesStage ?? '') ? 'Proposta' : 'Negociação';
  const alvoCol = page.getByText(new RegExp(alvoNome)).first();
  let dnd = 'nao-tentado';
  try { await cardSel.dragTo(alvoCol, { timeout: 6000 }); dnd = 'executado'; } catch (e) { dnd = 'erro: ' + e.message.slice(0, 120); }
  await sleep(1500); await page.reload({ waitUntil: 'networkidle' }); await sleep(800);
  const depoisStage = await page.evaluate(async (run) => { const p = await (await fetch('/api/crm/pipeline')).json(); const s = p.stages.find((x) => x.deals.some((d) => (d.titulo ?? d.title ?? '').includes(run))); return s?.nome; }, RUN);
  chk('drag-and-drop pela UI move a oportunidade e persiste após reload', antesStage !== depoisStage && new RegExp(alvoNome.slice(0, 6)).test(depoisStage ?? ''), `antes=${antesStage} depois=${depoisStage} dnd=${dnd}`);
  await page.screenshot({ path: resolve(SHOTS, '1440/pipeline_depois_dnd.png') });
}

// ---------------- Inbox: mensagem persistida + tempo real ----------------
await page.goto(`${WEB}/inbox`, { waitUntil: 'networkidle' }); await sleep(1000);
const vis = await page.locator('text=Oi, tenho interesse!').count() + await page.locator('text=Lead inbound').count();
chk('inbox mostra a conversa recebida via adaptador de teste', vis > 0, `ocorrências=${vis}`);
const conv = page.locator('text=Lead inbound').first(); if (await conv.count()) { await conv.click().catch(() => {}); await sleep(800); }
const envInst = readFileSync(resolve(process.cwd(), '.env.qa'), 'utf8'); const whTok = envInst.match(/EVOLUTION_WEBHOOK_TOKEN=(.*)/)[1];
const inst = (await (async () => { const { spawnSync } = await import('node:child_process'); return spawnSync('docker', ['exec', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-At', '-c', `select external_business_id from integrations where provider='evolution' and tenant_id='${state.tenantA1}' order by created_at desc limit 1`], { encoding: 'utf8' }).stdout.trim(); })());
const novoTxt = `Mensagem tempo-real ${RUN}`;
const telIn = (await (async () => { const { spawnSync } = await import('node:child_process'); return spawnSync('docker', ['exec', 'orvyn-qa-pg', 'psql', '-U', 'postgres', '-d', 'orvyn_qa', '-At', '-c', `select telefone from contacts where tenant_id='${state.tenantA1}' and nome='Lead inbound ${RUN}'`], { encoding: 'utf8' }).stdout.trim(); })());
await fetch(`${API}/hooks/evolution/${whTok}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event: 'messages.upsert', instance: inst, data: { key: { remoteJid: `${telIn}@s.whatsapp.net`, fromMe: false, id: `RT-${RUN}` }, pushName: 'Lead inbound', message: { conversation: novoTxt } } }) });
await sleep(14000);
const apareceuSemReload = await page.locator(`text=${novoTxt}`).count();
await page.screenshot({ path: resolve(SHOTS, '1440/inbox_tempo_real.png') });
chk('[I-1] mensagem nova aparece no inbox SEM recarregar (tempo real)', apareceuSemReload > 0, `aparece sem reload=${apareceuSemReload}`);
await page.reload({ waitUntil: 'networkidle' }); await sleep(800);
await (await page.locator('text=Lead inbound').first().click().catch(() => {}));
await sleep(800);
chk('mensagem nova aparece no inbox após reload (persistência)', (await page.locator(`text=${novoTxt}`).count()) > 0);

// ---------------- troca de cliente pela UI (A1 → A2) ----------------
const topbar = await page.evaluate(() => (document.querySelector('header')?.innerText ?? '').slice(0, 300));
report.topbarTexto = topbar;
const sw = page.getByRole('button', { name: new RegExp(`Clinica A1|Trocar|Cliente`, 'i') }).first();
let trocouUI = 'sem-switcher';
if (await sw.count()) { await sw.click().catch(() => {}); await sleep(800); const opt = page.locator(`text=Clinica A2 ${RUN}`).first(); if (await opt.count()) { await opt.click().catch(() => {}); await sleep(2500); trocouUI = 'clicado'; } else trocouUI = 'switcher-sem-A2'; }
let meB = {}; const tTroca = Date.now();
for (let k = 0; k < 20; k++) { meB = await page.evaluate(async () => (await fetch('/api/auth/me')).json()).catch(() => ({})); if (meB?.tenant?.nome === `Clinica A2 ${RUN}`) break; await sleep(500); }
report.trocaClienteMs = Date.now() - tTroca;
chk('[UI] trocar de cliente A1→A2 sem logout pelo switcher', meB?.tenant?.nome === `Clinica A2 ${RUN}`, `resultado=${trocouUI} tenant=${meB?.tenant?.nome}`);
if (meB?.tenant?.nome === `Clinica A2 ${RUN}`) { await visitar(page, ev, '/leads', '1440', { nota: 'após trocar para A2' }); const vaza = await page.locator(`text=Lead QA ${RUN}`).count(); chk('[UI] após trocar para A2 a tela de leads não mostra leads de A1', vaza === 0, `ocorrências do lead de A1=${vaza}`); }
await D.ctx.close();

// ---------------- jornada de usuário novo (cenário 8) ----------------
const N = await novoContexto(1440, 900);
const t0 = Date.now(); const jornada = [];
const np = N.page;
await np.goto(`${WEB}/signup`, { waitUntil: 'networkidle' });
await np.screenshot({ path: resolve(SHOTS, '1440/signup.png') });
const campos = await np.evaluate(() => [...document.querySelectorAll('input')].map((i) => `${i.type}:${i.name || i.placeholder}`));
jornada.push({ passo: 'abrir /signup', campos });
try {
  const inputs = np.locator('input'); const n = await inputs.count();
  for (let i = 0; i < n; i++) { const t = await inputs.nth(i).getAttribute('type'); const ph = ((await inputs.nth(i).getAttribute('placeholder')) ?? '') + ((await inputs.nth(i).getAttribute('name')) ?? ''); if (t === 'checkbox') await inputs.nth(i).check(); else if (t === 'email') await inputs.nth(i).fill(`novo-${RUN}-${Date.now().toString(36)}@orvyn-qa.test`); else if (t === 'password') await inputs.nth(i).fill(PASS); else if (/empresa|company/i.test(ph)) await inputs.nth(i).fill('Empresa Nova QA'); else await inputs.nth(i).fill('Usuário Novo QA'); }
  await Promise.all([np.waitForURL((u) => !u.pathname.startsWith('/signup'), { timeout: 20000 }).catch(() => {}), np.click('button[type=submit]')]);
  await np.waitForLoadState('networkidle').catch(() => {});
  jornada.push({ passo: 'cadastro concluído', url: new URL(np.url()).pathname });
} catch (e) { jornada.push({ passo: 'cadastro falhou', erro: e.message.slice(0, 150) }); }
await np.screenshot({ path: resolve(SHOTS, '1440/novo_usuario_pos_signup.png') });
const alvos = ['/dashboard', '/leads', '/pipeline', '/conversas', '/inbox', '/automacoes', '/configuracoes', '/onboarding'];
for (const rota of alvos) { const r = await visitar(np, N.ev, rota, '1440', { nota: 'usuário novo', prefix: 'novo_' }); jornada.push({ passo: `visitar ${rota}`, h1: r.h1, sinais: r.sinais, erros: r.consoleErrors.length + r.pageErrors.length }); }
// tenta criar um lead pela UI
await np.goto(`${WEB}/leads`, { waitUntil: 'networkidle' });
const novoLeadBtn = np.getByRole('button', { name: /novo lead|adicionar|criar/i }).first();
jornada.push({ passo: 'botão de criar lead na UI', existe: (await novoLeadBtn.count()) > 0 });
await np.goto(`${WEB}/contatos`, { waitUntil: 'networkidle' });
const novoCont = np.getByRole('button', { name: /novo|adicionar|criar/i }).first();
let criouPelaUI = false;
if (await novoCont.count()) { await novoCont.click().catch(() => {}); await sleep(800); const nome = np.locator('input').first(); if (await nome.count()) { await nome.fill(`Lead UI ${RUN}`).catch(() => {}); const salvar = np.getByRole('button', { name: /salvar|criar|adicionar/i }).last(); await salvar.click().catch(() => {}); await sleep(1500); criouPelaUI = (await np.locator(`text=Lead UI ${RUN}`).count()) > 0; } }
jornada.push({ passo: 'criar contato pela UI em /contatos', sucesso: criouPelaUI });
report.jornadaNovoUsuario = { segundos: Math.round((Date.now() - t0) / 1000), passos: jornada };
chk('[C8] usuário novo consegue criar um contato pela UI', criouPelaUI, JSON.stringify(jornada.at(-1)));
await N.ctx.close();

// ---------------- responsivo: 768 e 390 ----------------
for (const [w, h, vp] of [[768, 1024, '768'], [390, 844, '390']]) {
  const R = await novoContexto(w, h);
  await R.page.goto(`${WEB}/login`, { waitUntil: 'networkidle' }); await R.page.screenshot({ path: resolve((mkdirSync(resolve(SHOTS, vp), { recursive: true }), SHOTS), `${vp}/login.png`) });
  await login(R.page, `qa-agA-${RUN}@orvyn-qa.test`);
  for (const rota of ['/agency', '/agency/clients']) await visitar(R.page, R.ev, rota, vp);
  const list = await R.page.evaluate(async () => (await fetch('/api/v1/agency/clients')).json()).catch(() => null);
  const arr = Array.isArray(list) ? list : list?.clients ?? []; const a1 = arr.find((c) => (c.displayName ?? c.nome) === textoCliente);
  if (a1) await R.page.evaluate(async (id) => { await fetch(`/api/agency/clients/${id}/activate`, { method: 'POST' }); }, a1.id);
  for (const rota of ['/dashboard', '/leads', '/pipeline', '/inbox', '/automacoes', '/configuracoes']) await visitar(R.page, R.ev, rota, vp);
  await R.ctx.close();
}
for (const [w, h, vp] of [[1280, 800, '1280'], [1024, 768, '1024']]) {
  const R = await novoContexto(w, h); await login(R.page, `qa-agA-${RUN}@orvyn-qa.test`);
  const list = await R.page.evaluate(async () => (await fetch('/api/v1/agency/clients')).json()).catch(() => null);
  const arr = Array.isArray(list) ? list : list?.clients ?? []; const a1 = arr.find((c) => (c.displayName ?? c.nome) === textoCliente);
  if (a1) await R.page.evaluate(async (id) => { await fetch(`/api/agency/clients/${id}/activate`, { method: 'POST' }); }, a1.id);
  for (const rota of ['/dashboard', '/pipeline']) await visitar(R.page, R.ev, rota, vp);
  await R.ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, 'browser-report.json'), JSON.stringify(report, null, 2));
const f = report.checks.filter((c) => c.status === 'FAIL').length;
console.log(`\nChecks de navegador: ${report.checks.length} · PASS ${report.checks.length - f} · FAIL ${f} · páginas 1440: ${report.pages.length} · responsivo: ${report.responsive.length}`);

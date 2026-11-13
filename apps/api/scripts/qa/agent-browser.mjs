// Revisão no NAVEGADOR REAL das telas de agentes contra o stack QA.
//   PW=/caminho/node_modules/playwright-core QA_EMAIL=<conta com dados do E2E> \
//   QA_WEB=http://localhost:3240 OUT=/tmp/shots node scripts/qa/agent-browser.mjs
// Para cada tela (desktop 1440 e celular 390): erro de console, exceção de
// página, requisição falha (>=400), rolagem horizontal e travessão visível.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW ?? 'playwright-core');

const WEB = process.env.QA_WEB ?? 'http://localhost:3240';
const EMAIL = process.env.QA_EMAIL;
const PASS = process.env.QA_PASS ?? 'QaSenha#2026x';
const OUT = process.env.OUT ?? resolve(process.cwd(), 'agent-shots');
const AGENTE = process.env.QA_AGENTE;
mkdirSync(OUT, { recursive: true });
if (!EMAIL || !AGENTE) throw new Error('defina QA_EMAIL e QA_AGENTE');

const abas = ['visao', 'identidade', 'personalidade', 'comportamento', 'inteligencia', 'comunicacao', 'conhecimento', 'memoria', 'ferramentas', 'followup', 'automacoes', 'permissoes', 'simulador', 'aprendizado', 'versoes', 'analytics', 'logs'];
const rotas = ['/agentes', '/agentes/novo', ...abas.map((a) => `/agentes/${AGENTE}?aba=${a}`)];
const resultados = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
for (const [w, h, nome] of [[1440, 900, 'desktop'], [390, 844, 'celular']]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR' });
  const page = await ctx.newPage();
  const ev = { console: [], erros: [], falhas: [] };
  page.on('console', (m) => { if (m.type() === 'error') ev.console.push(m.text().slice(0, 240)); });
  page.on('pageerror', (e) => ev.erros.push(String(e.message).slice(0, 240)));
  page.on('response', (r) => { const u = r.url(); if (r.status() >= 400 && !u.includes('_next') && !u.includes('favicon')) ev.falhas.push(`${r.status()} ${r.request().method()} ${u.replace(WEB, '')}`.slice(0, 200)); });
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', EMAIL);
  await page.fill('input[type=password]', PASS);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), page.click('button[type=submit]')]);
  for (const rota of rotas) {
    ev.console.length = 0; ev.erros.length = 0; ev.falhas.length = 0;
    await page.goto(`${WEB}${rota}`, { waitUntil: 'networkidle', timeout: 90000 }).catch(() => undefined);
    await page.waitForTimeout(1200);
    const info = await page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      travessao: (document.querySelector('main')?.innerText ?? document.body.innerText).includes('—'),
      titulo: document.querySelector('h1')?.textContent?.trim() ?? '',
      erroVisivel: !!Array.from(document.querySelectorAll('.t-section')).find((n) => n.textContent?.includes('Não foi possível carregar')),
    }));
    const arquivo = `${nome}_${rota.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}.png`;
    await page.screenshot({ path: resolve(OUT, arquivo), fullPage: true });
    const ok = !ev.erros.length && !ev.falhas.length && !info.overflowX && !info.travessao && !info.erroVisivel;
    resultados.push({ viewport: nome, rota, ok, ...info, console: [...ev.console], erros: [...ev.erros], falhas: [...ev.falhas], arquivo });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${nome} ${rota}${ok ? '' : ` :: ${JSON.stringify({ ...info, erros: ev.erros, falhas: ev.falhas, console: ev.console.slice(0, 2) })}`}`);
  }
  await ctx.close();
}
await browser.close();
writeFileSync(resolve(OUT, 'resultado.json'), JSON.stringify(resultados, null, 2));
const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas}/${resultados.length} telas sem erro · capturas em ${OUT}`);
process.exit(falhas ? 1 : 0);

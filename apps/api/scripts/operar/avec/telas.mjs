import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { chromium } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = process.env.AVEC_SESSAO_DIR ?? `${(await import('node:os')).homedir()}/.khub/avec-sessao/`;
const DEST = `${homedir()}/Downloads/avec-export/2026-11-14/telas`;
mkdirSync(DEST, { recursive: true });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ storageState: `${DIR}sessao.json`, locale: 'pt-BR', viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
for (const [nome, url] of [['profissionais', 'https://admin.avec.beauty/admin/profissional'], ['grupos-acesso', 'https://admin.avec.beauty/admin/personalizar/grupoAcessos'], ['regras-comissao', 'https://admin.avec.beauty/admin/personalizar/comissoes'], ['servicos', 'https://admin.avec.beauty/admin/servicos']]) {
  const jsons = [];
  const ouvir = async (r) => { if (['xhr', 'fetch'].includes(r.request().resourceType()) && /avec\.beauty/.test(r.url())) { const t = await r.text().catch(() => ''); if (/^\s*[\[{]/.test(t)) jsons.push({ url: r.url(), corpo: t }); } };
  p.on('response', ouvir);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForTimeout(6000);
  p.off('response', ouvir);
  await p.screenshot({ path: `${DIR}shots/tela-${nome}.png`, fullPage: true });
  const tabelas = await p.$$eval('table', (ts) => ts.map((t) => [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))).filter((t) => t.length > 1));
  writeFileSync(`${DEST}/${nome}.json`, JSON.stringify({ url, tabelas, respostas: jsons.map((j) => ({ url: j.url.split('?')[0], corpo: j.corpo.length > 2_000_000 ? j.corpo.slice(0, 2_000_000) : j.corpo })) }, null, 1));
  console.log(`${nome}: ${tabelas.map((t) => t.length - 1).join('+') || 0} linhas em tabela; ${jsons.length} respostas JSON (${jsons.map((j) => j.url.split('?')[0].split('/').slice(-2).join('/') + ':' + j.corpo.length).join(', ').slice(0, 300)})`);
}
await b.close();

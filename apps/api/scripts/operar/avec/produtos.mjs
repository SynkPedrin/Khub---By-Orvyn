// Lista de produtos do Avec (SÓ LEITURA): abre a tela de produtos com a sessão salva por entrar.mjs
// e guarda tabelas + respostas JSON da página em ~/Downloads/avec-export/<hoje>/telas/produtos.json.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { chromium } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = process.env.AVEC_SESSAO_DIR ?? `${homedir()}/.khub/avec-sessao/`;
const hoje = new Date().toISOString().slice(0, 10);
const DEST = `${homedir()}/Downloads/avec-export/${hoje}/telas`;
mkdirSync(DEST, { recursive: true, mode: 0o700 });
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ storageState: `${DIR}sessao.json`, locale: 'pt-BR', viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const urls = (process.argv[2] ?? 'https://admin.avec.beauty/admin/produtos,https://admin.avec.beauty/admin/estoque').split(',');
for (const url of urls) {
  const jsons = [];
  const ouvir = async (r) => { if (['xhr', 'fetch'].includes(r.request().resourceType()) && /avec\.beauty/.test(r.url())) { const t = await r.text().catch(() => ''); if (/^\s*[\[{]/.test(t)) jsons.push({ url: r.url(), corpo: t }); } };
  p.on('response', ouvir);
  const resp = await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch((e) => ({ status: () => `erro ${e.message.slice(0, 60)}` }));
  await p.waitForTimeout(7000);
  p.off('response', ouvir);
  const nome = url.split('/').filter(Boolean).pop();
  await p.screenshot({ path: `${DIR}shots/tela-${nome}.png`, fullPage: true }).catch(() => {});
  const tabelas = await p.$$eval('table', (ts) => ts.map((t) => [...t.querySelectorAll('tr')].map((tr) => [...tr.querySelectorAll('th,td')].map((c) => c.innerText.replace(/\s+/g, ' ').trim()))).filter((t) => t.length > 1));
  const links = await p.$$eval('a', (as) => as.map((a) => [a.innerText.trim(), a.getAttribute('href')]).filter(([t, h]) => h && /produt|estoq/i.test(`${t} ${h}`)).slice(0, 30));
  writeFileSync(`${DEST}/${nome}.json`, JSON.stringify({ url, final: p.url(), tabelas, links, respostas: jsons.map((j) => ({ url: j.url.split('?')[0], corpo: j.corpo.slice(0, 3_000_000) })) }, null, 1), { mode: 0o600 });
  console.log(`${nome}: http ${typeof resp?.status === 'function' ? resp.status() : '?'} → ${p.url()} · tabelas ${tabelas.map((t) => t.length - 1).join('+') || 0} · JSON ${jsons.length} (${jsons.map((j) => j.url.split('?')[0].split('/').slice(-2).join('/') + ':' + j.corpo.length).join(', ').slice(0, 300)}) · links ${JSON.stringify(links).slice(0, 300)}`);
}
await b.close();

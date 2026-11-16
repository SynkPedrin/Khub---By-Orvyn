import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { chromium } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = new URL('.', import.meta.url).pathname;
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ storageState: `${DIR}sessao.json`, locale: 'pt-BR' });
const p = await ctx.newPage();
let pedido = null;
p.on('request', (r) => { if (r.url().includes('servicos/lista')) pedido = { url: r.url(), metodo: r.method(), corpo: r.postData() }; });
await p.goto('https://admin.avec.beauty/admin/servicos', { waitUntil: 'domcontentloaded', timeout: 90000 });
await p.waitForTimeout(6000);
console.log('url logada:', p.url());
console.log('pedido:', pedido?.metodo, (pedido?.url ?? '').slice(0, 160), (pedido?.corpo ?? '').slice(0, 300));
// repete o pedido pedindo tudo (DataTables: length)
if (pedido) {
  const ajusta = (s) => s.replace(/(^|&)length=\d+/, '$1length=2000').replace(/(^|&)start=\d+/, '$1start=0');
  const r = pedido.metodo === 'POST'
    ? await p.request.post(pedido.url, { data: ajusta(pedido.corpo ?? ''), headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', 'x-requested-with': 'XMLHttpRequest' } })
    : await p.request.get(pedido.url.includes('length=') ? pedido.url.replace(/length=\d+/, 'length=2000').replace(/start=\d+/, 'start=0') : pedido.url + '&length=2000&start=0', { headers: { 'x-requested-with': 'XMLHttpRequest' } });
  const j = await r.json().catch(() => null);
  console.log('status', r.status(), 'total', j?.recordsTotal, 'linhas', j?.data?.length);
  if (j?.data) {
    const limpa = (h) => String(h ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const servicos = j.data.map((l) => ({ nome: limpa(l[1]).replace(/\s*Agendamento Online\s*$/, '').trim(), categoria: limpa(l[2]), duracao: Number(limpa(l[4])) || null, custo: limpa(l[5]), valor: limpa(l[6]) }));
    writeFileSync(`${homedir()}/Downloads/avec-export/2026-11-14/servicos-completo.json`, JSON.stringify(servicos, null, 1));
    console.log(servicos.slice(0, 3), 'com duração:', servicos.filter((s) => s.duracao).length);
  }
}
await b.close();

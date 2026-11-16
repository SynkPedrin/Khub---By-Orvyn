// Lista os filtros (inputs/selects com opções) de um relatório. uso: node filtros.mjs CODIGO
import { createRequire } from 'node:module';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { chromium } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = process.env.AVEC_SESSAO_DIR ?? `${(await import('node:os')).homedir()}/.khub/avec-sessao/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ storageState: `${DIR}sessao.json`, locale: 'pt-BR' });
const page = await ctx.newPage();
for (const codigo of process.argv.slice(2)) {
  await page.goto(`https://admin.avec.beauty/admin/relatorio/${codigo}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  const f = await page.$$eval('.inputVarRel, select.inputVarRel, input.inputPrint, select', (els) => els.filter((e) => e.name).map((e) => e.tagName === 'SELECT' ? `${e.name}=[${[...e.options].map((o) => `${o.value}:${o.text.trim()}`).slice(0, 25).join(' | ')}]${e.options.length > 25 ? ' …+' + (e.options.length - 25) : ''}` : `${e.name}="${e.value}"`));
  const titulo = await page.locator('h3, h2, h1').evaluateAll((hs) => hs.map((h) => h.innerText.trim()).find((t) => /^\w{4} - /.test(t)) ?? '');
  console.log(`== ${codigo} ${titulo}\n  ${[...new Set(f)].join('\n  ')}`);
}
await browser.close();

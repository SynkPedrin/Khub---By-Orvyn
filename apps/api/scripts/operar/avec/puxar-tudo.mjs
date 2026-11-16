// Extração completa (somente leitura) dos relatórios do Avec -> ~/Downloads/avec-export/2026-11-14
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { listar } from './listar.mjs';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { chromium } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = process.env.AVEC_SESSAO_DIR ?? `${(await import('node:os')).homedir()}/.khub/avec-sessao/`;
const DEST = `${homedir()}/Downloads/avec-export/2026-11-14`;
mkdirSync(`${DEST}/json`, { recursive: true });
const P = { inicio: '01/01/2015', fim: '31/12/2027' };
const STATUS = [['1', 'Agendado'], ['1.5', 'Confirmado'], ['2', 'Aguardando'], ['3', 'Em Atendimento'], ['3.5', 'Finalizado'], ['4', 'Pago'], ['0', 'Cancelado'], ['0.6', 'Faltou']];
const ITENS = [
  { codigo: '0155', grupo: 'agendamentos', variantes: [[null, P]] },
  { codigo: '0248', grupo: 'agendamentos', variantes: STATUS.map(([v, t]) => [t, { ...P, status: v }]) },
  { codigo: '0387', grupo: 'financeiro', variantes: [['competencia', { ...P, tipo: 'competencia' }], ['pagamento', { ...P, tipo: 'pagamento' }]] },
  { codigo: '0385', grupo: 'financeiro', variantes: [[null, P]] },
  { codigo: '0180', grupo: 'financeiro', variantes: [[null, P]] },
  { codigo: '0186', grupo: 'comissoes', variantes: [[null, P]] },
  { codigo: '8123', grupo: 'comissoes', variantes: [[null, P]] },
  { codigo: '0028', grupo: 'comissoes', variantes: [[null, P]] },
  { codigo: '0229', grupo: 'usuarios', variantes: [[null, {}]] },
  { codigo: '0004', grupo: 'clientes', variantes: [[null, {}]] },
];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ storageState: `${DIR}sessao.json`, locale: 'pt-BR' });
const page = await ctx.newPage();
const csv = (linhas) => '﻿' + linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`).join(';')).join('\r\n');
const resumo = [];
for (const it of ITENS) {
  await page.goto(`https://admin.avec.beauty/admin/relatorio/${it.codigo}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  const titulo = await page.locator('h3, h2, h1').evaluateAll((hs) => hs.map((h) => h.innerText.trim()).find((t) => /^\w{4} - /.test(t)) ?? '');
  const cab = await page.$$eval('table thead th', (ths) => ths.map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
  const linhas = [];
  for (const [rot, params] of it.variantes) {
    const t0 = Date.now();
    const r = await listar(it.codigo, params);
    const dados = r.j?.aaData ?? [];
    writeFileSync(`${DEST}/json/${it.codigo}${rot ? '-' + rot.replace(/\W+/g, '_') : ''}.json`, r.txt);
    for (const l of dados) linhas.push(rot ? [rot, ...(Array.isArray(l) ? l : Object.values(l))] : (Array.isArray(l) ? l : Object.values(l)));
    console.log(`${it.codigo}${rot ? ' ' + rot : ''}: http ${r.status}, ${dados.length} linhas (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  const nome = `${it.grupo}-${it.codigo}-${titulo.replace(/^\w{4} - /, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60)}.csv`;
  writeFileSync(`${DEST}/${nome}`, csv([it.variantes[0][0] ? ['Variante', ...cab] : cab, ...linhas]));
  resumo.push({ codigo: it.codigo, grupo: it.grupo, titulo, linhas: linhas.length, arquivo: nome, colunas: cab });
}
writeFileSync(`${DEST}/RESUMO.json`, JSON.stringify(resumo, null, 1));
console.log('\nRESUMO'); for (const r of resumo) console.log(`${r.grupo.padEnd(13)} ${r.codigo} ${String(r.linhas).padStart(6)}  ${r.titulo}`);
await browser.close();

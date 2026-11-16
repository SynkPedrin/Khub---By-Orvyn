// Relatórios pesados mês a mês (02/2020 → 12/2026), com retry e divisão em quinzenas no 504.
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { listar } from './listar.mjs';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { chromium } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = process.env.AVEC_SESSAO_DIR ?? `${(await import('node:os')).homedir()}/.khub/avec-sessao/`;
const DEST = `${homedir()}/Downloads/avec-export/2026-11-14`;
mkdirSync(`${DEST}/json`, { recursive: true });
const ITENS = [['0180', 'financeiro'], ['0186', 'comissoes'], ['8123', 'comissoes']];
const fmt = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
const csv = (linhas) => '﻿' + linhas.map((l) => l.map((c) => `"${String(c ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().replace(/"/g, '""')}"`).join(';')).join('\r\n');
async function buscar(codigo, ini, fim, prof = 0) {
  for (let t = 0; t < 3; t++) {
    const r = await listar(codigo, { inicio: fmt(ini), fim: fmt(fim) });
    if (r.status === 200 && r.j) return r.j.aaData ?? [];
    if (r.status === 504 && prof < 3) {
      const meio = new Date((ini.getTime() + fim.getTime()) / 2);
      const a = await buscar(codigo, ini, meio, prof + 1);
      const b = await buscar(codigo, new Date(meio.getTime() + 86400000), fim, prof + 1);
      if (a && b) return [...a, ...b];
    }
    await new Promise((ok) => setTimeout(ok, 3000 * (t + 1)));
  }
  console.log(`  FALHOU ${codigo} ${fmt(ini)}–${fmt(fim)}`);
  return null;
}
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ storageState: `${DIR}sessao.json`, locale: 'pt-BR' });
const page = await ctx.newPage();
const resumo = JSON.parse(readFileSync(`${DEST}/RESUMO.json`, 'utf8'));
for (const [codigo, grupo] of ITENS) {
  await page.goto(`https://admin.avec.beauty/admin/relatorio/${codigo}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(2500);
  const titulo = await page.locator('h3, h2, h1').evaluateAll((hs) => hs.map((h) => h.innerText.trim()).find((t) => /^\w{4} - /.test(t)) ?? '');
  const cab = await page.$$eval('table thead th', (ths) => ths.map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
  const todas = []; let falhas = 0;
  for (let d = new Date(2020, 1, 1); d <= new Date(2026, 11, 1); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const fimMes = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    const dados = await buscar(codigo, d, fimMes);
    if (dados === null) { falhas++; continue; }
    for (const l of dados) todas.push(Array.isArray(l) ? l : Object.values(l));
  }
  writeFileSync(`${DEST}/json/${codigo}-mensal.json`, JSON.stringify({ aaData: todas }));
  const nome = `${grupo}-${codigo}-${titulo.replace(/^\w{4} - /, '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60)}.csv`;
  writeFileSync(`${DEST}/${nome}`, csv([cab, ...todas]));
  const i = resumo.findIndex((r) => r.codigo === codigo);
  resumo[i] = { codigo, grupo, titulo, linhas: todas.length, arquivo: nome, colunas: cab, mesesComFalha: falhas };
  console.log(`${codigo} ${titulo}: ${todas.length} linhas, meses com falha: ${falhas}`);
}
writeFileSync(`${DEST}/RESUMO.json`, JSON.stringify(resumo, null, 1));
await browser.close();

// Screenshots "antes" — Fase 1 auditoria de identidade (docs/brand/antes/).
// Uso: node scripts/brand-screenshots.mjs [cliente|agencia]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const WEB = process.env.WEB ?? 'http://localhost:3210';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/brand/antes');
mkdirSync(OUT, { recursive: true });

const CONTAS = {
  cliente: { email: 'demo.clinic@conteudo.orvyn.app', senha: 'KhubBrand2026!' },
  agencia: { email: 'pedro.gabriel@conteudo.orvyn.app', senha: 'KhubBrand2026!' },
};
const conta = CONTAS[process.argv[2] ?? 'cliente'];

const ROTAS_CLIENTE = [
  '/dashboard', '/leads', '/pipeline', '/conversas', '/inbox', '/agenda',
  '/tarefas', '/automacoes', '/campanhas', '/redes', '/marketing',
  '/marketing/google', '/formularios', '/analytics', '/financeiro', '/nyro',
  '/agentes', '/conhecimento', '/contatos', '/empresas', '/propostas',
  '/configuracoes',
];
const ROTAS_AGENCIA = ['/agency', '/agency/clients', '/agency/equipe', '/agency/calendario', '/agency/studio', '/agency/tarefas', '/agency/configuracoes'];
const ROTAS = process.argv[2] === 'agencia' ? ROTAS_AGENCIA : ROTAS_CLIENTE;

const VIEWS = [
  { nome: 'desktop', width: 1440, height: 900 },
  { nome: 'mobile', width: 390, height: 844 },
];
const slug = (s) => (s === '/' ? 'home' : s.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, ''));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// Login uma vez e reusa o storageState
async function login() {
  const ctx = await browser.newContext({ viewport: VIEWS[0], locale: 'pt-BR' });
  const page = await ctx.newPage();
  await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type=email]', conta.email);
  await page.fill('input[type=password]', conta.senha);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 }).catch(() => {}),
    page.click('button[type=submit]'),
  ]);
  await page.waitForLoadState('networkidle').catch(() => {});
  return ctx;
}

// Telas públicas de auth (sem login)
{
  const ctx = await browser.newContext({ viewport: VIEWS[0], locale: 'pt-BR' });
  const page = await ctx.newPage();
  for (const rota of ['/login', '/signup']) {
    for (const v of VIEWS) {
      await page.setViewportSize({ width: v.width, height: v.height });
      await page.goto(`${WEB}${rota}`, { waitUntil: 'networkidle' }).catch(() => {});
      await sleep(1200);
      await page.screenshot({ path: resolve(OUT, `${slug(rota)}-dark-${v.nome}.png`) });
      console.log('ok', rota, v.nome);
    }
  }
  await ctx.close();
}

const ctx = await login();
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message?.slice(0, 160)));

for (const rota of ROTAS) {
  for (const v of VIEWS) {
    await page.setViewportSize({ width: v.width, height: v.height });
    for (const tema of ['dark', 'light']) {
      try {
        await page.goto(`${WEB}${rota}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), tema);
        await sleep(1400);
        await page.screenshot({ path: resolve(OUT, `${slug(rota)}-${tema}-${v.nome}.png`) });
        console.log('ok', rota, tema, v.nome);
      } catch (e) {
        console.log('FALHOU', rota, tema, v.nome, String(e).slice(0, 120));
      }
    }
  }
}
await browser.close();
console.log('FIM');

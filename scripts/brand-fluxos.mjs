// Fumaça funcional dos fluxos tocados pelo redesign (brief §10, subconjunto).
// Roda contra o dev server com o tenant demo. Uso: node scripts/brand-fluxos.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const WEB = process.env.WEB ?? 'http://localhost:3210';
const ok = (nome, cond) => console.log(`${cond ? 'PASS' : 'FAIL'} ${nome}`);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
const page = await ctx.newPage();
await page.goto(`${WEB}/login`, { waitUntil: 'load' });
await page.waitForTimeout(1500);
await page.fill('input[type=email]', 'demo.clinic@conteudo.orvyn.app');
await page.fill('input[type=password]', 'KhubBrand2026!');
await Promise.all([
  page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 25000 }).catch(() => {}),
  page.click('button[type=submit]'),
]);
ok('login redireciona para a área logada', !page.url().includes('/login'));

// Fluxo 1: criar lead (abre modal, sem quebrar)
await page.goto(`${WEB}/leads`, { waitUntil: 'load' });
await page.waitForTimeout(3500);
await page.click('text=Novo Lead');
await page.waitForTimeout(800);
const modalLead = await page.locator('[role="dialog"]').count();
ok('criar lead abre o modal', modalLead > 0);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// Fluxo 2: mover negócio + Desfazer
await page.goto(`${WEB}/pipeline`, { waitUntil: 'load' });
await page.waitForTimeout(8000);
const colunasAntes = await page.locator('section[aria-label]').count();
ok('pipeline renderiza colunas', colunasAntes > 0);
const menuAcoes = page.locator('article button[aria-label^="Ações de"]').first();
if (await menuAcoes.count()) {
  await menuAcoes.click();
  await page.waitForTimeout(600);
  const itemMover = page.locator('[role="menu"] button').first();
  if (await itemMover.count()) {
    await itemMover.click();
    await page.waitForTimeout(4000);
    const toastMovido = await page.locator('text=Movido para').count();
    ok('mover negócio mostra toast', toastMovido > 0);
    const desfazer = page.locator('button:has-text("Desfazer")').first();
    if (await desfazer.count()) {
      await desfazer.click();
      await page.waitForTimeout(4000);
      ok('desfazer reverte o movimento', (await page.locator('text=Movimento desfeito').count()) > 0);
    } else ok('desfazer reverte o movimento', false);
  } else ok('menu mover para abre itens', false);
} else {
  console.log('SKIP mover: nenhum card com menu "Ações de" no quadro demo');
}

// Fluxo 3: ⌘K abre a paleta (via gatilho da topbar, que dispara o mesmo evento)
await page.click('button[aria-label*="Buscar"]').catch(() => {});
await page.waitForTimeout(1000);
ok('busca global abre', (await page.locator('input[placeholder*="Buscar"], [role="dialog"] input').count()) > 0);
await page.keyboard.press('Escape');

await browser.close();
console.log('FIM');

// Web Vitals (LCP/CLS) nas rotas críticas — Fase 4.5.
// ATENÇÃO: medido no servidor DEV (Next dev compila sob demanda e infla LCP).
// Para números de produção, rode contra `next start`. Uso:
//   WEB=http://localhost:3210 node scripts/brand-vitals.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');

const WEB = process.env.WEB ?? 'http://localhost:3210';
const ROTAS = ['/dashboard', '/leads', '/conversas'];

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

for (const rota of ROTAS) {
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => {
      const e = l.getEntries().at(-1);
      if (e) window.__vitals.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(`${WEB}${rota}`, { waitUntil: 'load' });
  await page.waitForTimeout(6000);
  const v = await page.evaluate(() => window.__vitals);
  console.log(`${rota}  LCP=${(v.lcp / 1000).toFixed(2)}s  CLS=${v.cls.toFixed(3)}  (navegação total ${(Date.now() - t0) / 1000}s)`);
}
await browser.close();

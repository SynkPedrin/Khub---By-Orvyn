// Gera docs/brand/contraste.md — pares texto/fundo dos tokens v2, razão WCAG e veredito AA.
// Uso: node scripts/brand-contraste.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};

const PARES = [
  // [texto, fundo, contexto, mínimo (4.5 corpo | 3 grande/ícone)]
  ['#F4F4F6', '#050506', 'fg-1 / bg-0 (dark)', 4.5],
  ['#F4F4F6', '#0F0F12', 'fg-1 / surface-1 (dark)', 4.5],
  ['#A9A9B4', '#0F0F12', 'fg-2 / surface-1 (dark)', 4.5],
  ['#7F7F89', '#0F0F12', 'fg-3 / surface-1 (dark)', 4.5],
  ['#D6FF8F', '#0F0F12', 'lime-300 texto de marca / surface-1 (dark)', 4.5],
  ['#D6FF8F', '#141A03', 'lime-300 / lime-950 (badge sinal, dark)', 4.5],
  ['#0B1000', '#B6FF00', 'lime-ink / lime-500 (botão primário)', 4.5],
  ['#0B1000', '#C8FF4D', 'lime-ink / lime-400 (hover primário)', 4.5],
  ['#B8A2FF', '#0F0F12', 'violet-300 texto de IA / surface-1 (dark)', 4.5],
  ['#B8A2FF', '#1E0B4A', 'violet-300 / violet-900 (card IA, dark)', 4.5],
  ['#F4F4F6', '#331177', 'fg-1 / violet-800 (header IA, dark)', 4.5],
  ['#2EE6A6', '#0F0F12', 'sucesso / surface-1 (dark)', 4.5],
  ['#FFB547', '#0F0F12', 'atenção / surface-1 (dark)', 4.5],
  ['#FF5D6C', '#0F0F12', 'erro / surface-1 (dark)', 4.5],
  ['#5EB0FF', '#0F0F12', 'info / surface-1 (dark)', 4.5],
  ['#B6FF00', '#0F0F12', 'lime-500 ícone/barra ativa / surface-1 (dark)', 3],
  ['#8F6BFF', '#0F0F12', 'violet-400 ícone IA / surface-1 (dark)', 3],
  ['#111114', '#FFFFFF', 'fg-1 / superfície (light)', 4.5],
  ['#111114', '#F8F8F5', 'fg-1 / canvas (light)', 4.5],
  ['#4E4E57', '#FFFFFF', 'fg-3 / superfície (light)', 4.5],
  ['#4C7A00', '#FFFFFF', 'lime texto de marca / superfície (light)', 4.5],
  ['#4C7A00', '#F0F7DC', 'lime texto / lime-soft (light)', 4.5],
  ['#4411AA', '#FFFFFF', 'violeta texto IA / superfície (light)', 4.5],
  ['#4411AA', '#F3ECFF', 'violeta texto / violet-soft (light)', 4.5],
  ['#0B1000', '#B6FF00', 'lime-ink / lime-500 (botão, light)', 4.5],
  ['#0A7A52', '#FFFFFF', 'sucesso escuro / superfície (light)', 4.5],
  ['#B4232F', '#FFFFFF', 'erro escuro / superfície (light)', 4.5],
];

const linhas = PARES.map(([t, f, ctx, min]) => {
  const r = ratio(t, f);
  const ok = r >= min;
  return `| ${ctx} | \`${t}\` | \`${f}\` | ${r.toFixed(2)}:1 | ≥ ${min}:1 | ${ok ? '✅' : '❌ FALHA'} |`;
});

mkdirSync(resolve(ROOT, 'docs/brand'), { recursive: true });
writeFileSync(resolve(ROOT, 'docs/brand/contraste.md'),
  `# Contraste AA — tokens v2\n\nGerado por \`scripts/brand-contraste.mjs\` (WCAG 2.1 contraste relativo). Re-rodar após qualquer ajuste de token.\n\n| Par | Texto | Fundo | Razão | Mínimo | Status |\n|---|---|---|---|---|---|\n${linhas.join('\n')}\n`);
console.log('contraste.md gerado;', PARES.length, 'pares;', linhas.filter((l) => l.includes('❌')).length, 'falhas');

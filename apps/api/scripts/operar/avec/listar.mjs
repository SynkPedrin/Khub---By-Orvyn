// Chama /admin/relatorios/listar com a sessão logada. uso: node listar.mjs CODIGO "inicio=..&fim=..&status=1"
import { createRequire } from 'node:module';
const require = createRequire('/Users/pedro/Downloads/DESENVOLVIMENTO/Nyro IA/KHUB-OS/apps/api/package.json');
const { request } = require('/Users/pedro/.npm/_npx/dea9475797100b20/node_modules/playwright-core');
const DIR = process.env.AVEC_SESSAO_DIR ?? `${(await import('node:os')).homedir()}/.khub/avec-sessao/`;
export async function listar(codigo, params) {
  const api = await request.newContext({ storageState: `${DIR}sessao.json`, extraHTTPHeaders: { 'X-Requested-With': 'XMLHttpRequest', Referer: `https://admin.avec.beauty/admin/relatorio/${codigo}` } });
  const q = new URLSearchParams({ relatorio: codigo, salao: '62338', ...params });
  const r = await api.get(`https://admin.avec.beauty/admin/relatorios/listar?${q}`, { timeout: 180000 });
  const txt = await r.text();
  await api.dispose();
  let j = null; try { j = JSON.parse(txt); } catch { /* html */ }
  return { status: r.status(), j, txt };
}
if (process.argv[2]) {
  const r = await listar(process.argv[2], Object.fromEntries(new URLSearchParams(process.argv[3] ?? '')));
  console.log('http', r.status, 'linhas', r.j?.aaData?.length ?? '-', 'chaves', r.j ? Object.keys(r.j).join(',') : r.txt.slice(0, 200).replace(/\s+/g, ' '));
  if (r.j?.aaData?.length) console.log('primeira', JSON.stringify(r.j.aaData[0]).slice(0, 300), '\nultima', JSON.stringify(r.j.aaData.at(-1)).slice(0, 300));
}

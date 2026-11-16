#!/usr/bin/env node
/**
 * AUDITORIA SOMENTE LEITURA da produção (Studio da Beleza / Ritinha) pela API oficial.
 * Login com ~/.khub/khub.env (KHUB_EMAIL/KHUB_SENHA) — segredos nunca impressos.
 * Apenas GETs. Nenhuma escrita, nenhum disparo.
 *
 *   node scripts/operar/auditar-ritinha-api.mjs
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = process.env.KHUB_URL ?? 'https://khub-os.vercel.app';
const env = Object.fromEntries(
  readFileSync(`${homedir()}/.khub/khub.env`, 'utf8')
    .split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const EMAIL = env.KHUB_EMAIL, SENHA = env.KHUB_SENHA;
if (!EMAIL || !SENHA) throw new Error('~/.khub/khub.env sem KHUB_EMAIL/KHUB_SENHA');

const jar = [];
const cookie = () => jar.map((c) => c.split(';')[0]).join('; ');
async function req(metodo, caminho, corpo) {
  const r = await fetch(`${BASE}${caminho}`, {
    method: metodo,
    headers: { 'content-type': 'application/json', ...(jar.length ? { cookie: cookie() } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    redirect: 'manual',
  });
  for (const sc of r.headers.getSetCookie?.() ?? []) jar.push(sc);
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch { /* html ou vazio */ }
  return { status: r.status, json, texto: json ? null : texto.slice(0, 300) };
}

const login = await req('POST', '/api/auth/login', { email: EMAIL, password: SENHA });
console.log('LOGIN:', login.status);
if (login.status >= 400) { console.log('FALHA NO LOGIN'); process.exit(1); }

async function mostrar(titulo, caminho, resumo) {
  const r = await req('GET', caminho);
  console.log(`\n=== ${titulo} (${caminho}) → HTTP ${r.status}`);
  if (r.status >= 400) { console.log('  ERRO:', r.texto ?? JSON.stringify(r.json).slice(0, 400)); return null; }
  const d = r.json;
  try { console.log(resumo ? resumo(d) : JSON.stringify(d).slice(0, 2000)); } catch (e) { console.log('  (resumo falhou)', e.message, JSON.stringify(d).slice(0, 800)); }
  return d;
}

// Subconta atual (a sessão master entra na última subconta usada — conferir!)
const eu = await mostrar('SESSÃO', '/api/v1/auth/me', (d) => JSON.stringify({ email: d?.email, nome: d?.nome }));
await mostrar('TENANT ATUAL', '/api/v1/tenants/atual', (d) => JSON.stringify(d).slice(0, 600));

// Agentes
const agentes = await mostrar('AGENTES', '/api/v1/agents', (d) => {
  const l = Array.isArray(d) ? d : d?.itens ?? [];
  return l.map((a) => `- ${a.nome} | id=${a.id} | status=${a.status} | padrao=${a.padrao} | modelo=${a.modelo} | ferramentas=${JSON.stringify(a.ferramentas)} | canais=${JSON.stringify(a.canais)} | maxCar=${a.maxCaracteres} | instr=${(a.instrucoes ?? '').length}ch | vPub=${a.versaoPublicadaId ?? 'nenhuma'}`).join('\n');
});

// Detalhe da Ritinha
const lista = Array.isArray(agentes) ? agentes : agentes?.itens ?? [];
const rit = lista.find((a) => /ritinha/i.test(a.nome ?? ''));
if (rit) {
  const det = await mostrar('RITINHA DETALHE', `/api/v1/agents/${rit.id}`, (d) => JSON.stringify({
    id: d.id, status: d.status, padrao: d.padrao, modelo: d.modelo,
    ferramentas: d.ferramentas, maxRespostas: d.maxRespostasConversa, maxCaracteres: d.maxCaracteres,
    conhecimentoAtivo: d.conhecimentoAtivo, versaoPublicadaId: d.versaoPublicadaId,
    config: d.config, instrucoesChars: (d.instrucoes ?? '').length,
  }, null, 1)?.slice(0, 6000));
  await mostrar('RITINHA VERSÕES', `/api/v1/agents/${rit.id}/versoes`, (d) => {
    const l = Array.isArray(d) ? d : d?.itens ?? [];
    return l.map((v) => `- v${v.numero} | ${v.status ?? ''} | ${v.createdAt} | ${v.notas ?? ''}`).join('\n') || '(sem versões)';
  });
}

// Automações
await mostrar('WORKFLOWS', '/api/v1/automations/workflows', (d) => {
  const l = Array.isArray(d) ? d : d?.itens ?? [];
  return l.map((w) => `- "${w.nome}" | id=${w.id} | status=${w.status} | gatilho=${w.gatilho?.tipo ?? JSON.stringify(w.gatilho ?? '')} | runs=${w.totalRuns ?? w._count?.runs ?? '?'}`).join('\n');
});

// Integrações / canais
await mostrar('INTEGRAÇÕES', '/api/v1/integrations', (d) => {
  const l = Array.isArray(d) ? d : d?.itens ?? [];
  return l.map((i) => `- ${i.provider} | status=${i.status} | health=${i.health} | lastSync=${i.lastSyncAt ?? '-'}`).join('\n');
});
await mostrar('CANAIS', '/api/v1/integrations/canais', (d) => JSON.stringify(d).slice(0, 2500)).catch?.(() => {});

// Campos personalizados
await mostrar('CAMPOS PERSONALIZADOS', '/api/v1/crm/campos', (d) => {
  const l = Array.isArray(d) ? d : d?.itens ?? [];
  return l.map((c) => `- ${c.nome ?? c.chave} (${c.tipo})`).join('\n') || JSON.stringify(d).slice(0, 1500);
});

// Aprovações pendentes (MCP / ações sensíveis)
await mostrar('APROVAÇÕES NYRO PENDENTES', '/api/v1/nyro/acoes?status=pendente', (d) => {
  const l = Array.isArray(d) ? d : d?.itens ?? [];
  return l.map((a) => `- ${a.id} | ${a.tool} | ${a.resumo} | criada ${a.createdAt} | expira ${a.expiraEm}`).join('\n') || JSON.stringify(d).slice(0, 1500);
});

console.log('\n== fim da auditoria (somente leitura) ==');

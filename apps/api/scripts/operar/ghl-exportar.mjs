#!/usr/bin/env node
/**
 * MIGRAÇÃO GHL → Revenue OS · etapa 1: EXPORTAR (somente leitura no GHL).
 *
 * ADR-0031: o Revenue OS substitui o GHL — sem integração nem sync. Este script
 * só LÊ a subconta (token de Private Integration da SUBCONTA, escopos .readonly)
 * e grava um retrato em JSON fora do git (docs/revenue-audit/evidence/ é
 * ignorado: contém dado pessoal de clientes). A gravação no banco é a etapa 2
 * (`ghl-importar.mjs`).
 *
 *   cd apps/api && node --env-file=.env scripts/operar/ghl-exportar.mjs [--location ID]
 *
 * Endpoints usados (API v2 oficial, services.leadconnectorhq.com):
 *   GET  /locations/{id} · /locations/{id}/customFields · /customValues · /tags
 *   GET  /users/?locationId · /opportunities/pipelines · /opportunities/search
 *   POST /contacts/search · GET /conversations/search · /conversations/messages/export
 *   GET  /calendars/?locationId · /calendars/events
 *   GET  /workflows/?locationId (só nome/status — a API não exporta os passos)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://services.leadconnectorhq.com';
const TOKEN = process.env.GHL_MIGRATION_TOKEN;
const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const LOC = arg('--location') ?? process.env.GHL_MIGRATION_LOCATION_ID;
if (!TOKEN || !LOC) {
  console.error('faltam GHL_MIGRATION_TOKEN e GHL_MIGRATION_LOCATION_ID (ou --location)');
  process.exit(1);
}
const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../docs/revenue-audit/evidence/ghl', LOC);
mkdirSync(DIR, { recursive: true });

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET/POST com retry em 429/5xx. Nunca loga o token nem o corpo de resposta. */
async function ghl(caminho, { metodo = 'GET', corpo } = {}) {
  for (let t = 1; ; t++) {
    const res = await fetch(BASE + caminho, {
      method: metodo,
      headers: {
        authorization: `Bearer ${TOKEN}`,
        // export de mensagens só responde com a versão da API de conversas (com 2021-07-28 volta lista vazia)
        version: caminho.startsWith('/conversations') ? '2021-04-15' : '2021-07-28',
        accept: 'application/json',
        // Cloudflare do GHL bloqueia UA genérico (erro 1010).
        'user-agent': 'khub-migracao/1.0',
        ...(corpo ? { 'content-type': 'application/json' } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && t < 6) {
      await espera(1000 * 2 ** t);
      continue;
    }
    const j = await res.json().catch(() => ({}));
    const msg = Array.isArray(j.message) ? j.message.join('; ') : j.message ?? '';
    throw new Error(`GHL ${metodo} ${caminho.split('?')[0]} → ${res.status} ${msg}`);
  }
}

function salvar(nome, dados) {
  writeFileSync(join(DIR, `${nome}.json`), JSON.stringify(dados, null, 1));
  const n = Array.isArray(dados) ? dados.length : Object.keys(dados ?? {}).length;
  console.log(`  ${nome.padEnd(16)} ${n}`);
}

/** Lista paginada por cursor/página até acabar; confere com o total quando houver. */
async function contatos() {
  const todos = [];
  let searchAfter;
  for (;;) {
    const r = await ghl('/contacts/search', { metodo: 'POST', corpo: { locationId: LOC, pageLimit: 100, ...(searchAfter ? { searchAfter } : {}) } });
    const lote = r.contacts ?? [];
    todos.push(...lote);
    if (!lote.length || todos.length >= (r.total ?? 0)) return { lista: todos, total: r.total };
    searchAfter = lote[lote.length - 1].searchAfter;
    if (!searchAfter) throw new Error('contacts/search sem searchAfter para paginar');
  }
}

async function conversas() {
  const vistos = new Map();
  let total = 0;
  let startAfterDate;
  for (;;) {
    const q = new URLSearchParams({ locationId: LOC, limit: '100', sortBy: 'last_message_date', sort: 'desc' });
    if (startAfterDate) q.set('startAfterDate', String(startAfterDate));
    const r = await ghl(`/conversations/search?${q}`);
    total = r.total ?? total;
    const lote = r.conversations ?? [];
    const antes = vistos.size;
    for (const c of lote) vistos.set(c.id, c);
    if (!lote.length || vistos.size >= total || vistos.size === antes) break;
    const ultimo = lote[lote.length - 1];
    startAfterDate = ultimo.sort?.[0] ?? ultimo.lastMessageDate;
  }
  return { lista: [...vistos.values()], total };
}

async function mensagens() {
  const todas = [];
  let total = 0;
  let cursor;
  for (;;) {
    const q = new URLSearchParams({ locationId: LOC, limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const r = await ghl(`/conversations/messages/export?${q}`);
    total = r.total ?? total;
    todas.push(...(r.messages ?? []));
    if (!r.nextCursor || !(r.messages ?? []).length) break;
    cursor = r.nextCursor;
    if (todas.length % 1000 < 100) process.stdout.write(`\r  mensagens…       ${todas.length}/${total}`);
  }
  process.stdout.write('\r');
  return { lista: todas, total };
}

async function oportunidades() {
  const todas = [];
  let total = 0;
  for (let page = 1; ; page++) {
    const r = await ghl(`/opportunities/search?location_id=${LOC}&limit=100&page=${page}`);
    total = r.meta?.total ?? total;
    todas.push(...(r.opportunities ?? []));
    if (!(r.opportunities ?? []).length || todas.length >= total) break;
  }
  return { lista: todas, total };
}

async function eventosAgenda(calendarios) {
  const agora = Date.now();
  const ini = agora - 365 * 864e5;
  const fim = agora + 365 * 864e5;
  const todos = [];
  for (const c of calendarios) {
    const r = await ghl(`/calendars/events?locationId=${LOC}&calendarId=${c.id}&startTime=${ini}&endTime=${fim}`);
    todos.push(...(r.events ?? []));
  }
  return todos;
}

console.log(`exportando subconta ${LOC} → ${DIR}`);
const conferencia = {};
const loc = await ghl(`/locations/${LOC}`);
salvar('location', loc.location ?? loc);
salvar('custom_fields', (await ghl(`/locations/${LOC}/customFields`)).customFields ?? []);
salvar('custom_values', (await ghl(`/locations/${LOC}/customValues`)).customValues ?? []);
salvar('tags', (await ghl(`/locations/${LOC}/tags`)).tags ?? []);
salvar('users', (await ghl(`/users/?locationId=${LOC}`)).users ?? []);
salvar('pipelines', (await ghl(`/opportunities/pipelines?locationId=${LOC}`)).pipelines ?? []);
salvar('workflows', (await ghl(`/workflows/?locationId=${LOC}`)).workflows ?? []);
const cals = (await ghl(`/calendars/?locationId=${LOC}`)).calendars ?? [];
salvar('calendars', cals);
salvar('events', await eventosAgenda(cals));
for (const [nome, fn] of [['contacts', contatos], ['conversations', conversas], ['opportunities', oportunidades], ['messages', mensagens]]) {
  const { lista, total } = await fn();
  salvar(nome, lista);
  conferencia[nome] = { exportados: lista.length, totalGhl: total };
}
salvar('_conferencia', { ...conferencia, exportadoEm: new Date().toISOString() });
const falta = Object.entries(conferencia).filter(([, v]) => v.exportados !== v.totalGhl);
console.log(falta.length ? `ATENÇÃO — divergência: ${JSON.stringify(Object.fromEntries(falta))}` : 'conferência OK: tudo que o GHL informou foi exportado.');

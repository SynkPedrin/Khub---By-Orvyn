import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FilaWebhook, BACKOFF_MS, deveRetentar } from '../src/webhook.js';
import { assinar } from '../src/util.js';

const SEG = 'segredo-de-teste-123456';
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'fila-'));
const esperar = (cond, ms = 2000) =>
  new Promise((res, rej) => {
    const ate = Date.now() + ms;
    const t = setInterval(() => {
      if (cond()) { clearInterval(t); res(); } else if (Date.now() > ate) { clearInterval(t); rej(new Error('timeout')); }
    }, 5);
  });

test('envia com cabeçalhos assinados que o KHUB consegue verificar', async () => {
  const recebidos = [];
  const fila = new FilaWebhook({
    dataDir: dir(), url: 'https://khub.invalid/v1/webhooks/openwa', segredo: SEG,
    fetchImpl: async (url, init) => { recebidos.push(init); return new Response('{}', { status: 200 }); },
  });
  fila.iniciar();
  const env = fila.publicar('khub-123e4567-e89b-12d3-a456-426614174000', 'sessao.estado', { estado: 'conectado' });
  await esperar(() => recebidos.length === 1 && fila.pendentes() === 0);
  await fila.parar();
  const h = recebidos[0].headers;
  assert.equal(h['content-type'], 'application/json');
  assert.equal(h['x-khub-signature'], assinar(SEG, h['x-khub-timestamp'], recebidos[0].body));
  const corpo = JSON.parse(recebidos[0].body);
  assert.equal(corpo.eventId, env.eventId);
  assert.equal(corpo.tipo, 'sessao.estado');
  assert.ok(corpo.criadoEm && corpo.sessionId && corpo.dados);
});

test('5xx: tenta de novo com o MESMO eventId e corpo; backoff do contrato', async () => {
  let agora = 0;
  const corpos = [];
  let n = 0;
  const fila = new FilaWebhook({
    dataDir: dir(), url: 'https://khub.invalid/x', segredo: SEG, agora: () => agora,
    fetchImpl: async (u, init) => { corpos.push(init.body); n += 1; return new Response('', { status: n < 3 ? 503 : 200 }); },
  });
  fila.iniciar();
  fila.publicar('khub-123e4567-e89b-12d3-a456-426614174000', 'mensagem', { id: 'x' });
  await esperar(() => corpos.length === 1);
  agora += BACKOFF_MS[0];
  fila._bombear();
  await esperar(() => corpos.length === 2);
  agora += BACKOFF_MS[1];
  fila._bombear();
  await esperar(() => corpos.length === 3 && fila.pendentes() === 0);
  await fila.parar();
  assert.equal(new Set(corpos).size, 1, 'corpo (e eventId) idênticos');
  assert.deepEqual(BACKOFF_MS.slice(0, 4), [2000, 10000, 60000, 300000]);
  assert.equal(BACKOFF_MS.length, 6, 'até 6 novas tentativas');
});

test('fila persiste em disco: reinício reenvia o mesmo evento', async () => {
  const d = dir();
  const f1 = new FilaWebhook({ dataDir: d, url: 'https://khub.invalid/x', segredo: SEG, fetchImpl: async () => new Response('', { status: 500 }) });
  const env = f1.publicar('khub-123e4567-e89b-12d3-a456-426614174000', 'mensagem', { id: 'y' }); // não iniciada: só grava
  assert.equal(fs.readdirSync(path.join(d, 'fila')).length, 1);
  const vistos = [];
  const f2 = new FilaWebhook({ dataDir: d, url: 'https://khub.invalid/x', segredo: SEG, fetchImpl: async (u, i) => { vistos.push(JSON.parse(i.body).eventId); return new Response(null, { status: 204 }); } });
  f2.iniciar();
  await esperar(() => f2.pendentes() === 0);
  await f2.parar();
  await f1.parar();
  assert.deepEqual(vistos, [env.eventId]);
  assert.equal(fs.readdirSync(path.join(d, 'fila')).length, 0);
});

test('4xx definitivo vai para fila-falhas; 408/429/5xx/rede retentam', async () => {
  assert.equal(deveRetentar(0), true);
  assert.equal(deveRetentar(500), true);
  assert.equal(deveRetentar(429), true);
  assert.equal(deveRetentar(408), true);
  assert.equal(deveRetentar(401), false);
  const d = dir();
  const f = new FilaWebhook({ dataDir: d, url: 'https://khub.invalid/x', segredo: SEG, fetchImpl: async () => new Response('', { status: 400 }) });
  f.iniciar();
  f.publicar('khub-123e4567-e89b-12d3-a456-426614174000', 'mensagem', {});
  await esperar(() => f.pendentes() === 0);
  await f.parar();
  assert.equal(fs.readdirSync(path.join(d, 'fila-falhas')).length, 1);
});

// Testes de ponta a ponta do gateway com um cliente open-wa falso
// (sem Chromium): HTTP + auth + sessões + idempotência + webhooks.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { criarServidor } from '../src/http.js';
import { GerenciadorSessoes } from '../src/sessoes.js';
import { Idempotencia } from '../src/idempotencia.js';
import { lerConfig } from '../src/config.js';
import { ClienteFalso } from './fakes.js';

const CHAVE = 'chave-de-teste-0123456789abcdef';
const S1 = 'khub-11111111-1111-4111-8111-111111111111';
const S2 = 'khub-22222222-2222-4222-8222-222222222222';
const S3 = 'khub-33333333-3333-4333-8333-333333333333';

let base, servidor, ger, fila, clientes, dataDir;

class FilaFalsa {
  constructor() { this.eventos = []; }
  publicar(sessionId, tipo, dados) { this.eventos.push({ sessionId, tipo, dados }); return { eventId: String(this.eventos.length) }; }
  pendentes() { return 0; }
  de(tipo) { return this.eventos.filter((e) => e.tipo === tipo); }
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-'));
  const config = lerConfig({
    OPENWA_GATEWAY_KEY: CHAVE,
    OPENWA_WEBHOOK_SECRET: 'segredo-de-teste-0123456789',
    KHUB_WEBHOOK_URL: 'https://khub.invalid/v1/webhooks/openwa',
    DATA_DIR: dataDir,
    MAX_SESSOES: '2',
  });
  fila = new FilaFalsa();
  clientes = new Map();
  ger = new GerenciadorSessoes({
    config, fila,
    fabricaCliente: async (id) => { const c = new ClienteFalso(); clientes.set(id, c); return c; },
  });
  const idem = new Idempotencia(path.join(dataDir, 'idem.jsonl'));
  servidor = criarServidor({ config, gerenciador: ger, idem, fila });
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(async () => {
  await ger.pararTodas();
  await new Promise((r) => servidor.close(r));
});

const chamar = (metodo, rota, corpo, chave = CHAVE) =>
  fetch(base + rota, {
    method: metodo,
    headers: { ...(chave ? { 'x-gateway-key': chave } : {}), 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  }).then(async (r) => ({ status: r.status, json: await r.json() }));

test('config: recusa subir sem chave/segredo/webhook', () => {
  assert.throws(() => lerConfig({}), /OPENWA_GATEWAY_KEY.*OPENWA_WEBHOOK_SECRET.*KHUB_WEBHOOK_URL/);
  assert.throws(() => lerConfig({ OPENWA_GATEWAY_KEY: 'x'.repeat(32), OPENWA_WEBHOOK_SECRET: 'y'.repeat(32), KHUB_WEBHOOK_URL: 'nao-e-url' }), /inválida/);
});

test('auth: sem x-gateway-key ou com chave errada → 401 em toda rota', async () => {
  for (const [m, r] of [['GET', '/health'], ['POST', `/sessions/${S1}/start`], ['GET', `/sessions/${S1}`], ['DELETE', `/sessions/${S1}`], ['POST', `/sessions/${S1}/messages/text`]]) {
    const sem = await chamar(m, r, m === 'POST' ? {} : undefined, null);
    assert.equal(sem.status, 401, `${m} ${r}`);
    assert.equal(sem.json.erro, 'nao_autorizado');
    const errada = await chamar(m, r, m === 'POST' ? {} : undefined, CHAVE.replace('a', 'b'));
    assert.equal(errada.status, 401);
  }
});

test('health com chave', async () => {
  const r = await chamar('GET', '/health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(typeof r.json.sessoes, 'number');
  assert.equal(typeof r.json.versao, 'string');
});

test('sessionId inválido → 400; sessão nunca iniciada → 404', async () => {
  assert.equal((await chamar('GET', '/sessions/khub-xyz')).status, 400);
  const r = await chamar('GET', `/sessions/${S3}`);
  assert.equal(r.status, 404);
  assert.equal(r.json.erro, 'sessao_inexistente');
});

test('start → aguardando_qr com QR data URL; start repetido não cria 2º navegador; QR lido → conectado', async () => {
  const [a, b] = await Promise.all([chamar('POST', `/sessions/${S1}/start`, {}), chamar('POST', `/sessions/${S1}/start`, {})]);
  assert.equal(a.status, 200);
  assert.equal(a.json.estado, 'aguardando_qr');
  assert.match(a.json.qr, /^data:image\/png;base64,/);
  assert.ok(a.json.qrAtualizadoEm);
  assert.equal(b.json.estado, 'aguardando_qr');
  assert.equal(clientes.size, 1, 'um navegador só');
  assert.equal(fila.de('sessao.qr').length, 1);
  assert.match(fila.de('sessao.qr')[0].dados.qr, /^data:image\/png;base64,/);
  assert.equal(typeof fila.de('sessao.qr')[0].dados.expiraEmSeg, 'number');

  clientes.get(S1).escanear();
  await new Promise((r) => setTimeout(r, 50));
  const g = await chamar('GET', `/sessions/${S1}`);
  assert.deepEqual(g.json, { estado: 'conectado', numero: '5511900000000', nome: 'Studio Teste' });
  const estados = fila.de('sessao.estado').filter((e) => e.sessionId === S1).map((e) => e.dados.estado);
  assert.deepEqual(estados, ['iniciando', 'aguardando_qr', 'iniciando', 'conectado']);
  assert.equal(fs.existsSync(path.join(dataDir, 'sessions', S1)), true);
});

test('limite de sessões → 429 limite_sessoes', async () => {
  const r2 = await chamar('POST', `/sessions/${S2}/start`, {});
  assert.equal(r2.status, 200);
  const r3 = await chamar('POST', `/sessions/${S3}/start`, {});
  assert.equal(r3.status, 429);
  assert.equal(r3.json.erro, 'limite_sessoes');
});

test('envio de texto: idempotente, número sem WhatsApp 422, sessão desconectada 409, corpo inválido 400', async () => {
  const corpo = { to: '+55 11 90000-0001', texto: 'olá', idempotencyKey: 'k-1' };
  const a = await chamar('POST', `/sessions/${S1}/messages/text`, corpo);
  const b = await chamar('POST', `/sessions/${S1}/messages/text`, corpo);
  assert.equal(a.status, 200);
  assert.equal(a.json.providerId, b.json.providerId);
  assert.equal(clientes.get(S1).enviados.length, 1, 'enviou uma vez só');
  assert.equal(clientes.get(S1).enviados[0].chatId, '5511900000001@c.us');

  const inv = await chamar('POST', `/sessions/${S1}/messages/text`, { to: '5599900000000', texto: 'x', idempotencyKey: 'k-2' });
  assert.equal(inv.status, 422);
  assert.equal(inv.json.erro, 'numero_invalido');

  const desc = await chamar('POST', `/sessions/${S2}/messages/text`, { to: '5511900000001', texto: 'x', idempotencyKey: 'k-3' });
  assert.equal(desc.status, 409);
  assert.equal(desc.json.erro, 'sessao_desconectada');

  const sem = await chamar('POST', `/sessions/${S1}/messages/text`, { to: '5511900000001', texto: 'x' });
  assert.equal(sem.status, 400);

  const nunca = await chamar('POST', `/sessions/${S3}/messages/text`, { to: '5511900000001', texto: 'x', idempotencyKey: 'k-4' });
  assert.equal(nunca.status, 409, 'sessão nunca iniciada também é 409 (nada enviado)');
});

test('envio de mídia: valida corpo, idempotente, opções certas por tipo', async () => {
  const b64 = Buffer.from('%PDF-1.4 teste').toString('base64');
  const ok = { to: '5511900000001', tipo: 'documento', mime: 'application/pdf', nome: 'a.pdf', legenda: 'segue', base64: b64, idempotencyKey: 'm-1' };
  const a = await chamar('POST', `/sessions/${S1}/messages/media`, ok);
  const b = await chamar('POST', `/sessions/${S1}/messages/media`, ok);
  assert.equal(a.status, 200);
  assert.equal(a.json.providerId, b.json.providerId);
  const env = clientes.get(S1).enviados.filter((e) => e.nome);
  assert.equal(env.length, 1);
  assert.deepEqual(env[0].opcoes, { type: 'document', caption: 'segue' });

  const ambos = await chamar('POST', `/sessions/${S1}/messages/media`, { ...ok, idempotencyKey: 'm-2', url: 'https://x.invalid/a.pdf' });
  assert.equal(ambos.status, 400);
  const prefixo = await chamar('POST', `/sessions/${S1}/messages/media`, { ...ok, idempotencyKey: 'm-3', base64: 'data:application/pdf;base64,' + b64 });
  assert.equal(prefixo.status, 400);
  const imgErrada = await chamar('POST', `/sessions/${S1}/messages/media`, { ...ok, tipo: 'imagem', idempotencyKey: 'm-4' });
  assert.equal(imgErrada.status, 400);

  await chamar('POST', `/sessions/${S1}/messages/media`, { ...ok, tipo: 'audio', mime: 'audio/ogg; codecs=opus', nome: 'v.ogg', idempotencyKey: 'm-5' });
  assert.deepEqual(clientes.get(S1).enviados.at(-1).opcoes, { type: 'audio', ptt: true });
});

test('providerId do envio == id do webhook `mensagem` (deMim) == id do histórico', async () => {
  const c = clientes.get(S1);
  const env = await chamar('POST', `/sessions/${S1}/messages/text`, { to: '5511900000002', texto: 'pedido', idempotencyKey: 'id-1' });
  const providerId = env.json.providerId;
  // O WhatsApp Web devolve a mesma mensagem no onAnyMessage com `id` serializado.
  const msgEco = { id: providerId, fromMe: true, chatId: '5511900000002@c.us', to: '5511900000002@c.us', from: '5511900000000@c.us', type: 'chat', body: 'pedido', t: Math.floor(Date.now() / 1000) };
  fila.eventos.length = 0;
  await c.h.any(msgEco);
  const w = fila.de('mensagem')[0].dados;
  assert.equal(w.id, providerId);
  assert.equal(w.deMim, true);
  assert.equal(w.numero, '5511900000002');

  c.chats = [{ id: { _serialized: '5511900000002@c.us' }, isGroup: false, t: msgEco.t, contact: { name: 'Ana' } }];
  // no histórico o id pode vir como objeto {_serialized}; sai a mesma string
  c.mensagens['5511900000002@c.us'] = [{ ...msgEco, id: { _serialized: providerId, fromMe: true } }];
  fila.eventos.length = 0;
  const h = await chamar('POST', `/sessions/${S1}/historico`, { dias: 7 });
  assert.equal(h.status, 202);
  assert.ok(h.json.loteId);
  await new Promise((r) => setTimeout(r, 300));
  const lotes = fila.de('historico.lote');
  assert.equal(lotes.length, 1);
  assert.equal(lotes[0].dados.ultimo, true);
  assert.equal(lotes[0].dados.loteId, h.json.loteId);
  assert.deepEqual(lotes[0].dados.progresso, { feitos: 1, total: 1 });
  assert.equal(lotes[0].dados.chats[0].nome, 'Ana');
  assert.equal(lotes[0].dados.chats[0].mensagens[0].id, providerId);
});

test('mensagem recebida: grupo ignorado; mídia ≤ 2 MB vai inline; ack vira mensagem.status', async () => {
  const c = clientes.get(S1);
  fila.eventos.length = 0;
  await c.h.any({ id: 'false_123-456@g.us_X', isGroupMsg: true, chatId: '123-456@g.us', type: 'chat', body: 'grupo', t: 1 });
  await c.h.any({ id: 'false_status@broadcast_Y', chatId: 'status@broadcast', type: 'image', t: 1 });
  assert.equal(fila.de('mensagem').length, 0);
  await c.h.any({ id: 'false_5511900000003@c.us_Z', fromMe: false, chatId: '5511900000003@c.us', from: '5511900000003@c.us', type: 'image', body: '/9j/mini', caption: 'oi', mimetype: 'image/jpeg', size: 4, t: 5, sender: { pushname: 'Bia' } });
  const m = fila.de('mensagem')[0].dados;
  assert.equal(m.tipo, 'imagem');
  assert.equal(m.texto, 'oi');
  assert.equal(m.nomeContato, 'Bia');
  assert.equal(m.midia.mime, 'image/jpeg');
  assert.equal(Buffer.from(m.midia.base64, 'base64').toString(), 'jpeg');
  await c.h.any({ id: 'false_5511900000003@c.us_G', fromMe: false, chatId: '5511900000003@c.us', type: 'video', size: 3 * 1024 * 1024, t: 6 });
  assert.equal(fila.de('mensagem')[1].dados.midia, undefined, '> 2 MB: sem mídia');
  c.h.ack({ id: 'true_5511900000003@c.us_K', ack: 3, chatId: '5511900000003@c.us' });
  assert.deepEqual(fila.de('mensagem.status')[0].dados, { ids: ['true_5511900000003@c.us_K'], estado: 'lido' });
});

test('histórico: valida dias/maxPorChat; foto; DELETE apaga a pasta', async () => {
  assert.equal((await chamar('POST', `/sessions/${S1}/historico`, { dias: 400 })).status, 400);
  assert.equal((await chamar('POST', `/sessions/${S1}/historico`, { maxPorChat: 0 })).status, 400);
  const f = await chamar('GET', `/sessions/${S1}/foto/5511900000003`);
  assert.deepEqual(f.json, { url: null });
  const d = await chamar('DELETE', `/sessions/${S1}`);
  assert.deepEqual(d.json, { ok: true });
  assert.equal(fs.existsSync(path.join(dataDir, 'sessions', S1)), false);
  assert.equal((await chamar('GET', `/sessions/${S1}`)).status, 404);
  assert.equal(clientes.get(S1).parado, true);
});

test('DELETE durante aguardando_qr não gera "conectado" falso (regressão do teste real com Chrome)', async () => {
  fila.eventos.length = 0;
  const r = await chamar('POST', `/sessions/${S3}/start`, {});
  assert.equal(r.json.estado, 'aguardando_qr');
  await chamar('DELETE', `/sessions/${S3}`);
  await new Promise((r2) => setTimeout(r2, 50));
  const estados = fila.de('sessao.estado').filter((e) => e.sessionId === S3).map((e) => e.dados.estado);
  assert.ok(!estados.includes('conectado'), JSON.stringify(estados));
  assert.equal((await chamar('GET', `/sessions/${S3}`)).status, 404);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emLotes,
  AcumuladorLotes,
  selecionarHistorico,
  deveIgnorar,
  paraMensagemWa,
  numeroDoChat,
  chatDaMensagem,
} from '../src/mensagens.js';

const chat = (n, qtd) => ({ numero: String(n), mensagens: Array.from({ length: qtd }, (_, i) => ({ id: `m${n}-${i}` })) });

test('lotes: no máximo 20 chats', () => {
  const chats = Array.from({ length: 45 }, (_, i) => chat(i, 1));
  const lotes = emLotes(chats);
  assert.deepEqual(lotes.map((l) => l.length), [20, 20, 5]);
});

test('lotes: no máximo 2000 mensagens, chat nunca é partido', () => {
  const chats = [chat(1, 1500), chat(2, 600), chat(3, 2000), chat(4, 1)];
  const lotes = emLotes(chats);
  assert.deepEqual(lotes.map((l) => l.map((c) => c.numero)), [['1'], ['2'], ['3'], ['4']]);
  for (const l of lotes) assert.ok(l.reduce((s, c) => s + c.mensagens.length, 0) <= 2000);
});

test('acumulador incremental gera os mesmos lotes que emLotes', () => {
  const chats = Array.from({ length: 57 }, (_, i) => chat(i, (i * 137) % 700));
  const esperado = emLotes(chats);
  const acc = new AcumuladorLotes();
  const obtido = [];
  for (const c of chats) {
    const pronto = acc.adicionar(c);
    if (pronto) obtido.push(pronto);
  }
  obtido.push(acc.restante());
  assert.deepEqual(obtido, esperado);
});

test('histórico: janela de dias, limite por chat, ordem cronológica, sem duplicata/notificação, sem mídia', () => {
  const desdeSeg = 1000;
  const msgs = [
    { id: 'a', t: 1500, type: 'chat', body: 'três', fromMe: false },
    { id: 'b', t: 900, type: 'chat', body: 'velha', fromMe: false },
    { id: 'c', t: 1100, type: 'chat', body: 'um', fromMe: true },
    { id: 'c', t: 1100, type: 'chat', body: 'um', fromMe: true },
    { id: 'n', t: 1200, type: 'e2e_notification', isNotification: true },
    { id: 'd', t: 1300, type: 'image', body: '/9j/miniatura', caption: 'foto', fromMe: false, mimetype: 'image/jpeg' },
  ];
  const r = selecionarHistorico(msgs, { desdeSeg, maxPorChat: 300 });
  assert.deepEqual(r.map((m) => m.id), ['c', 'd', 'a']);
  assert.deepEqual(r[1], { id: 'd', deMim: false, texto: 'foto', tipo: 'imagem', timestamp: 1300 });
  assert.ok(!('midia' in r[1]));
  const lim = selecionarHistorico(msgs, { desdeSeg, maxPorChat: 2 });
  assert.deepEqual(lim.map((m) => m.id), ['d', 'a'], 'fica com as mais recentes');
});

test('ignora grupo, status, broadcast e notificação', () => {
  assert.equal(deveIgnorar({ chatId: '123-456@g.us', isGroupMsg: true }), true);
  assert.equal(deveIgnorar({ chatId: 'status@broadcast' }), true);
  assert.equal(deveIgnorar({ chatId: '5511900000000@c.us', broadcast: true }), true);
  assert.equal(deveIgnorar({ chatId: '5511900000000@c.us', isNotification: true }), true);
  assert.equal(deveIgnorar({ chatId: '120363000000000000@newsletter' }), true);
  assert.equal(deveIgnorar({ chatId: '5511900000000@c.us', type: 'chat' }), false);
});

test('deMim: número é o do chat (destinatário), não o próprio', () => {
  const msg = {
    id: 'true_5511900000001@c.us_3EB0AA',
    fromMe: true,
    from: '5511900000000@c.us',
    to: '5511900000001@c.us',
    chatId: { server: 'c.us', user: '5511900000001', _serialized: '5511900000001@c.us' },
    type: 'chat',
    body: 'olá',
    t: 1764000000,
  };
  const chatId = chatDaMensagem(msg);
  assert.equal(chatId, '5511900000001@c.us');
  const w = paraMensagemWa(msg, { numero: numeroDoChat(chatId) });
  assert.deepEqual(w, { id: 'true_5511900000001@c.us_3EB0AA', numero: '5511900000001', deMim: true, texto: 'olá', tipo: 'texto', timestamp: 1764000000 });
});

test('@lid sem número resolvido não vira número falso', () => {
  assert.equal(numeroDoChat('123456789012345@lid'), null);
  assert.equal(numeroDoChat('123456789012345@lid', '5511900000001@c.us'), '5511900000001');
});

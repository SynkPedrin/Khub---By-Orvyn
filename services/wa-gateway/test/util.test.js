import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  assinar,
  sessionIdValido,
  normalizarNumero,
  mascarar,
  chaveConfere,
  estadoDoAck,
  idCanonico,
  tamanhoBase64,
  tipoDaMensagem,
  textoDaMensagem,
} from '../src/util.js';
import { higienizar } from '../src/log.js';

test('assinatura = sha256= + hex(HMAC(secret, `${ts}.${corpo}`)) — CONTRATO §2', () => {
  const segredo = 'segredo-de-teste-123456';
  const ts = 1764000000;
  const corpo = JSON.stringify({ eventId: 'e1', tipo: 'mensagem', dados: { texto: 'oi' } });
  const esperado = 'sha256=' + createHmac('sha256', segredo).update(`${ts}.${corpo}`).digest('hex');
  assert.equal(assinar(segredo, ts, corpo), esperado);
  assert.match(assinar(segredo, ts, corpo), /^sha256=[0-9a-f]{64}$/);
  assert.notEqual(assinar(segredo, ts + 1, corpo), esperado, 'timestamp entra na assinatura');
  assert.notEqual(assinar(segredo, ts, corpo + ' '), esperado, 'corpo cru entra na assinatura');
});

test('sessionId: ^khub-[0-9a-f-]{36}$', () => {
  assert.equal(sessionIdValido('khub-123e4567-e89b-12d3-a456-426614174000'), true);
  assert.equal(sessionIdValido('khub-123E4567-E89B-12D3-A456-426614174000'), false, 'maiúsculas não');
  assert.equal(sessionIdValido('khub-123e4567'), false);
  assert.equal(sessionIdValido('tenant-123e4567-e89b-12d3-a456-426614174000'), false);
  assert.equal(sessionIdValido('khub-123e4567-e89b-12d3-a456-426614174000/../x'), false);
  assert.equal(sessionIdValido(undefined), false);
});

test('normalização de número: só dígitos, sem sufixo nem device', () => {
  assert.equal(normalizarNumero('+55 (11) 90000-0000'), '5511900000000');
  assert.equal(normalizarNumero('5511900000000@c.us'), '5511900000000');
  assert.equal(normalizarNumero('5511900000000:12@c.us'), '5511900000000');
  assert.equal(normalizarNumero(5511900000000), '5511900000000');
  assert.equal(normalizarNumero(null), '');
});

test('máscara de número para logs: 5511****9999', () => {
  assert.equal(mascarar('5511987659999'), '5511****9999');
  assert.equal(mascarar('5511987659999@c.us'), '5511****9999');
  assert.equal(mascarar(''), '');
  assert.ok(!mascarar('551198765').includes('98765'));
});

test('log higieniza sequências longas de dígitos', () => {
  const s = higienizar('falhou para 5511987659999@c.us');
  assert.equal(s, 'falhou para 5511****9999@c.us');
});

test('chave do gateway: comparação exata', () => {
  assert.equal(chaveConfere('abc', 'abc'), true);
  assert.equal(chaveConfere('abd', 'abc'), false);
  assert.equal(chaveConfere('ab', 'abc'), false);
  assert.equal(chaveConfere(undefined, 'abc'), false);
  assert.equal(chaveConfere('', ''), false);
});

test('ack → estado', () => {
  assert.equal(estadoDoAck(-1), 'falhou');
  assert.equal(estadoDoAck(0), null);
  assert.equal(estadoDoAck(1), 'enviado');
  assert.equal(estadoDoAck(2), 'entregue');
  assert.equal(estadoDoAck(3), 'lido');
  assert.equal(estadoDoAck(4), 'lido');
});

test('idCanonico: string ou {_serialized} viram a MESMA string', () => {
  const id = 'true_5511900000000@c.us_3EB0ABCDEF';
  assert.equal(idCanonico(id), id);
  assert.equal(idCanonico({ _serialized: id, fromMe: true }), id);
  assert.equal(idCanonico(null), null);
});

test('tamanho do base64 decodificado', () => {
  assert.equal(tamanhoBase64(Buffer.alloc(10).toString('base64')), 10);
  assert.equal(tamanhoBase64(Buffer.alloc(11).toString('base64')), 11);
  assert.equal(tamanhoBase64(Buffer.alloc(12).toString('base64')), 12);
});

test('tipo e texto da mensagem', () => {
  assert.equal(tipoDaMensagem('chat'), 'texto');
  assert.equal(tipoDaMensagem('ptt'), 'audio');
  assert.equal(tipoDaMensagem('sticker'), 'figurinha');
  assert.equal(tipoDaMensagem('location'), 'outro');
  assert.equal(textoDaMensagem({ type: 'chat', body: 'oi' }), 'oi');
  assert.equal(textoDaMensagem({ type: 'image', body: '/9j/miniatura', caption: 'legenda' }), 'legenda');
  assert.equal(textoDaMensagem({ type: 'image', body: '/9j/miniatura' }), '', 'nunca usa body de mídia (é miniatura)');
});

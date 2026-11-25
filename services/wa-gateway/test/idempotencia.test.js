import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Idempotencia, VALIDADE_MS, erroIncerto } from '../src/idempotencia.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'idem-')), 'idem.jsonl');
const S = 'khub-123e4567-e89b-12d3-a456-426614174000';

test('mesma chave envia uma vez e devolve o mesmo providerId', async () => {
  const idem = new Idempotencia(tmp());
  let chamadas = 0;
  const enviar = async () => `true_x@c.us_${++chamadas}`;
  const a = await idem.executar(S, 'k1', enviar);
  const b = await idem.executar(S, 'k1', enviar);
  assert.equal(chamadas, 1);
  assert.equal(a.providerId, b.providerId);
  assert.equal(b.repetido, true);
});

test('pedidos concorrentes com a mesma chave não enviam duas vezes', async () => {
  const idem = new Idempotencia(tmp());
  let chamadas = 0;
  const enviar = () => new Promise((r) => setTimeout(() => r(`id${++chamadas}`), 30));
  const [a, b] = await Promise.all([idem.executar(S, 'k', enviar), idem.executar(S, 'k', enviar)]);
  assert.equal(chamadas, 1);
  assert.equal(a.providerId, b.providerId);
});

test('persiste em disco e sobrevive a reinício', async () => {
  const arq = tmp();
  await new Idempotencia(arq).executar(S, 'k', async () => 'id-1');
  const outra = new Idempotencia(arq);
  let chamou = false;
  const r = await outra.executar(S, 'k', async () => {
    chamou = true;
    return 'id-2';
  });
  assert.equal(chamou, false);
  assert.equal(r.providerId, 'id-1');
});

test('expira em 24 h', async () => {
  let agora = 1_000_000;
  const arq = tmp();
  const idem = new Idempotencia(arq, { agora: () => agora });
  await idem.executar(S, 'k', async () => 'id-1');
  agora += VALIDADE_MS + 1;
  const r = await idem.executar(S, 'k', async () => 'id-2');
  assert.equal(r.providerId, 'id-2');
  // e o arquivo compactado no boot descarta entradas velhas
  agora += VALIDADE_MS + 1;
  const nova = new Idempotencia(arq, { agora: () => agora });
  assert.equal(nova.obter(S, 'k'), null);
});

test('erro "nada enviado" libera a chave; erro incerto trava a chave (nunca reenvia)', async () => {
  const idem = new Idempotencia(tmp());
  const nadaEnviado = Object.assign(new Error('x'), { status: 409, erro: 'sessao_desconectada' });
  await assert.rejects(idem.executar(S, 'a', async () => { throw nadaEnviado; }), /x/);
  const r = await idem.executar(S, 'a', async () => 'id-ok');
  assert.equal(r.providerId, 'id-ok');

  let chamadas = 0;
  await assert.rejects(idem.executar(S, 'b', async () => { chamadas++; throw erroIncerto(); }), (e) => e.status === 504);
  await assert.rejects(idem.executar(S, 'b', async () => { chamadas++; return 'id'; }), (e) => e.status === 504 && e.erro === 'aceite_incerto');
  assert.equal(chamadas, 1);
});

test('chaves são separadas por sessão', async () => {
  const idem = new Idempotencia(tmp());
  const a = await idem.executar(S, 'k', async () => 'id-a');
  const b = await idem.executar(S.replace('khub-1', 'khub-2'), 'k', async () => 'id-b');
  assert.notEqual(a.providerId, b.providerId);
});

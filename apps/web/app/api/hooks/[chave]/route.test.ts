// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

type Init = ConstructorParameters<typeof NextRequest>[1];
const chamada = (init: Init = {}, chave = 'abc123') =>
  POST(new NextRequest(`http://localhost:3000/api/hooks/${chave}`, { method: 'POST', body: '{"nome":"Ana"}', ...init }), { params: { chave } });

function apiResponde(status = 202, corpo: unknown = { recebido: true }) {
  const f = vi.fn(async () => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', f);
  return f;
}
const enviado = (f: ReturnType<typeof apiResponde>) => {
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
};

afterEach(() => vi.unstubAllGlobals());

describe('proxy público do webhook de workflow (regressão: a API exige Idempotency-Key e o proxy não repassava, então respondia sempre 400)', () => {
  it('sem Idempotency-Key do remetente: gera uma e encaminha à API', async () => {
    const f = apiResponde();
    const r = await chamada();
    const { url, headers } = enviado(f);
    expect(url).toMatch(/\/v1\/hooks\/abc123$/);
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.status).toBe(202);
  });

  it('com Idempotency-Key do remetente: repassa a MESMA chave (reenvio não duplica o evento)', async () => {
    const f = apiResponde();
    await chamada({ headers: { 'idempotency-key': 'pedido-991' } });
    expect(enviado(f).headers['idempotency-key']).toBe('pedido-991');
  });

  it('duas requisições sem chave recebem chaves diferentes (dois formulários iguais não colapsam)', async () => {
    const f = apiResponde();
    await chamada(); await chamada();
    const [a, b] = f.mock.calls.map((c) => ((c as unknown as [string, RequestInit])[1].headers as Record<string, string>)['idempotency-key']);
    expect(a).not.toBe(b);
  });

  it('trunca chave do remetente acima de 200 caracteres (limite da API)', async () => {
    const f = apiResponde();
    await chamada({ headers: { 'idempotency-key': 'x'.repeat(500) } });
    expect(enviado(f).headers['idempotency-key']).toHaveLength(200);
  });

  it('encaminha o corpo e o content-type sem alterar', async () => {
    const f = apiResponde();
    await chamada({ headers: { 'content-type': 'application/json' } });
    const { init, headers } = enviado(f);
    expect(init.body).toBe('{"nome":"Ana"}');
    expect(headers['content-type']).toBe('application/json');
  });

  it('chave com caracteres especiais é codificada no caminho (sem injeção de rota)', async () => {
    const f = apiResponde();
    await chamada({}, 'a/b?c');
    expect(enviado(f).url).toContain('/v1/hooks/a%2Fb%3Fc');
  });

  it('API fora do ar: ainda responde 202 (o remetente não deve ficar reenviando por problema nosso)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    const r = await chamada();
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ recebido: true });
  });

  it('repassa o status e o corpo de erro da API (ex.: 400 de payload inválido)', async () => {
    apiResponde(400, { title: 'payload inválido' });
    const r = await chamada();
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ title: 'payload inválido' });
  });
});

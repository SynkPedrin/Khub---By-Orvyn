// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';
import { GET as GET_DOC } from './[...slug]/route';

const req = (cookie?: string) => new NextRequest('http://localhost:3210/api/cerebro', cookie ? { headers: { cookie } } : {});

function apiMe(status: number) {
  const f = vi.fn(async () => new Response('{}', { status }));
  vi.stubGlobal('fetch', f);
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe('vault interno /api/cerebro exige sessão (regressão: servia PRD e Bugs sem login — doc 18, B-4)', () => {
  it('sem cookie de sessão: 401 e nem consulta a API', async () => {
    const f = apiMe(200);
    const r = await GET(req());
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it('com token inválido (API responde 401): 401', async () => {
    apiMe(401);
    expect((await GET(req('khub_access=forjado'))).status).toBe(401);
  });

  it('API fora do ar: falha fechada (401)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect((await GET(req('khub_access=qualquer'))).status).toBe(401);
  });

  it('documento individual também exige sessão', async () => {
    apiMe(200);
    const r = await GET_DOC(new NextRequest('http://localhost:3210/api/cerebro/PRD'), { params: { slug: ['PRD'] } });
    expect(r.status).toBe(401);
  });

  it('sessão válida: valida o token na API com Bearer e libera', async () => {
    const f = apiMe(200);
    const r = await GET(req('khub_access=token-ok'));
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/v1\/auth\/me$/);
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer token-ok');
  });
});

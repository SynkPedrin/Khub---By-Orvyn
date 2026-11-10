// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const req = (path = '/dashboard') => new NextRequest(`http://localhost:3000${path}`, { headers: { cookie: 'khub_access=tok; khub_refresh=ref' } });
const apiResponde = (status: number, corpo: unknown = {}) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(corpo), { status })));
afterEach(() => vi.unstubAllGlobals());

describe('middleware de sessão — resposta da API em /auth/me', () => {
  it('200: deixa passar', async () => {
    apiResponde(200);
    const r = await middleware(req());
    expect(r.headers.get('x-middleware-next')).toBe('1');
  });

  it('REGRESSÃO 429 (limite do tenant): a sessão é válida, então NÃO derruba a navegação com 503', async () => {
    apiResponde(429, { title: 'Muitas requisições' });
    const r = await middleware(req());
    expect(r.status).not.toBe(503);
    expect(r.headers.get('x-middleware-next')).toBe('1');
  });

  it('500 da API continua devolvendo 503 (falha real de verificação)', async () => {
    apiResponde(500);
    const r = await middleware(req());
    expect(r.status).toBe(503);
  });

  it('rota pública não consulta a API', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await middleware(req('/login'));
    expect(f).not.toHaveBeenCalled();
    expect(r.headers.get('x-middleware-next')).toBe('1');
  });
});

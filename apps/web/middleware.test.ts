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

describe('middleware de sessão: páginas públicas de formulário e agendamento (Q4.1/Q4.2)', () => {
  const anonimo = (path: string) => new NextRequest(`http://localhost:3000${path}`);
  it.each(['/f/contato-site-a1b2c3', '/f/contato-site-a1b2c3/embed', '/b/consulta-inicial', '/b/consulta-inicial/gerenciar/abc'])('%s abre sem login e sem consultar a API', async (path) => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    const r = await middleware(anonimo(path));
    expect(f).not.toHaveBeenCalled();
    expect(r.headers.get('x-middleware-next')).toBe('1');
  });
  it.each(['/formularios', '/fx', '/booking', '/agenda/paginas'])('%s continua protegida', async (path) => {
    const r = await middleware(anonimo(path));
    expect(r.status).toBe(307);
    expect(r.headers.get('location')).toContain('/login');
  });
});

import { NextRequest, NextResponse } from 'next/server';
import { API, setSession } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Retorno do provedor. Valida o `state` contra o cookie (anti-CSRF), troca o
 * `code` por uma sessão na API, seta os cookies httpOnly e leva o usuário para
 * dentro. Qualquer falha volta para /login com um motivo — nunca tela branca.
 */
export async function GET(req: NextRequest, { params }: { params: { provider: string } }) {
  const provider = params.provider;
  const { searchParams, origin } = req.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const erro = searchParams.get('error');
  const cookieState = req.cookies.get('oauth_state')?.value;

  const paraLogin = (motivo: string) => {
    const url = new URL('/login', origin);
    url.searchParams.set('erro', motivo);
    const res = NextResponse.redirect(url);
    res.cookies.set('oauth_state', '', { path: '/', maxAge: 0 });
    return res;
  };

  if (erro) return paraLogin('oauth_cancelado');
  if (!code || !state || !cookieState || state !== cookieState) return paraLogin('oauth_estado');

  const r = await fetch(`${API}/v1/auth/oauth/callback`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider, code }),
    cache: 'no-store',
  }).catch(() => null);
  const data = await r?.json().catch(() => null);
  if (!r || !r.ok || !data?.access) return paraLogin('oauth_falhou');

  const res = NextResponse.redirect(new URL('/', origin));
  setSession(res, data.access, data.refresh);
  res.cookies.set('oauth_state', '', { path: '/', maxAge: 0 });
  return res;
}

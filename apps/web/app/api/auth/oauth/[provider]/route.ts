import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { API } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Início do login social: gera um `state` (anti-CSRF), guarda num cookie httpOnly
 * e redireciona o navegador para a tela de consentimento do provedor. A URL de
 * consentimento vem da API (que tem o client_id e valida o gating).
 */
export async function GET(_req: Request, { params }: { params: { provider: string } }) {
  const provider = params.provider;
  if (provider !== 'google' && provider !== 'github') {
    return NextResponse.json({ title: 'provedor inválido' }, { status: 400 });
  }

  const state = randomBytes(16).toString('hex');
  const r = await fetch(`${API}/v1/auth/oauth/${provider}/url?state=${state}`, { cache: 'no-store' }).catch(() => null);
  const data = await r?.json().catch(() => null);
  if (!r || !r.ok || !data?.url) {
    // sem credenciais a API responde 501 config_required — repassa explícito
    return NextResponse.json(data ?? { title: 'OAuth indisponível' }, { status: r?.status ?? 502 });
  }

  const res = NextResponse.redirect(data.url);
  res.cookies.set('oauth_state', state, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 600 });
  return res;
}

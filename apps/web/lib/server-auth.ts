import type { NextResponse } from 'next/server';

// ORVYN_API_URL: nome legado (rebrand KHUB, ADR-0041). Mantido como fallback até
// os ambientes (Vercel, .env.local, scripts de QA) passarem a definir KHUB_API_URL.
export const API = process.env.KHUB_API_URL ?? process.env.ORVYN_API_URL ?? 'http://localhost:3333';
export const ACCESS = 'khub_access';
export const REFRESH = 'khub_refresh';

const secure = process.env.NODE_ENV === 'production';

export function setSession(res: NextResponse, access: string, refresh: string): void {
  res.cookies.set(ACCESS, access, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 15 });
  res.cookies.set(REFRESH, refresh, { httpOnly: true, sameSite: 'lax', secure, path: '/', maxAge: 60 * 60 * 24 * 30 });
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(ACCESS, '', { path: '/', maxAge: 0 });
  res.cookies.set(REFRESH, '', { path: '/', maxAge: 0 });
}

/**
 * Sessão válida? Valida o access token NA API (mesma checagem do middleware),
 * para rotas `/api/*` que o middleware não cobre. Falha fechada: sem cookie,
 * token inválido ou API fora do ar → não autorizado.
 */
export async function sessaoValida(cookies: { get(nome: string): { value: string } | undefined }): Promise<boolean> {
  const access = cookies.get(ACCESS)?.value;
  if (!access) return false;
  try {
    const r = await fetch(`${API}/v1/auth/me`, { headers: { authorization: `Bearer ${access}` }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch {
    return false;
  }
}

/** Resposta 401 no formato RFC 7807. */
export const NAO_AUTENTICADO = { type: 'urn:khub:error:unauthorized', title: 'Sessão necessária', status: 401 } as const;


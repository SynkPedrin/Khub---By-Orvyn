import { NextResponse, type NextRequest } from 'next/server';
import { API, REFRESH, clearSession, setSession } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rt = req.cookies.get(REFRESH)?.value;
  if (!rt) return NextResponse.json({ title: 'sem sessão' }, { status: 401 });
  const r = await fetch(`${API}/v1/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh: rt }), cache: 'no-store' }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível' }, { status: 502 });
  const data = await r.json();
  if (!r.ok) {
    const res = NextResponse.json({ title: 'sessão expirada' }, { status: 401 });
    clearSession(res);
    return res;
  }
  const res = NextResponse.json({ ok: true });
  setSession(res, data.access, data.refresh);
  return res;
}

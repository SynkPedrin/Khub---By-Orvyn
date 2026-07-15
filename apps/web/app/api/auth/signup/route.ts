import { NextResponse } from 'next/server';
import { API, setSession } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.text();
  const r = await fetch(`${API}/v1/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, cache: 'no-store' }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível' }, { status: 502 });
  const data = await r.json();
  if (!r.ok) return NextResponse.json(data, { status: r.status });
  const res = NextResponse.json({ user: data.user });
  setSession(res, data.access, data.refresh);
  return res;
}

import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return NextResponse.json({ title: 'sem sessão' }, { status: 401 });
  const r = await fetch(`${API}/v1/auth/me`, { headers: { authorization: `Bearer ${at}` }, cache: 'no-store' }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível' }, { status: 502 });
  const data = await r.json();
  return NextResponse.json(data, { status: r.status });
}

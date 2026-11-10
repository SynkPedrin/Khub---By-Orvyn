import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

// Troca o cookie httpOnly por um ticket curto de socket (ADR-0011): o JS do
// browser nunca vê o access token, só o ticket de 60s.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return NextResponse.json({ title: 'não autenticado' }, { status: 401 });

  const r = await fetch(`${API}/v1/auth/ws-ticket`, {
    method: 'POST',
    headers: { authorization: `Bearer ${at}`, 'content-type': 'application/json' },
    cache: 'no-store',
  }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível' }, { status: 502 });

  const data = await r.json().catch(() => ({}));
  return NextResponse.json(data, { status: r.status });
}

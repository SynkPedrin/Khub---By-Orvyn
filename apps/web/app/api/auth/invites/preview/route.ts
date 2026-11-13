import { NextResponse } from 'next/server';
import { API } from '@/lib/server-auth';

// Pré-visualização do convite (público): para qual empresa e com qual e-mail
// a pessoa vai entrar. O token vai no corpo, não na URL.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const r = await fetch(`${API}/v1/auth/invites/preview`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: await req.text(),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível' }, { status: 502 });
  return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
}

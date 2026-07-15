import { NextResponse, type NextRequest } from 'next/server';
import { API, REFRESH, clearSession } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const rt = req.cookies.get(REFRESH)?.value;
  if (rt) {
    await fetch(`${API}/v1/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh: rt }) }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true });
  clearSession(res);
  return res;
}

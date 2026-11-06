import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API, setSession } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Diferente do proxy genérico `/api/v1/[...path]` (que só repassa a
 * resposta): esta rota precisa TROCAR os cookies de sessão pelos novos
 * tokens que `AgencyService.ativarCliente` emite — mesmo padrão de
 * `login/route.ts`, sem senha, sem impersonation (a identidade continua a
 * mesma; só o tenant do JWT muda).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return NextResponse.json({ title: 'não autenticado', status: 401 }, { status: 401 });

  const r = await fetch(`${API}/v1/agency/clients/${encodeURIComponent(params.id)}/activate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${at}`, 'user-agent': req.headers.get('user-agent') ?? '' },
    cache: 'no-store',
  }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível' }, { status: 502 });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) return NextResponse.json(data, { status: r.status });

  const res = NextResponse.json({ user: data.user });
  setSession(res, data.access, data.refresh);
  return res;
}

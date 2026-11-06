import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

// Proxy do front -> API NestJS. Encaminha o access token da sessão (cookie
// httpOnly) como Bearer; o tenant é derivado do JWT no back (invariante 3).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function forward(req: NextRequest, path: string[]) {
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return NextResponse.json({ title: 'não autenticado', status: 401 }, { status: 401 });

  const url = new URL(req.url);
  const target = `${API}/v1/crm/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${at}`, ...(req.headers.get('idempotency-key') ? {'idempotency-key': req.headers.get('idempotency-key')!} : {}) },
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text();

  try {
    const res = await fetch(target, init);
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
  } catch {
    return NextResponse.json({ title: 'API indisponível', status: 502, detail: `Não consegui falar com ${API}.` }, { status: 502 });
  }
}

type Ctx = { params: { path: string[] } };
export const GET = (req: NextRequest, { params }: Ctx) => forward(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => forward(req, params.path);
export const PATCH = (req: NextRequest, { params }: Ctx) => forward(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => forward(req, params.path);

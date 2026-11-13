import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

// Proxy autenticado genérico: /api/v1/<x> -> API NestJS /v1/<x> com Bearer da sessão.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function forward(req: NextRequest, path: string[]) {
  const at = req.cookies.get(ACCESS)?.value;
  const provided = req.headers.get('x-api-key') ?? req.headers.get('authorization')?.replace(/^Bearer /, '');
  const apiKey = provided?.startsWith('orv_live_') ? provided : undefined;
  if (!at && !apiKey) return NextResponse.json({ title: 'não autenticado', status: 401 }, { status: 401 });
  const url = new URL(req.url);
  const target = `${API}/v1/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey ?? at}`, ...(req.headers.get('idempotency-key') ? {'idempotency-key': req.headers.get('idempotency-key')!} : {}) },
    cache: 'no-store',
    // Análise de criativo com visão (imagem/frames) leva ~1 min num modelo
    // local, e o chat da NICO roda várias tools por resposta; o resto da API segue com 25 s.
    signal: AbortSignal.timeout(['ads/simulador/analisar', 'nyro/chat'].includes(path.join('/')) ? 180_000 : 25_000),
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text();
  try {
    const res = await fetch(target, init);
    const body = await res.text();
    return new NextResponse(body, { status: res.status, headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' } });
  } catch {
    return NextResponse.json({ title: 'API indisponível', status: 502 }, { status: 502 });
  }
}

type Ctx = { params: { path: string[] } };
export const GET = (req: NextRequest, { params }: Ctx) => forward(req, params.path);
export const POST = (req: NextRequest, { params }: Ctx) => forward(req, params.path);
export const PATCH = (req: NextRequest, { params }: Ctx) => forward(req, params.path);
export const DELETE = (req: NextRequest, { params }: Ctx) => forward(req, params.path);

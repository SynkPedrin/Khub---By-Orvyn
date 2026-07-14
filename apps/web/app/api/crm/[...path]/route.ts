import { NextResponse } from 'next/server';

// Proxy do front -> API NestJS, injetando o tenant da sessão server-side.
// Dev: tenant fixo semeado. Produção: virá do JWT/sessão (F0-11).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const API = process.env.ORVYN_API_URL ?? 'http://localhost:3333';
const TENANT = process.env.ORVYN_TENANT_ID ?? 'a0000000-0000-4000-8000-000000000001';

async function forward(req: Request, path: string[]) {
  const url = new URL(req.url);
  const target = `${API}/v1/crm/${path.map(encodeURIComponent).join('/')}${url.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { 'content-type': 'application/json', 'x-tenant-id': TENANT },
    cache: 'no-store',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') init.body = await req.text();

  try {
    const res = await fetch(target, init);
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return NextResponse.json(
      { type: 'https://orvyn.dev/errors/502', title: 'API indisponível', status: 502, detail: `Não consegui falar com ${API}. A API (apps/api) está rodando?` },
      { status: 502 },
    );
  }
}

type Ctx = { params: { path: string[] } };
export const GET = (req: Request, { params }: Ctx) => forward(req, params.path);
export const POST = (req: Request, { params }: Ctx) => forward(req, params.path);
export const PATCH = (req: Request, { params }: Ctx) => forward(req, params.path);
export const DELETE = (req: Request, { params }: Ctx) => forward(req, params.path);

import { NextResponse } from 'next/server';
import { API } from '@/lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxy público de "esqueci minha senha" (ADR-0042). Lista fechada de ações:
 * nada além de status/forgot/reset atravessa. Sem cookie, sem sessão.
 */
const ACOES = { status: 'GET', forgot: 'POST', reset: 'POST' } as const;
type Acao = keyof typeof ACOES;

async function encaminhar(req: Request, acao: string, metodo: 'GET' | 'POST') {
  if (!(acao in ACOES) || ACOES[acao as Acao] !== metodo) return NextResponse.json({ title: 'não encontrado', status: 404 }, { status: 404 });
  const r = await fetch(`${API}/v1/auth/password/${acao}`, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: metodo === 'POST' ? await req.text() : undefined,
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return NextResponse.json({ title: 'API indisponível', status: 502 }, { status: 502 });
  return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
}

type Ctx = { params: { acao: string } };
export const GET = (req: Request, { params }: Ctx) => encaminhar(req, params.acao, 'GET');
export const POST = (req: Request, { params }: Ctx) => encaminhar(req, params.acao, 'POST');

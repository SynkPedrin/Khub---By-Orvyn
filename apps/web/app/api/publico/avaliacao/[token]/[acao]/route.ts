import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

// Proxy PÚBLICO (sem sessão) do link curto de avaliação `/r/:token` (Q4.4).
// Só três ações, token validado no formato antes de sair daqui. Repassa o
// User-Agent (robô de pré-visualização não conta clique) e o IP do visitante,
// autenticado pelo segredo do proxy quando configurado (KHUB_PROXY_SECRET).
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACOES = new Set(['abrir', 'nota', 'feedback']);
const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;

type Ctx = { params: { token: string; acao: string } };

export async function POST(req: NextRequest, { params }: Ctx) {
  if (!ACOES.has(params.acao) || !TOKEN.test(params.token)) return NextResponse.json({ title: 'link inválido', status: 404 }, { status: 404 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.ip ?? '';
  const segredo = process.env.KHUB_PROXY_SECRET;
  const corpo = params.acao === 'abrir' ? '{}' : (await req.text()).slice(0, 4000);
  try {
    const r = await fetch(`${API}/v1/public/avaliacoes/${params.token}/${params.acao}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': req.headers.get('user-agent') ?? '',
        ...(segredo && ip ? { 'x-khub-proxy-secret': segredo, 'x-khub-client-ip': ip } : {}),
      },
      body: corpo,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
  } catch {
    return NextResponse.json({ title: 'Serviço indisponível', status: 502 }, { status: 502 });
  }
}

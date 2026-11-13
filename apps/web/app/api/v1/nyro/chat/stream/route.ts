import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

// Chat da NICO com streaming (SSE). O proxy genérico /api/v1/[...path] guarda a
// resposta inteira em memória (`res.text()`) e corta em 25 s: serve para JSON
// curto, não para uma agente que trabalha por minutos e mostra o progresso.
// Esta rota é mais específica, então o Next a escolhe no lugar do proxy genérico.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return NextResponse.json({ title: 'não autenticado', status: 401 }, { status: 401 });
  try {
    const upstream = await fetch(`${API}/v1/nyro/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${at}` },
      body: await req.text(),
      cache: 'no-store',
      // fechar a aba cancela a chamada à API; 5 min é o teto de uma resposta
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(300_000)]),
    });
    // erro antes de abrir o stream (401, 501 config_required, 400): devolve como JSON, com o status real
    if (!upstream.ok || !upstream.body) {
      return new NextResponse(await upstream.text(), { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' } });
    }
    return new Response(upstream.body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', 'x-accel-buffering': 'no' },
    });
  } catch {
    return NextResponse.json({ title: 'API indisponível', status: 502 }, { status: 502 });
  }
}

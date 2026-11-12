import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';
import { cabecalhosParaApi, caminhoPublicoPermitido } from '@/lib/publico/proxy';

/**
 * Proxy PÚBLICO das páginas /f (formulário) e /b (agendamento): sem cookie,
 * sem Bearer. Só os caminhos da lista em `lib/publico/proxy.ts`, só GET/POST,
 * corpo até 64 KB. O tenant nunca vem daqui: a API resolve pelo slug/token.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_CORPO = 64 * 1024;

async function repassar(req: NextRequest, path: string[], metodo: 'GET' | 'POST') {
  const caminho = path.join('/');
  if (!caminhoPublicoPermitido(caminho)) return NextResponse.json({ title: 'Não encontrado', status: 404 }, { status: 404 });
  const url = new URL(req.url);
  const init: RequestInit = { method: metodo, cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: cabecalhosParaApi(req.headers, metodo === 'POST' ? { 'content-type': 'application/json' } : {}) };
  if (metodo === 'POST') {
    const corpo = await req.text();
    if (corpo.length > MAX_CORPO) return NextResponse.json({ title: 'Envio grande demais', status: 413 }, { status: 413 });
    init.body = corpo;
  }
  try {
    const r = await fetch(`${API}/v1/public/${caminho}${metodo === 'GET' ? url.search : ''}`, init);
    const headers: Record<string, string> = { 'content-type': r.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' };
    const disp = r.headers.get('content-disposition');
    if (disp) headers['content-disposition'] = disp;
    const retry = r.headers.get('retry-after');
    if (retry) headers['retry-after'] = retry;
    return new NextResponse(await r.arrayBuffer(), { status: r.status, headers });
  } catch {
    return NextResponse.json({ title: 'Serviço indisponível. Tente de novo em instantes.', status: 503 }, { status: 503 });
  }
}

type Ctx = { params: { path: string[] } };
export const GET = (req: NextRequest, { params }: Ctx) => repassar(req, params.path, 'GET');
export const POST = (req: NextRequest, { params }: Ctx) => repassar(req, params.path, 'POST');

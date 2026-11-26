import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

/**
 * Imagem/PDF de uma aprovação. O proxy genérico (/api/v1) lê a resposta como
 * texto e quebraria o binário; aqui o corpo passa intacto, com a sessão do cookie.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string; arquivoId: string } }) {
  if (!UUID.test(params.id) || !UUID.test(params.arquivoId)) return NextResponse.json({ title: 'não encontrado' }, { status: 404 });
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return NextResponse.json({ title: 'não autenticado' }, { status: 401 });
  try {
    const r = await fetch(`${API}/v1/aprovacoes/${params.id}/arquivos/${params.arquivoId}`, { headers: { authorization: `Bearer ${at}` }, cache: 'no-store', signal: AbortSignal.timeout(25_000) });
    if (!r.ok) return new NextResponse(await r.text(), { status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' } });
    const corpo = await r.arrayBuffer();
    const headers: Record<string, string> = {
      'content-type': r.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff',
    };
    const disp = r.headers.get('content-disposition');
    if (disp) headers['content-disposition'] = disp;
    return new NextResponse(corpo, { status: 200, headers });
  } catch {
    return NextResponse.json({ title: 'API indisponível' }, { status: 502 });
  }
}

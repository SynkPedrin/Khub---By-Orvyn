import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS, API } from '@/lib/server-auth';

// Foto de perfil durável do contato (db/066): binário da API com a sessão do
// cookie. O proxy genérico /api/v1 lê o corpo como texto e corromperia a imagem.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const at = req.cookies.get(ACCESS)?.value;
  if (!at) return new NextResponse(null, { status: 401 });
  if (!UUID.test(params.id)) return new NextResponse(null, { status: 404 });
  const r = await fetch(`${API}/v1/crm/contacts/${params.id}/foto`, { headers: { authorization: `Bearer ${at}` }, cache: 'no-store', signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!r || !r.ok) return new NextResponse(null, { status: r?.status === 401 ? 401 : 404 });
  const tipo = r.headers.get('content-type') ?? '';
  if (!/^image\/(jpeg|png|webp)$/.test(tipo)) return new NextResponse(null, { status: 404 });
  return new NextResponse(await r.arrayBuffer(), {
    status: 200,
    // `?v=` muda quando a foto muda: dá para cachear forte no navegador.
    headers: { 'content-type': tipo, 'cache-control': 'private, max-age=86400', 'x-content-type-options': 'nosniff' },
  });
}

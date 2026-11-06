import { NextResponse, type NextRequest } from 'next/server';
import { getDoc } from '@/lib/cerebro';
import { NAO_AUTENTICADO, sessaoValida } from '@/lib/server-auth';

// Backend: um documento do cérebro. GET /api/cerebro/PRD  ou  /api/cerebro/RAG/RAG
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Vault interno (PRD, bugs): só com sessão válida (doc 18, B-4).
export async function GET(req: NextRequest, { params }: { params: { slug: string[] } }) {
  if (!(await sessaoValida(req.cookies))) return NextResponse.json(NAO_AUTENTICADO, { status: 401, headers: { 'content-type': 'application/problem+json' } });
  const segments = (params.slug ?? []).map((s) => decodeURIComponent(s));
  const doc = getDoc(segments);
  if (!doc) {
    return NextResponse.json(
      {
        type: 'https://orvyn.dev/errors/not-found',
        title: 'Documento não encontrado',
        status: 404,
        detail: `Nenhum documento em '${segments.join('/')}'.`,
      },
      { status: 404, headers: { 'content-type': 'application/problem+json' } },
    );
  }
  return NextResponse.json(doc);
}

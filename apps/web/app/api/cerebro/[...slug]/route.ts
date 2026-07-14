import { NextResponse } from 'next/server';
import { getDoc } from '@/lib/cerebro';

// Backend: um documento do cérebro. GET /api/cerebro/PRD  ou  /api/cerebro/RAG/RAG
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: { slug: string[] } }) {
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

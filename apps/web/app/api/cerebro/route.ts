import { NextResponse, type NextRequest } from 'next/server';
import { listDocs } from '@/lib/cerebro';
import { NAO_AUTENTICADO, sessaoValida } from '@/lib/server-auth';

// Backend: índice do cérebro. GET /api/cerebro
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Vault interno (PRD, bugs): só com sessão válida (doc 18, B-4).
export async function GET(req: NextRequest) {
  if (!(await sessaoValida(req.cookies))) return NextResponse.json(NAO_AUTENTICADO, { status: 401, headers: { 'content-type': 'application/problem+json' } });
  const docs = listDocs();
  const categories = [...new Set(docs.map((d) => d.category))];
  return NextResponse.json({ count: docs.length, categories, docs });
}

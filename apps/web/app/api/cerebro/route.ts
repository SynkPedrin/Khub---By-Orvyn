import { NextResponse } from 'next/server';
import { listDocs } from '@/lib/cerebro';

// Backend: índice do cérebro. GET /api/cerebro
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const docs = listDocs();
  const categories = [...new Set(docs.map((d) => d.category))];
  return NextResponse.json({ count: docs.length, categories, docs });
}

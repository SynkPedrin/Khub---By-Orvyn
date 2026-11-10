import { NextResponse } from 'next/server';
import { cerebroInfo, listDocs } from '@/lib/cerebro';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const info = cerebroInfo();
  return NextResponse.json({
    status: 'ok',
    service: 'khub-web',
    backend: 'cerebro-obsidian',
    cerebroExists: info.exists,
    docs: info.exists ? listDocs().length : 0,
    ts: new Date().toISOString(),
  });
}

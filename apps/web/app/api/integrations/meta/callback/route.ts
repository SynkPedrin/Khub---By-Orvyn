import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

// Landing do OAuth Meta (browser redirecionado pelo provider). Completa no Nest
// (público, state carrega o tenant) e volta pro /marketing/ads.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error_description') || url.searchParams.get('error');
  const web = process.env.WEB_URL ?? 'http://localhost:3210';

  if (err || !code || !state) {
    return NextResponse.redirect(`${web}/marketing/ads?error=${encodeURIComponent(err || 'callback inválido')}`);
  }
  try {
    const r = await fetch(`${API}/v1/integrations/meta/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      return NextResponse.redirect(`${web}/marketing/ads?error=${encodeURIComponent(d.detail || d.title || 'falha ao conectar')}`);
    }
    return NextResponse.redirect(`${web}/marketing/ads?connected=meta`);
  } catch {
    return NextResponse.redirect(`${web}/marketing/ads?error=api_indisponivel`);
  }
}

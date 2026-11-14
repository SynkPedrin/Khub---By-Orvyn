import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

// Landing do OAuth da Presença Google (Tag Manager, Search Console, Meu
// Negócio). O browser volta do Google com code + state; completamos no Nest
// (rota pública, o state assinado carrega o tenant) e voltamos para a tela.
// Este caminho é o redirect URI que precisa estar cadastrado no Google Cloud:
// {WEB_URL}/api/integrations/google/callback
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error_description') || url.searchParams.get('error');
  const web = (process.env.WEB_URL ?? 'http://localhost:3210').replace(/\/+$/, '');
  const destino = `${web}/marketing/google`;

  if (err || !code || !state) {
    const motivo = err === 'access_denied' ? 'Você cancelou a autorização no Google.' : err || 'Retorno do Google inválido.';
    return NextResponse.redirect(`${destino}?erro=${encodeURIComponent(motivo)}`);
  }
  try {
    const r = await fetch(`${API}/v1/google/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { title?: string; detail?: string };
      return NextResponse.redirect(`${destino}?erro=${encodeURIComponent(d.detail || d.title || 'Não consegui concluir a conexão com o Google.')}`);
    }
    return NextResponse.redirect(`${destino}?conectado=1`);
  } catch {
    return NextResponse.redirect(`${destino}?erro=${encodeURIComponent('API indisponível. Tente de novo.')}`);
  }
}

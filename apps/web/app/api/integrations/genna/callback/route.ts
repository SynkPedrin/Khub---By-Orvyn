import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

// Landing do OAuth do Genna (ADR-0053). O browser volta do Genna com code +
// state; completamos no Nest (rota pública, o state assinado carrega o tenant
// e o verificador PKCE cifrado) e voltamos para o painel.
// Redirect URI cadastrado no Genna por cadastro dinâmico:
// {WEB_URL}/api/integrations/genna/callback
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error_description') || url.searchParams.get('error');
  const destino = `${url.origin}/marketing/genna`;

  if (err || !code || !state) {
    const motivo = err === 'access_denied' ? 'Você cancelou a autorização no Genna.' : err || 'Retorno do Genna inválido.';
    return NextResponse.redirect(`${destino}?erro=${encodeURIComponent(motivo)}`);
  }
  try {
    const r = await fetch(`${API}/v1/genna/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
    });
    if (!r.ok) {
      const d = (await r.json().catch(() => ({}))) as { title?: string; detail?: string };
      return NextResponse.redirect(`${destino}?erro=${encodeURIComponent(d.detail || d.title || 'Não consegui concluir a conexão com o Genna.')}`);
    }
    return NextResponse.redirect(`${destino}?conectado=1`);
  } catch {
    return NextResponse.redirect(`${destino}?erro=${encodeURIComponent('API indisponível. Tente de novo.')}`);
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

// Volta do OAuth de uma rede social (Meta: Instagram; Google: YouTube; TikTok
// Login Kit). Completa no Nest (rota pública, o tenant vem do `state`
// assinado) e devolve o usuário para /redes na aba da rede.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDES = new Set(['instagram', 'youtube', 'tiktok']);

export async function GET(req: NextRequest, { params }: { params: { rede: string } }) {
  const url = new URL(req.url);
  const web = process.env.WEB_URL ?? 'http://localhost:3210';
  const rede = params.rede;
  const voltar = (q: Record<string, string>) => NextResponse.redirect(`${web}/redes?${new URLSearchParams({ rede: REDES.has(rede) ? rede : 'instagram', ...q }).toString()}`);
  if (!REDES.has(rede)) return voltar({ erro: 'rede desconhecida' });
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const erro = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (erro || !code || !state) return voltar({ erro: erro || 'a conexão foi cancelada' });
  try {
    const r = await fetch(`${API}/v1/integrations/redes/${rede}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    const d = (await r.json().catch(() => ({}))) as { detail?: string; title?: string; conectadas?: number; avisos?: string[] };
    if (!r.ok) return voltar({ erro: d.detail || d.title || 'falha ao conectar' });
    return voltar({ conectado: '1', contas: String(d.conectadas ?? 0), ...(d.avisos?.length ? { aviso: d.avisos.join(' ') } : {}) });
  } catch {
    return voltar({ erro: 'API indisponível' });
  }
}

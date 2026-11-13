import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

// Volta do OAuth de um canal de Conversas (Meta: Instagram/Messenger; Google:
// YouTube). Completa no Nest (rota pública, o tenant vem do `state` assinado)
// e devolve o usuário para /conversas com o painel de canais aberto.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PROVEDORES = new Set(['meta', 'youtube']);

export async function GET(req: NextRequest, { params }: { params: { provedor: string } }) {
  const url = new URL(req.url);
  const web = process.env.WEB_URL ?? 'http://localhost:3210';
  const voltar = (q: Record<string, string>) => NextResponse.redirect(`${web}/conversas?${new URLSearchParams({ canais: '1', ...q }).toString()}`);
  const provedor = params.provedor;
  if (!PROVEDORES.has(provedor)) return voltar({ erro: 'rede desconhecida' });
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const erro = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (erro || !code || !state) return voltar({ erro: erro || 'a conexão foi cancelada' });
  try {
    const r = await fetch(`${API}/v1/integrations/canais/${provedor}/callback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, state }),
      cache: 'no-store',
      signal: AbortSignal.timeout(25_000),
    });
    const d = (await r.json().catch(() => ({}))) as { detail?: string; title?: string; conectadas?: number; avisos?: string[] };
    if (!r.ok) return voltar({ erro: d.detail || d.title || 'falha ao conectar' });
    return voltar({ conectado: provedor, contas: String(d.conectadas ?? 0), ...(d.avisos?.length ? { aviso: d.avisos.join(' ') } : {}) });
  } catch {
    return voltar({ erro: 'API indisponível' });
  }
}

import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/server-auth';

/**
 * Entrada pública de webhook do workflow (gatilho "Webhook recebido").
 *
 * Fica no domínio do front de propósito: o cliente cola UMA URL no
 * site/formulário dele e não precisa saber que existe uma API separada.
 * Sem autenticação — a chave da URL é a credencial (ver ADR-0013).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { chave: string } }) {
  const corpo = await req.text();

  // Repasse fiel (W5): a API deduplica pela Idempotency-Key do remetente e, sem
  // ela, pelo conteúdo numa janela de 10 min — por isso NÃO inventamos uma chave
  // aqui. A assinatura X-KHUB-Signature vai junto e o corpo segue byte a byte
  // (o HMAC é calculado sobre ele).
  const headers: Record<string, string> = { 'content-type': req.headers.get('content-type') ?? 'application/json' };
  const chave = req.headers.get('idempotency-key');
  // Sem cortar: a API recusa > 200 com 400; cortar aqui faria chaves longas diferentes colidirem.
  if (chave) headers['idempotency-key'] = chave;
  const assinatura = req.headers.get('x-khub-signature');
  if (assinatura) headers['x-khub-signature'] = assinatura;

  const r = await fetch(`${API}/v1/hooks/${encodeURIComponent(params.chave)}`, {
    method: 'POST',
    headers,
    body: corpo,
    cache: 'no-store',
  }).catch(() => null);

  // Sem confirmação durável, o remetente deve poder tentar novamente.
  if (!r) return NextResponse.json({ recebido: false, erro: 'Serviço temporariamente indisponível' }, { status: 503, headers: { 'Retry-After': '30' } });

  const dados = await r.json().catch(() => ({ recebido: true }));
  return NextResponse.json(dados, { status: r.status });
}

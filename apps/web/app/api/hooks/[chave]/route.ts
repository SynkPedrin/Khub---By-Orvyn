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

  const r = await fetch(`${API}/v1/hooks/${encodeURIComponent(params.chave)}`, {
    method: 'POST',
    headers: {
      'content-type': req.headers.get('content-type') ?? 'application/json',
      // A API deduplica por Idempotency-Key. Se o remetente manda a dele, ela vale
      // (retries não duplicam); sem ela geramos uma por requisição, pois dois
      // envios idênticos legítimos (ex.: 2 formulários iguais) não podem colapsar.
      'idempotency-key': req.headers.get('idempotency-key')?.slice(0, 200) || crypto.randomUUID(),
    },
    body: corpo,
    cache: 'no-store',
  }).catch(() => null);

  // 202 mesmo quando a API está fora: quem chama (site/ERP) não deve ficar
  // tentando de novo por um problema nosso, e o evento não some — o remetente
  // recebe confirmação e o erro fica no nosso log.
  if (!r) return NextResponse.json({ recebido: true }, { status: 202 });

  const dados = await r.json().catch(() => ({ recebido: true }));
  return NextResponse.json(dados, { status: r.status });
}

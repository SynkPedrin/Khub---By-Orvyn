import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificação do webhook de conta da Stevo — mesma semântica do `verifyWebhook`
 * do SDK oficial `stevo-sdk` (lido do pacote, não reimplementado de memória):
 *
 *   X-Stevo-Signature: sha256=<hex>
 *   assinatura = HMAC-SHA256(secret, `${X-Stevo-Timestamp}.${corpoCru}`)
 *   tolerância padrão: 300 s entre o timestamp e o relógio (anti-replay)
 *
 * Durante a rotação a Stevo envia também `X-Stevo-Signature-Previous` (assinada
 * com o segredo anterior). Aceitamos qualquer combinação de (segredo atual ou
 * anterior) × (assinatura atual ou anterior) — cobre os dois lados da troca.
 */
export const TOLERANCIA_SEGUNDOS = 300;

export type MotivoRecusa = 'sem_segredo' | 'malformado' | 'expirado' | 'assinatura_invalida';

export function verificarAssinaturaStevo(input: {
  corpoCru: Buffer | undefined;
  timestamp: string | undefined;
  assinaturas: (string | undefined)[];
  segredos: (string | undefined)[];
  agoraSegundos?: number;
  toleranciaSegundos?: number;
}): { ok: true } | { ok: false; motivo: MotivoRecusa } {
  const segredos = input.segredos.filter((s): s is string => !!s);
  if (!segredos.length) return { ok: false, motivo: 'sem_segredo' };

  const ts = input.timestamp;
  if (!input.corpoCru || !ts || !/^\d+$/.test(ts)) return { ok: false, motivo: 'malformado' };
  const hexes = input.assinaturas
    .filter((a): a is string => typeof a === 'string' && a.length > 0)
    .map((a) => (a.startsWith('sha256=') ? a.slice(7) : a))
    .filter((h) => /^[0-9a-f]{64}$/i.test(h));
  if (!hexes.length) return { ok: false, motivo: 'malformado' };

  const agora = input.agoraSegundos ?? Math.floor(Date.now() / 1000);
  if (Math.abs(agora - Number(ts)) > (input.toleranciaSegundos ?? TOLERANCIA_SEGUNDOS)) return { ok: false, motivo: 'expirado' };

  const conteudo = Buffer.concat([Buffer.from(`${ts}.`), input.corpoCru]);
  for (const segredo of segredos) {
    const esperado = createHmac('sha256', segredo).update(conteudo).digest();
    for (const hex of hexes) {
      const recebido = Buffer.from(hex, 'hex');
      if (recebido.length === esperado.length && timingSafeEqual(recebido, esperado)) return { ok: true };
    }
  }
  return { ok: false, motivo: 'assinatura_invalida' };
}

/** Gera a assinatura (fixtures de teste e script de verificação). */
export function assinarStevo(segredo: string, timestamp: string, corpoCru: Buffer | string): string {
  return `sha256=${createHmac('sha256', segredo).update(Buffer.concat([Buffer.from(`${timestamp}.`), Buffer.isBuffer(corpoCru) ? corpoCru : Buffer.from(corpoCru)])).digest('hex')}`;
}

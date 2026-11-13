import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { capacidadeValida, type CapacidadeGoogle } from './google-escopos';

/**
 * State assinado do OAuth da Presença Google. Mesmo desenho do fluxo Meta
 * (integrations.service.ts): corpo JSON em base64url + HMAC-SHA256, validade
 * de 10 minutos, comparação em tempo constante. O tenant viaja no state porque
 * o callback é público (o browser volta do Google sem a nossa sessão de API).
 * Funções puras com o segredo como parâmetro, para teste unitário direto.
 */
export interface EstadoGoogle {
  tenantId: string;
  identityId: string | null;
  capacidade: CapacidadeGoogle;
  /** Marca de propósito: um state de outro fluxo (Meta, YouTube) nunca vale aqui. */
  fluxo: 'google_presenca';
  nonce: string;
  ts: number;
}

export const VALIDADE_STATE_MS = 10 * 60_000;

export class EstadoInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EstadoInvalidoError';
  }
}

function assinatura(corpo: string, segredo: string): string {
  return createHmac('sha256', segredo).update(corpo).digest('base64url');
}

export function assinarEstado(
  dados: { tenantId: string; identityId: string | null; capacidade: CapacidadeGoogle },
  segredo: string,
  agora: number = Date.now(),
): string {
  if (!segredo) throw new EstadoInvalidoError('segredo de assinatura ausente');
  const e: EstadoGoogle = { ...dados, fluxo: 'google_presenca', nonce: randomBytes(8).toString('hex'), ts: agora };
  const corpo = Buffer.from(JSON.stringify(e)).toString('base64url');
  return `${corpo}.${assinatura(corpo, segredo)}`;
}

export function verificarEstado(state: string, segredo: string, agora: number = Date.now()): EstadoGoogle {
  if (!segredo) throw new EstadoInvalidoError('segredo de assinatura ausente');
  const partes = typeof state === 'string' ? state.split('.') : [];
  if (partes.length !== 2 || !partes[0] || !partes[1]) throw new EstadoInvalidoError('state inválido');
  const [corpo, sig] = partes as [string, string];
  const esperado = assinatura(corpo, segredo);
  const a = Buffer.from(sig);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new EstadoInvalidoError('state adulterado');
  let e: Partial<EstadoGoogle>;
  try {
    e = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Partial<EstadoGoogle>;
  } catch {
    throw new EstadoInvalidoError('state inválido');
  }
  if (e.fluxo !== 'google_presenca') throw new EstadoInvalidoError('state de outro fluxo');
  if (typeof e.tenantId !== 'string' || typeof e.ts !== 'number' || !capacidadeValida(e.capacidade)) {
    throw new EstadoInvalidoError('state inválido');
  }
  if (agora - e.ts > VALIDADE_STATE_MS || e.ts - agora > 60_000) {
    throw new EstadoInvalidoError('state expirado; comece a conexão de novo');
  }
  return {
    tenantId: e.tenantId,
    identityId: typeof e.identityId === 'string' ? e.identityId : null,
    capacidade: e.capacidade,
    fluxo: 'google_presenca',
    nonce: String(e.nonce ?? ''),
    ts: e.ts,
  };
}

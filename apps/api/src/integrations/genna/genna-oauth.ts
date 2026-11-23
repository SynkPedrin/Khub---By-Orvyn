import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * OAuth do Genna (MCP remoto, ADR-0053). Descoberto em 2026-11-22:
 *   recurso:       https://mcp.genna.co/.well-known/oauth-protected-resource
 *   autorização:   https://oauth.genna.co/.well-known/oauth-authorization-server
 * Cliente público (token_endpoint_auth_method=none) com cadastro dinâmico
 * (RFC 7591), PKCE S256 obrigatório e parâmetro `resource` (RFC 8707).
 * Funções puras, com o segredo como parâmetro, para teste unitário direto.
 */
export const GENNA = {
  provider: 'genna',
  mcpUrl: 'https://mcp.genna.co',
  autorizar: 'https://app.genna.co/oauth/authorize',
  token: 'https://oauth.genna.co/oauth/token',
  registrar: 'https://oauth.genna.co/oauth/register',
  /** Tudo que o Genna oferece; publicar só acontece depois de aprovação no KHUB. */
  escopos: ['mcp:read', 'mcp:write', 'mcp:publish'],
} as const;

export function gerarPkce(): { verificador: string; desafio: string } {
  const verificador = randomBytes(32).toString('base64url');
  return { verificador, desafio: createHash('sha256').update(verificador).digest('base64url') };
}

/**
 * State assinado (HMAC-SHA256, 10 min), mesmo desenho do Google Presença.
 * O callback é público, então o tenant viaja no state. Diferença: o Genna
 * exige PKCE, e o `code_verifier` tem que voltar para a troca do código sem
 * passar em claro pelo navegador, por isso vai CIFRADO (`verificadorCifrado`,
 * AES-256-GCM do CryptoService). O `clientId` do cadastro dinâmico também
 * viaja aqui: cada instância da API pode ter o seu.
 */
export interface EstadoGenna {
  tenantId: string;
  identityId: string | null;
  clientId: string;
  verificadorCifrado: string;
  fluxo: 'genna';
  nonce: string;
  ts: number;
}

export const VALIDADE_STATE_MS = 10 * 60_000;

export class EstadoGennaInvalidoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EstadoGennaInvalidoError';
  }
}

function assinatura(corpo: string, segredo: string): string {
  return createHmac('sha256', segredo).update(`genna:${corpo}`).digest('base64url');
}

export function assinarEstadoGenna(
  dados: { tenantId: string; identityId: string | null; clientId: string; verificadorCifrado: string },
  segredo: string,
  agora: number = Date.now(),
): string {
  if (!segredo) throw new EstadoGennaInvalidoError('segredo de assinatura ausente');
  const e: EstadoGenna = { ...dados, fluxo: 'genna', nonce: randomBytes(8).toString('hex'), ts: agora };
  const corpo = Buffer.from(JSON.stringify(e)).toString('base64url');
  return `${corpo}.${assinatura(corpo, segredo)}`;
}

export function verificarEstadoGenna(state: string, segredo: string, agora: number = Date.now()): EstadoGenna {
  if (!segredo) throw new EstadoGennaInvalidoError('segredo de assinatura ausente');
  const partes = typeof state === 'string' ? state.split('.') : [];
  if (partes.length !== 2 || !partes[0] || !partes[1]) throw new EstadoGennaInvalidoError('state inválido');
  const [corpo, sig] = partes as [string, string];
  const a = Buffer.from(sig);
  const b = Buffer.from(assinatura(corpo, segredo));
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new EstadoGennaInvalidoError('state adulterado');
  let e: Partial<EstadoGenna>;
  try {
    e = JSON.parse(Buffer.from(corpo, 'base64url').toString()) as Partial<EstadoGenna>;
  } catch {
    throw new EstadoGennaInvalidoError('state inválido');
  }
  if (e.fluxo !== 'genna') throw new EstadoGennaInvalidoError('state de outro fluxo');
  if (typeof e.tenantId !== 'string' || typeof e.ts !== 'number' || typeof e.clientId !== 'string' || typeof e.verificadorCifrado !== 'string') {
    throw new EstadoGennaInvalidoError('state inválido');
  }
  if (agora - e.ts > VALIDADE_STATE_MS || e.ts - agora > 60_000) {
    throw new EstadoGennaInvalidoError('state expirado; comece a conexão de novo');
  }
  return {
    tenantId: e.tenantId,
    identityId: typeof e.identityId === 'string' ? e.identityId : null,
    clientId: e.clientId,
    verificadorCifrado: e.verificadorCifrado,
    fluxo: 'genna',
    nonce: String(e.nonce ?? ''),
    ts: e.ts,
  };
}

export function urlAutorizacao(p: { clientId: string; redirectUri: string; state: string; desafio: string }): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    scope: GENNA.escopos.join(' '),
    state: p.state,
    code_challenge: p.desafio,
    code_challenge_method: 'S256',
    resource: GENNA.mcpUrl,
  });
  return `${GENNA.autorizar}?${q.toString()}`;
}

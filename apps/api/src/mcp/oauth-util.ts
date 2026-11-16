import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Peças puras do OAuth 2.1 do conector MCP (ADR-0049). Sem Nest, sem banco:
 * tudo aqui é testável isolado (oauth-util.spec.ts).
 */

export const ESCOPO_KHUB = 'khub';
export const TTL_CODIGO_S = 5 * 60;
export const TTL_ACESSO_S = 60 * 60;
export const TTL_RENOVACAO_S = 60 * 24 * 3600;
export const TTL_PEDIDO_S = 15 * 60;

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const b64url = (b: Buffer) => b.toString('base64url');

/** Token opaco com prefixo legível (o prefixo ajuda a achar vazamento em log). */
export function novoToken(prefixo: 'khc' | 'kha' | 'khr' | 'kcs' | 'kcl'): string {
  return `${prefixo}_${b64url(randomBytes(32))}`;
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256 (RFC 7636): BASE64URL(SHA256(verifier)) === challenge. */
export function pkceConfere(verifier: string | undefined, challenge: string | null | undefined): boolean {
  if (!verifier || !challenge) return false;
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  return iguais(b64url(createHash('sha256').update(verifier).digest()), challenge);
}

/**
 * URL de retorno aceita no cadastro: HTTPS em qualquer host, ou HTTP só em
 * loopback (Claude Desktop/Code e ferramentas locais). Sem fragmento, sem
 * credencial embutida. Esquemas customizados ficam de fora: nenhum dos dois
 * clientes-alvo usa.
 */
export function redirectValido(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length > 2000) return false;
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === 'https:') return true;
  return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
}

/** Pedido de autorização em trânsito até a tela de consentimento (assinado, 15 min). */
export interface PedidoAutorizacao {
  cid: string; // client_id
  ru: string; // redirect_uri
  cc: string; // code_challenge (S256)
  st?: string; // state
  exp: number; // epoch s
}

/** HMAC-SHA256 com chave derivada (nunca a mesma assinatura dos JWT de sessão). */
const chavePedido = (segredo: string) => createHash('sha256').update(`khub-mcp-pedido:${segredo}`).digest();

export function assinarPedido(p: Omit<PedidoAutorizacao, 'exp'>, segredo: string, agora = Date.now()): string {
  const corpo = b64url(Buffer.from(JSON.stringify({ ...p, exp: Math.floor(agora / 1000) + TTL_PEDIDO_S })));
  const sig = b64url(createHmac('sha256', chavePedido(segredo)).update(corpo).digest());
  return `${corpo}.${sig}`;
}

export function lerPedido(token: string, segredo: string, agora = Date.now()): PedidoAutorizacao | null {
  const [corpo, sig, ...resto] = String(token ?? '').split('.');
  if (!corpo || !sig || resto.length) return null;
  const esperado = b64url(createHmac('sha256', chavePedido(segredo)).update(corpo).digest());
  if (!iguais(sig, esperado)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')) as PedidoAutorizacao;
    if (typeof p.exp !== 'number' || p.exp * 1000 < agora) return null;
    if (!p.cid || !p.ru || !p.cc) return null;
    return p;
  } catch {
    return null;
  }
}

/** Monta a URL de retorno ao cliente preservando a query que ele já tinha. */
export function urlDeRetorno(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

/**
 * Origem pública da API: env `API_PUBLIC_URL`, senão a do próprio request
 * (Render/Railway repassam `x-forwarded-proto`). Sempre sem barra no fim.
 */
export function origemPublica(
  configurada: string | undefined,
  req: { headers: Record<string, string | string[] | undefined>; protocol?: string },
): string {
  if (configurada) return configurada.replace(/\/+$/, '');
  const h = (n: string) => {
    const v = req.headers[n];
    return (Array.isArray(v) ? v[0] : v)?.split(',')[0]?.trim();
  };
  const proto = h('x-forwarded-proto') || req.protocol || 'http';
  const host = h('x-forwarded-host') || h('host') || 'localhost';
  return `${proto}://${host}`;
}

/** Metadados RFC 8414 (servidor de autorização) e RFC 9728 (recurso protegido). */
export function metadadosAutorizacao(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: [ESCOPO_KHUB],
    service_documentation: `${base}/mcp`,
  };
}

export function metadadosRecurso(base: string) {
  return {
    resource: `${base}/mcp`,
    authorization_servers: [base],
    scopes_supported: [ESCOPO_KHUB],
    bearer_methods_supported: ['header'],
    resource_name: 'KHUB',
  };
}

import { createHash, createHmac, randomBytes } from 'node:crypto';

/**
 * Login no AWS Cognito por SRP (fluxo CUSTOM_AUTH com SRP_A), sem dependência:
 * só node:crypto + BigInt. É o mesmo protocolo do amazon-cognito-identity-js
 * (AuthenticationHelper), provado contra o pool do Avec em 19/11 (ADR-0052).
 * A senha nunca sai daqui: o Cognito recebe A e a assinatura HMAC.
 */
const N_HEX =
  'FFFFFFFFFFFFFFFFC90FDAA22168C234C4C6628B80DC1CD129024E088A67CC74020BBEA63B139B22514A08798E3404DD' +
  'EF9519B3CD3A431B302B0A6DF25F14374FE1356D6D51C245E485B576625E7EC6F44C42E9A637ED6B0BFF5CB6F406B7ED' +
  'EE386BFB5A899FA5AE9F24117C4B1FE649286651ECE45B3DC2007CB8A163BF0598DA48361C55D39A69163FA8FD24CF5F' +
  '83655D23DCA3AD961C62F356208552BB9ED529077096966D670C354E4ABC9804F1746C08CA18217C32905E462E36CE3B' +
  'E39E772C180E86039B2783A2EC07A28FB5C55DF06F4C52C9DE2BCBF6955817183995497CEA956AE515D2261898FA0510' +
  '15728E5A8AAAC42DAD33170D04507A33A85521ABDF1CBA64ECFB850458DBEF0A8AEA71575D060C7DB3970F85A6E1E4C7' +
  'ABF5AE8CDB0933D71E8C94E04A25619DCEE3D2261AD2EE6BF12FFA06D98A0864D87602733EC86A64521F2B18177B200C' +
  'BBE117577A615D6C770988C0BAD946E208E24FA074E5AB3143DB5BFCE0FD108E4B82D120A93AD2CAFFFFFFFFFFFFFFFF';
const N = BigInt(`0x${N_HEX}`);
const G = 2n;

export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let r = 1n;
  let b = base % mod;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return r;
}

/** Hex de inteiro positivo como o Cognito espera: tamanho par e sem bit de sinal ligado. */
export function padHex(n: bigint): string {
  let h = n.toString(16);
  if (h.length % 2) h = `0${h}`;
  else if ('89abcdef'.includes(h[0])) h = `00${h}`;
  return h;
}

export function hexHash(hex: string): string {
  return createHash('sha256').update(Buffer.from(hex, 'hex')).digest('hex').padStart(64, '0');
}

const K = BigInt(`0x${hexHash(padHex(N) + padHex(G))}`);
const DIAS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MESES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dois = (n: number) => String(n).padStart(2, '0');

/** "Thu Nov 19 14:03:07 UTC 2026" (dia sem zero à esquerda), formato exigido no TIMESTAMP. */
export function dataCognito(d: Date): string {
  return `${DIAS[d.getUTCDay()]} ${MESES[d.getUTCMonth()]} ${d.getUTCDate()} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}:${dois(d.getUTCSeconds())} UTC ${d.getUTCFullYear()}`;
}

/** Assinatura do PASSWORD_VERIFIER (função pura, testada com vetor fixo). */
export function assinaturaSrp(p: {
  pool: string;
  idSrp: string;
  senha: string;
  a: bigint;
  A: bigint;
  B: bigint;
  saltHex: string;
  secretBlock: string;
  agora: string;
}): string {
  const u = BigInt(`0x${hexHash(padHex(p.A) + padHex(p.B))}`);
  if (u === 0n) throw new Error('SRP: u = 0');
  const hashUsuario = createHash('sha256').update(`${p.pool}${p.idSrp}:${p.senha}`, 'utf8').digest('hex');
  const x = BigInt(`0x${hexHash(padHex(BigInt(`0x${p.saltHex}`)) + hashUsuario)}`);
  const base = (((p.B - K * modPow(G, x, N)) % N) + N) % N;
  const S = modPow(base, p.a + u * x, N);
  const prk = createHmac('sha256', Buffer.from(padHex(u), 'hex')).update(Buffer.from(padHex(S), 'hex')).digest();
  const chave = createHmac('sha256', prk).update(Buffer.concat([Buffer.from('Caldera Derived Key', 'utf8'), Buffer.from([1])])).digest().subarray(0, 16);
  return createHmac('sha256', chave)
    .update(Buffer.concat([Buffer.from(p.pool, 'utf8'), Buffer.from(p.idSrp, 'utf8'), Buffer.from(p.secretBlock, 'base64'), Buffer.from(p.agora, 'utf8')]))
    .digest('base64');
}

export class ErroCognito extends Error {
  constructor(
    message: string,
    readonly codigo?: string,
  ) {
    super(message);
  }
}

interface RespostaCognito {
  ChallengeName?: string;
  ChallengeParameters?: Record<string, string>;
  Session?: string;
  AuthenticationResult?: { AccessToken: string; IdToken: string; ExpiresIn: number };
  __type?: string;
  message?: string;
}

async function idp(regiao: string, alvo: string, corpo: unknown): Promise<RespostaCognito> {
  const r = await fetch(`https://cognito-idp.${regiao}.amazonaws.com/`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `AWSCognitoIdentityProviderService.${alvo}` },
    body: JSON.stringify(corpo),
  });
  const j = (await r.json().catch(() => ({}))) as RespostaCognito;
  if (!r.ok) throw new ErroCognito(j.message ?? `cognito ${alvo}: HTTP ${r.status}`, j.__type);
  return j;
}

export interface LoginCognito {
  poolId: string;
  clientId: string;
  usuario: string;
  senha: string;
  metaInicio?: Record<string, string>;
  metaCustom?: Record<string, string>;
  /** Resposta ao CUSTOM_CHALLENGE a partir dos parâmetros do desafio. */
  respostaCustom?: (parametros: Record<string, string>) => string;
}

export async function entrarCognito(p: LoginCognito): Promise<{ accessToken: string; expiraEmS: number }> {
  const [regiao, pool] = p.poolId.split('_');
  let a: bigint;
  let A: bigint;
  do {
    a = BigInt(`0x${randomBytes(128).toString('hex')}`);
    A = modPow(G, a, N);
  } while (A % N === 0n);
  const r1 = await idp(regiao, 'InitiateAuth', {
    AuthFlow: 'CUSTOM_AUTH',
    ClientId: p.clientId,
    AuthParameters: { USERNAME: p.usuario, SRP_A: A.toString(16), CHALLENGE_NAME: 'SRP_A' },
    ClientMetadata: p.metaInicio,
  });
  if (r1.ChallengeName !== 'PASSWORD_VERIFIER' || !r1.ChallengeParameters) throw new ErroCognito(`desafio inesperado: ${r1.ChallengeName ?? 'nenhum'}`);
  const cp = r1.ChallengeParameters;
  const B = BigInt(`0x${cp.SRP_B}`);
  if (B % N === 0n) throw new ErroCognito('SRP_B inválido');
  const agora = dataCognito(new Date());
  const assinatura = assinaturaSrp({ pool, idSrp: cp.USER_ID_FOR_SRP, senha: p.senha, a, A, B, saltHex: cp.SALT, secretBlock: cp.SECRET_BLOCK, agora });
  let r = await idp(regiao, 'RespondToAuthChallenge', {
    ChallengeName: 'PASSWORD_VERIFIER',
    ClientId: p.clientId,
    Session: r1.Session,
    ClientMetadata: p.metaInicio,
    ChallengeResponses: { USERNAME: cp.USER_ID_FOR_SRP, PASSWORD_CLAIM_SECRET_BLOCK: cp.SECRET_BLOCK, TIMESTAMP: agora, PASSWORD_CLAIM_SIGNATURE: assinatura },
  });
  for (let i = 0; i < 3 && r.ChallengeName === 'CUSTOM_CHALLENGE'; i++) {
    if (!p.respostaCustom) throw new ErroCognito('o pool pediu CUSTOM_CHALLENGE sem resposta configurada');
    r = await idp(regiao, 'RespondToAuthChallenge', {
      ChallengeName: 'CUSTOM_CHALLENGE',
      ClientId: p.clientId,
      Session: r.Session,
      ClientMetadata: p.metaCustom,
      ChallengeResponses: { USERNAME: r.ChallengeParameters?.USERNAME ?? cp.USER_ID_FOR_SRP, ANSWER: p.respostaCustom(r.ChallengeParameters ?? {}) },
    });
  }
  if (!r.AuthenticationResult) throw new ErroCognito(`login incompleto: ${r.ChallengeName ?? 'sem resultado'}`);
  return { accessToken: r.AuthenticationResult.AccessToken, expiraEmS: r.AuthenticationResult.ExpiresIn };
}

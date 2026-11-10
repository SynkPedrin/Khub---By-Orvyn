import { UnauthorizedException } from '@nestjs/common';

/**
 * OAuth2 (authorization code) para Google e GitHub — só endpoints e o mapeamento
 * de credencial→env. Nada de segredo aqui: as chaves vêm do `ConfigService`.
 *
 * O fluxo: o front redireciona para `authorizeUrl` → o provedor volta com `code`
 * no `redirect_uri` → trocamos o code por access_token → buscamos o perfil (e-mail
 * verificado). Quem cria/loga a identidade é o `AuthService` (mesma sessão do login).
 */
export type OAuthProvider = 'google' | 'github';

export interface OAuthProfile {
  email: string;
  nome: string;
  emailVerified: boolean;
}

interface ProviderConf {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  clientIdVar: string;
  clientSecretVar: string;
}

export const OAUTH: Record<OAuthProvider, ProviderConf> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    clientIdVar: 'GOOGLE_CLIENT_ID',
    clientSecretVar: 'GOOGLE_CLIENT_SECRET',
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    clientIdVar: 'GITHUB_ID',
    clientSecretVar: 'GITHUB_SECRET',
  },
};

export function ehProvider(p: string): p is OAuthProvider {
  return p === 'google' || p === 'github';
}

/** URL de consentimento do provedor (para onde o front redireciona). */
export function buildAuthUrl(provider: OAuthProvider, clientId: string, redirectUri: string, state: string): string {
  const c = OAUTH[provider];
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: c.scope,
    state,
    response_type: 'code',
  });
  if (provider === 'google') {
    p.set('access_type', 'online');
    p.set('prompt', 'select_account'); // deixa o usuário escolher a conta a cada vez
  }
  return `${c.authorizeUrl}?${p.toString()}`;
}

/** Troca o `code` por token e devolve o perfil (e-mail + nome + verificado). */
export async function exchangeCodeForProfile(
  provider: OAuthProvider,
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
): Promise<OAuthProfile> {
  const accessToken = await exchangeToken(provider, input);
  return provider === 'google' ? googleProfile(accessToken) : githubProfile(accessToken);
}

async function exchangeToken(provider: OAuthProvider, input: { clientId: string; clientSecret: string; code: string; redirectUri: string }): Promise<string> {
  const res = await fetch(OAUTH[provider].tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      client_id: input.clientId,
      client_secret: input.clientSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { access_token?: string } | null;
  if (!res || !res.ok || !j?.access_token) throw new UnauthorizedException(`falha ao autenticar com ${provider}`);
  return j.access_token;
}

async function googleProfile(accessToken: string): Promise<OAuthProfile> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  }).catch(() => null);
  const j = (await res?.json().catch(() => null)) as { email?: string; name?: string; email_verified?: boolean } | null;
  if (!res || !res.ok || !j?.email) throw new UnauthorizedException('não foi possível obter o e-mail no Google');
  return { email: j.email, nome: j.name ?? j.email, emailVerified: !!j.email_verified };
}

async function githubProfile(accessToken: string): Promise<OAuthProfile> {
  const headers = { authorization: `Bearer ${accessToken}`, 'user-agent': 'KHUB', accept: 'application/vnd.github+json' };
  const u = (await fetch('https://api.github.com/user', { headers }).then((r) => r.json()).catch(() => null)) as { name?: string; login?: string; email?: string } | null;
  let email = u?.email ?? undefined;
  let verified = true;
  if (!email) {
    // e-mail privado: pega o primário verificado da lista dedicada
    const lista = (await fetch('https://api.github.com/user/emails', { headers }).then((r) => r.json()).catch(() => null)) as { email: string; primary: boolean; verified: boolean }[] | null;
    const escolhido = Array.isArray(lista) ? (lista.find((e) => e.primary && e.verified) ?? lista.find((e) => e.verified)) : null;
    email = escolhido?.email;
    verified = !!escolhido?.verified;
  }
  if (!email) throw new UnauthorizedException('não foi possível obter o e-mail no GitHub');
  return { email, nome: u?.name ?? u?.login ?? email, emailVerified: verified };
}

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { AuthService, type Tokens } from './auth.service';
import { OAUTH, buildAuthUrl, exchangeCodeForProfile, type OAuthProvider } from './oauth.providers';

/**
 * Login social (Google/GitHub). **Gated (ADR-0008):** sem as credenciais o
 * `require` lança 501 `config_required` nomeando as vars — nunca finge.
 */
@Injectable()
export class OAuthService {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AuthService,
  ) {}

  private provedorConfig(provider: OAuthProvider): 'oauth_google' | 'oauth_github' {
    return provider === 'google' ? 'oauth_google' : 'oauth_github';
  }

  /** Precisa bater EXATAMENTE com o que foi registrado no console do provedor. */
  private redirectUri(provider: OAuthProvider): string {
    const base = this.config.get('WEB_URL') ?? 'http://localhost:3210';
    return `${base}/api/auth/oauth/${provider}/callback`;
  }

  /** URL de consentimento (o front redireciona o navegador para cá). */
  authUrl(provider: OAuthProvider, state: string): string {
    this.config.require(this.provedorConfig(provider)); // 501 se faltar credencial
    const clientId = this.config.get(OAUTH[provider].clientIdVar)!;
    return buildAuthUrl(provider, clientId, this.redirectUri(provider), state);
  }

  /** Callback: troca o code por perfil e emite a sessão (cria a conta no 1º acesso). */
  async callback(provider: OAuthProvider, code: string, userAgent?: string): Promise<Tokens> {
    this.config.require(this.provedorConfig(provider));
    const clientId = this.config.get(OAUTH[provider].clientIdVar)!;
    const clientSecret = this.config.get(OAUTH[provider].clientSecretVar)!;
    const perfil = await exchangeCodeForProfile(provider, { clientId, clientSecret, code, redirectUri: this.redirectUri(provider) });
    if (!perfil.emailVerified) throw new UnauthorizedException('e-mail não verificado no provedor');
    return this.auth.loginWithOAuth(perfil.email, perfil.nome, userAgent);
  }
}

'use client';

/**
 * Erro de API com o corpo preservado. O gating por credencial (Brief §2) devolve
 * 501 com `{ code: 'config_required', provider, missing[] }` — a UI precisa do
 * corpo para dizer O QUE conectar, em vez de "algo deu errado".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body?.title ?? body?.message ?? `Erro ${status}`));
    this.name = 'ApiError';
  }

  get configRequired(): { provider: string; missing: string[] } | null {
    // O filtro RFC 7807 publica o marcador em `code` e mantém `status`
    // numérico. Aceitar também o formato legado sem o filtro.
    if (this.status !== 501 || (this.body?.code !== 'config_required' && this.body?.status !== 'config_required')) return null;
    return {
      provider: String(this.body.provider ?? 'provedor'),
      missing: Array.isArray(this.body.missing) ? (this.body.missing as string[]) : [],
    };
  }
}

/** Nome de exibição do provedor + onde a credencial é obtida. */
export const PROVIDER_LABEL: Record<string, string> = {
  stevo: 'STEVO (WhatsApp, legado)',
  evolution: 'Evolution API (WhatsApp)',
  meta: 'Meta Ads',
  google_ads: 'Google Ads',
  tiktok: 'TikTok Ads',
  stripe: 'Stripe',
  voyage: 'Voyage (embeddings)',
  anthropic: 'Claude (Anthropic)',
  email: 'E-mail (SMTP)',
  oauth_google: 'Login com Google',
  oauth_github: 'Login com GitHub',
  integrations_crypto: 'Cifra de credenciais',
};

export function providerLabel(p: string): string {
  return PROVIDER_LABEL[p] ?? p;
}

import { HttpException, Injectable, Logger } from '@nestjs/common';

/** Provedores externos que exigem credencial. Fonte da verdade: docs/ENV.md */
export type Provider =
  | 'stevo' | 'stevo_api' | 'stevo_webhook' | 'evolution' | 'meta' | 'google_ads' | 'tiktok' | 'stripe'
  | 'voyage' | 'anthropic' | 'email' | 'oauth_google' | 'oauth_github'
  | 'google_calendar' | 'integrations_crypto' | 'storage' | 'youtube' | 'firecrawl';

/** Variáveis obrigatórias por provedor (Seção 2 do Brief-Finalizacao). */
const REQUIRED: Record<Provider, string[]> = {
  stevo: ['STEVO_API_URL', 'STEVO_API_KEY', 'STEVO_INSTANCE'],
  // Stevo API de gestão (ADR-0031: Stevo = transporte de comunicação).
  stevo_api: ['STEVO_REVENUE_API_KEY'],
  stevo_webhook: ['STEVO_WEBHOOK_SECRET'],
  // WhatsApp via Evolution API própria (CANAL_MVP do CLAUDE.md). Chave GLOBAL
  // do servidor Evolution — não confundir com o token por-instância que a
  // Evolution devolve em /instance/create (esse fica cifrado no banco).
  evolution: ['EVOLUTION_BASE_URL', 'EVOLUTION_API_KEY'],
  meta: ['META_APP_ID', 'META_APP_SECRET'],
  google_ads: ['GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'],
  tiktok: ['TIKTOK_APP_ID', 'TIKTOK_APP_SECRET'],
  // `STRIPE_WEBHOOK_SECRET` é obrigatória (não só "recomendada"): sem ela o
  // controller de webhook (stripe-webhook.controller.ts) não tem como
  // verificar NENHUM evento — pagamento confirmado nunca chegaria a marcar
  // cobrança/assinatura como paga. Achado da auditoria de produção.
  stripe: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
  voyage: ['VOYAGE_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  // Pesquisa na web e leitura de páginas da NICO (benchmark de concorrentes).
  firecrawl: ['FIRECRAWL_API_KEY'],
  email: ['SMTP_URL'],
  oauth_google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  oauth_github: ['GITHUB_ID', 'GITHUB_SECRET'],
  google_calendar: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  integrations_crypto: ['INTEGRATIONS_ENCRYPTION_KEY'],
  // Storage S3-compatible (R2/AWS/MinIO) — anexos do Inbox (Q2.5). S3_REGION
  // e S3_PUBLIC_BASE_URL são opcionais (ver docs/ENV.md).
  storage: ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'],
  // Comentários do YouTube em Conversas (db/063): OAuth do Google + YouTube Data API v3.
  youtube: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
};

/**
 * 501 padronizado: `{ status: 'config_required', provider, missing: [...] }`.
 * Usado quando a operação depende SÓ da chamada externa. Quando a parte local
 * já teve efeito (ex.: mensagem persistida), devolva 200 + `delivery` gated —
 * ver ADR-0008.
 */
export class ConfigRequiredException extends HttpException {
  constructor(provider: Provider, missing: string[]) {
    super({ status: 'config_required', provider, missing, title: `Configuração pendente: ${provider}` }, 501);
  }
}

@Injectable()
export class ConfigService {
  private readonly log = new Logger('Config');

  get(key: string): string | undefined {
    const v = process.env[key];
    return v && v.trim() !== '' ? v : undefined;
  }

  /** Variáveis que faltam para o provedor operar em modo real. */
  missingVars(p: Provider): string[] {
    if (p === 'email' && this.get('RESEND_API_KEY')) return this.get('RESEND_FROM') ? [] : ['RESEND_FROM'];
    return (REQUIRED[p] ?? []).filter((k) => !this.get(k));
  }

  isConfigured(p: Provider): boolean {
    return this.missingVars(p).length === 0;
  }

  /** Lança 501 config_required se o provedor não estiver configurado. */
  require(p: Provider): void {
    const missing = this.missingVars(p);
    if (missing.length) throw new ConfigRequiredException(p, missing);
  }

  /** Loga uma vez o motivo da degradação (fallback), sem derrubar a feature. */
  warnDegraded(p: Provider, fallback: string): void {
    this.log.warn(`${p} não configurado (falta: ${this.missingVars(p).join(', ')}) — usando fallback: ${fallback}`);
  }

  /** Snapshot para docs/health: quem está ATIVO e quem está GATED. */
  snapshot(): { provider: Provider; configured: boolean; missing: string[] }[] {
    return (Object.keys(REQUIRED) as Provider[]).map((p) => ({ provider: p, configured: this.isConfigured(p), missing: this.missingVars(p) }));
  }
}

export type AdsProvider = 'meta' | 'google' | 'tiktok';

export interface StoredCredentials {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string; // ISO
  externalBusinessId?: string;
  scopes?: string[];
  /** Stored only inside credentialsEncrypted, never returned by list(). */
  pages?: { pageId: string; nome: string; accessToken?: string; tasks?: string[] }[];
}

export interface AdAccountDTO {
  externalId: string;
  name: string;
  currency?: string;
  timezone?: string;
  status?: string;
}

export interface CampaignDTO {
  externalId: string;
  name: string;
  objective?: string;
  status?: string;
  dailyBudget?: number;
  lifetimeBudget?: number;
  startAt?: string;
  stopAt?: string;
}

export interface CreativeDTO {
  externalId: string;
  campaignExternalId?: string;
  name?: string;
  format?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  body?: string;
  cta?: string;
  status?: string;
}

export interface InsightDTO {
  level: 'account' | 'campaign' | 'adset' | 'ad';
  externalRefId: string;
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  reach: number;
  frequency: number;
  leads: number;
  conversions: number;
  revenue: number;
  roas: number;
  cpl: number;
  cpa: number;
}

export interface ConnectionHealth {
  status: 'ok' | 'degraded' | 'down';
  detail?: string;
}

export interface DateRange {
  since: string; // YYYY-MM-DD
  until: string;
}

/** Contrato único que cada provider de anúncios implementa (Sprint A–B). */
export interface AdsConnector {
  readonly provider: AdsProvider;
  /** Há credencial de app para este provider? (gating — Brief §2) */
  configured?(): boolean;
  /** Páginas/perfis do usuário, para rotear webhook de lead (só quem tem). */
  listPages?(cred: StoredCredentials): Promise<NonNullable<StoredCredentials['pages']>>;
  buildAuthUrl(tenantId: string, state: string): string;
  exchangeCode(code: string): Promise<StoredCredentials>;
  listAdAccounts(cred: StoredCredentials): Promise<AdAccountDTO[]>;
  syncCampaigns(cred: StoredCredentials, adAccountExternalId: string): Promise<CampaignDTO[]>;
  syncCreatives(cred: StoredCredentials, adAccountExternalId: string): Promise<CreativeDTO[]>;
  syncInsights(cred: StoredCredentials, adAccountExternalId: string, range: DateRange): Promise<InsightDTO[]>;
  healthCheck(cred: StoredCredentials): Promise<ConnectionHealth>;
}

export const ADS_CONNECTORS = Symbol('ADS_CONNECTORS');

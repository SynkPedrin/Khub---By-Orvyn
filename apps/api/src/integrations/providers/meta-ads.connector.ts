import { Inject, Injectable } from '@nestjs/common';
import {
  type AdAccountDTO,
  type AdsConnector,
  type CampaignDTO,
  type ConnectionHealth,
  type CreativeDTO,
  type DateRange,
  type InsightDTO,
  type StoredCredentials,
} from '../ads-connector';
import { ConfigService } from '../../config/config.service';
import { META_GRAPH, type GraphClient } from './meta-graph.client';

const SCOPES = ['ads_read', 'ads_management', 'business_management', 'leads_retrieval', 'pages_show_list'];

@Injectable()
export class MetaAdsConnector implements AdsConnector {
  readonly provider = 'meta' as const;

  constructor(
    @Inject(META_GRAPH) private readonly graph: GraphClient,
    private readonly config: ConfigService,
  ) {}

  configured(): boolean {
    return this.config.isConfigured('meta');
  }
  private version(): string {
    return this.config.get('META_GRAPH_VERSION') ?? 'v21.0';
  }
  redirectUri(): string {
    return `${this.config.get('WEB_URL') ?? 'http://localhost:3210'}/api/integrations/meta/callback`;
  }

  buildAuthUrl(_tenantId: string, state: string): string {
    this.config.require('meta');
    const p = new URLSearchParams({
      client_id: this.config.get('META_APP_ID')!,
      redirect_uri: this.redirectUri(),
      state,
      response_type: 'code',
      scope: SCOPES.join(','),
    });
    return `https://www.facebook.com/${this.version()}/dialog/oauth?${p.toString()}`;
  }

  async exchangeCode(code: string): Promise<StoredCredentials> {
    this.config.require('meta');
    const j = await this.graph.get('oauth/access_token', {
      client_id: this.config.get('META_APP_ID'),
      client_secret: this.config.get('META_APP_SECRET'),
      redirect_uri: this.redirectUri(),
      code,
    });
    return {
      accessToken: j.access_token,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : undefined,
      scopes: SCOPES,
    };
  }

  /** Páginas do usuário — usadas para rotear o webhook de Lead Ads (D1). */
  async listPages(cred: StoredCredentials): Promise<{ pageId: string; nome: string }[]> {
    const j = await this.graph.get('me/accounts', { fields: 'id,name', limit: 200 }, cred.accessToken);
    return (j.data ?? []).map((p: any) => ({ pageId: String(p.id), nome: p.name ?? '' }));
  }

  async listAdAccounts(cred: StoredCredentials): Promise<AdAccountDTO[]> {
    const j = await this.graph.get('me/adaccounts', { fields: 'account_id,name,currency,timezone_name,account_status' }, cred.accessToken);
    return (j.data ?? []).map((a: any) => ({
      externalId: `act_${a.account_id}`,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone_name,
      status: String(a.account_status ?? ''),
    }));
  }

  async syncCampaigns(cred: StoredCredentials, acc: string): Promise<CampaignDTO[]> {
    const j = await this.graph.get(`${acc}/campaigns`, { fields: 'id,name,objective,status,daily_budget,lifetime_budget,start_time,stop_time', limit: 200 }, cred.accessToken);
    return (j.data ?? []).map((c: any) => ({
      externalId: c.id,
      name: c.name,
      objective: c.objective,
      status: c.status,
      dailyBudget: c.daily_budget != null ? Number(c.daily_budget) / 100 : undefined,
      lifetimeBudget: c.lifetime_budget != null ? Number(c.lifetime_budget) / 100 : undefined,
      startAt: c.start_time,
      stopAt: c.stop_time,
    }));
  }

  async syncCreatives(cred: StoredCredentials, acc: string): Promise<CreativeDTO[]> {
    const j = await this.graph.get(`${acc}/adcreatives`, { fields: 'id,name,thumbnail_url,object_type,body,call_to_action_type', limit: 200 }, cred.accessToken);
    return (j.data ?? []).map((c: any) => ({
      externalId: c.id,
      name: c.name,
      thumbnailUrl: c.thumbnail_url,
      format: c.object_type,
      body: c.body,
      cta: c.call_to_action_type,
      status: 'active',
    }));
  }

  async syncInsights(cred: StoredCredentials, acc: string, range: DateRange): Promise<InsightDTO[]> {
    const j = await this.graph.get(
      `${acc}/insights`,
      {
        level: 'campaign',
        fields: 'campaign_id,spend,impressions,clicks,ctr,cpc,cpm,reach,frequency,actions,action_values,date_start',
        time_range: JSON.stringify({ since: range.since, until: range.until }),
        time_increment: 1,
        limit: 500,
      },
      cred.accessToken,
    );
    return (j.data ?? []).map((row: any) => this.mapInsight(row));
  }

  mapInsight(row: any): InsightDTO {
    const actions: any[] = row.actions ?? [];
    const values: any[] = row.action_values ?? [];
    const sumBy = (arr: any[], types: string[]) =>
      arr.filter((a) => types.some((t) => String(a.action_type ?? '').includes(t))).reduce((s, a) => s + Number(a.value || 0), 0);
    const spend = Number(row.spend || 0);
    const leads = sumBy(actions, ['lead']);
    const conversions = sumBy(actions, ['purchase', 'offsite_conversion.fb_pixel_purchase']);
    const revenue = sumBy(values, ['purchase']);
    return {
      level: 'campaign',
      externalRefId: row.campaign_id,
      date: row.date_start,
      spend,
      impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0),
      ctr: Number(row.ctr || 0),
      cpc: Number(row.cpc || 0),
      cpm: Number(row.cpm || 0),
      reach: Number(row.reach || 0),
      frequency: Number(row.frequency || 0),
      leads,
      conversions,
      revenue,
      roas: spend ? revenue / spend : 0,
      cpl: leads ? spend / leads : 0,
      cpa: conversions ? spend / conversions : 0,
    };
  }

  async healthCheck(cred: StoredCredentials): Promise<ConnectionHealth> {
    try {
      await this.graph.get('me', { fields: 'id' }, cred.accessToken);
      return { status: 'ok' };
    } catch (e) {
      return { status: 'down', detail: (e as Error).message };
    }
  }
}

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

/**
 * Capabilities da Meta — NUNCA um scope-blob monolítico (Brief de recuperação,
 * Fase 2). `leads_retrieval` normalmente exige Advanced Access via App Review
 * (ou, em dev, que o usuário logado seja Admin/Developer/Tester do App); pedir
 * esse scope junto com `ads_read` faz o diálogo OAuth inteiro falhar com
 * "Invalid Scopes" se a permissão não estiver liberada — derrubando também
 * Ads, que funcionaria sozinho. Separado: `ads` conecta mesmo sem Lead Ads
 * aprovado; `leads` é pedido à parte, só quando o operador quer esse canal.
 */
export type MetaCapability = 'ads' | 'leads';

const CAPABILITY_SCOPES: Record<MetaCapability, string[]> = {
  ads: ['ads_read', 'ads_management', 'business_management', 'pages_show_list'],
  leads: ['leads_retrieval', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads'],
};

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

  /**
   * `capability` decide QUAL conjunto de scopes vai no diálogo. Default
   * `'ads'` preserva o comportamento existente para quem já chama sem o
   * parâmetro novo.
   */
  buildAuthUrl(_tenantId: string, state: string, capability: MetaCapability = 'ads'): string {
    this.config.require('meta');
    const p = new URLSearchParams({
      client_id: this.config.get('META_APP_ID')!,
      redirect_uri: this.redirectUri(),
      state,
      response_type: 'code',
      scope: CAPABILITY_SCOPES[capability].join(','),
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
    const accessToken = j.access_token;
    return {
      accessToken,
      expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : undefined,
      // Scopes REALMENTE concedidos, não os pedidos — a Meta pode aprovar
      // silenciosamente só parte do pedido sem derrubar o diálogo. Sem isto,
      // `Integration.scopes` mentia sobre o que a conta de fato autorizou.
      scopes: await this.grantedScopes(accessToken),
    };
  }

  /** GET /me/permissions — o único jeito confiável de saber o que foi concedido. */
  private async grantedScopes(accessToken: string): Promise<string[]> {
    try {
      const j = await this.graph.get('me/permissions', {}, accessToken);
      return (j.data ?? [])
        .filter((p: { status?: string }) => p.status === 'granted')
        .map((p: { permission: string }) => p.permission);
    } catch {
      // Token acabou de sair da troca — se /me/permissions falhar aqui é
      // problema de rede, não de permissão. Não inventa lista vazia como se
      // fosse "nada concedido"; deixa a UI mostrar "não verificado ainda".
      return [];
    }
  }

  /**
   * Diagnóstico legível — traduz o resultado cru da Meta em algo que o
   * operador entende, sem expurgar o motivo técnico (fica em `detalhe`).
   */
  async diagnosticar(cred: StoredCredentials): Promise<{
    tokenValido: boolean;
    concedidos: string[];
    faltandoAds: string[];
    faltandoLeads: string[];
    paginas: { pageId: string; nome: string }[];
    detalhe?: string;
  }> {
    let tokenValido = true;
    let detalhe: string | undefined;
    try {
      await this.graph.get('me', { fields: 'id' }, cred.accessToken);
    } catch (e) {
      tokenValido = false;
      detalhe = (e as Error).message;
    }

    const concedidos = tokenValido ? await this.grantedScopes(cred.accessToken) : (cred.scopes ?? []);
    const faltandoAds = CAPABILITY_SCOPES.ads.filter((s) => !concedidos.includes(s));
    const faltandoLeads = CAPABILITY_SCOPES.leads.filter((s) => !concedidos.includes(s));

    let paginas: { pageId: string; nome: string }[] = [];
    if (tokenValido && concedidos.includes('pages_show_list')) {
      try {
        paginas = (await this.listPages(cred)).map((p) => ({ pageId: p.pageId, nome: p.nome }));
      } catch {
        // sem páginas legíveis — não é erro fatal do diagnóstico
      }
    }

    return { tokenValido, concedidos, faltandoAds, faltandoLeads, paginas, detalhe };
  }

  /** Páginas do usuário — usadas para rotear o webhook de Lead Ads (D1). */
  async listPages(cred: StoredCredentials): Promise<NonNullable<StoredCredentials['pages']>> {
    const j = await this.graph.get('me/accounts', { fields: 'id,name,access_token,tasks', limit: 200 }, cred.accessToken);
    return (j.data ?? []).map((p: any) => ({ pageId: String(p.id), nome: p.name ?? '', accessToken: p.access_token, tasks: p.tasks ?? [] }));
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

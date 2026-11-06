import { MetaAdsConnector } from './meta-ads.connector';
import { ConfigService } from '../../config/config.service';
import type { GraphClient } from './meta-graph.client';

function fakeGraph(responses: Record<string, any>): GraphClient {
  return {
    get: async (path: string) => {
      const key = Object.keys(responses).find((k) => path.includes(k));
      if (!key) throw new Error(`sem mock para ${path}`);
      return responses[key];
    },
  };
}

const cred = { accessToken: 'tok' };

describe('MetaAdsConnector', () => {
  beforeAll(() => {
    process.env.META_APP_ID = 'app123';
    process.env.META_APP_SECRET = 'sec456';
    process.env.WEB_URL = 'http://localhost:3210';
  });

  it('buildAuthUrl inclui client_id, redirect, scope e state', () => {
    const c = new MetaAdsConnector(fakeGraph({}), new ConfigService());
    const url = c.buildAuthUrl('t1', 'STATE');
    expect(url).toContain('client_id=app123');
    expect(url).toContain('state=STATE');
    expect(url).toContain('ads_read');
    expect(decodeURIComponent(url)).toContain('http://localhost:3210/api/integrations/meta/callback');
  });

  it('mapeia ad accounts', async () => {
    const c = new MetaAdsConnector(fakeGraph({ 'me/adaccounts': { data: [{ account_id: '111', name: 'Conta', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 1 }] } }), new ConfigService());
    const accts = await c.listAdAccounts(cred);
    expect(accts).toEqual([{ externalId: 'act_111', name: 'Conta', currency: 'BRL', timezone: 'America/Sao_Paulo', status: '1' }]);
  });

  it('mapeia campanhas (orçamento em centavos → reais)', async () => {
    const c = new MetaAdsConnector(fakeGraph({ '/campaigns': { data: [{ id: 'c1', name: 'Camp', objective: 'LEAD_GENERATION', status: 'ACTIVE', daily_budget: '5000' }] } }), new ConfigService());
    const [camp] = await c.syncCampaigns(cred, 'act_111');
    expect(camp.externalId).toBe('c1');
    expect(camp.dailyBudget).toBe(50); // 5000 centavos
  });

  describe('capabilities separadas (Fase 2 do brief de recuperação)', () => {
    it('capability "ads" (default) NÃO pede leads_retrieval — não pode travar Ads por causa de Lead Ads', () => {
      const c = new MetaAdsConnector(fakeGraph({}), new ConfigService());
      const url = c.buildAuthUrl('t1', 'STATE', 'ads');
      expect(url).toContain('ads_read');
      expect(url).toContain('ads_management');
      expect(url).not.toContain('leads_retrieval');
    });

    it('capability "leads" pede leads_retrieval e NÃO pede ads_management', () => {
      const c = new MetaAdsConnector(fakeGraph({}), new ConfigService());
      const url = c.buildAuthUrl('t1', 'STATE', 'leads');
      expect(url).toContain('leads_retrieval');
      expect(url).not.toContain('ads_management');
    });

    it('exchangeCode devolve os scopes CONCEDIDOS (me/permissions), não os pedidos', async () => {
      // A conta só concedeu ads_read — mesmo pedindo o pacote "ads" inteiro,
      // o resto ficou de fora sem derrubar o diálogo (comportamento real da
      // Meta: alguns scopes falham silenciosamente).
      const c = new MetaAdsConnector(
        fakeGraph({
          'oauth/access_token': { access_token: 'tok123', expires_in: 3600 },
          'me/permissions': { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'ads_management', status: 'declined' }] },
        }),
        new ConfigService(),
      );
      const cred2 = await c.exchangeCode('CODE');
      expect(cred2.scopes).toEqual(['ads_read']);
      expect(cred2.scopes).not.toContain('ads_management');
    });

    it('diagnosticar aponta exatamente o que falta para cada capability', async () => {
      // Ordem importa: `fakeGraph` casa por substring na ordem de declaração,
      // então as chaves mais específicas ("me/permissions", "me/accounts")
      // precisam vir ANTES da genérica ("me"), senão "me/permissions" também
      // bateria em "me" primeiro.
      const c = new MetaAdsConnector(
        fakeGraph({
          'me/permissions': { data: [{ permission: 'ads_read', status: 'granted' }, { permission: 'pages_show_list', status: 'granted' }] },
          'me/accounts': { data: [] },
          me: { id: 'u1' },
        }),
        new ConfigService(),
      );
      const r = await c.diagnosticar(cred);
      expect(r.tokenValido).toBe(true);
      expect(r.concedidos).toEqual(['ads_read', 'pages_show_list']);
      expect(r.faltandoAds).toEqual(['ads_management', 'business_management']);
      expect(r.faltandoLeads).toEqual(['leads_retrieval', 'pages_read_engagement', 'pages_manage_ads']);
    });

    it('diagnosticar com token inválido não lança — devolve tokenValido:false', async () => {
      const c = new MetaAdsConnector(
        {
          get: async () => {
            throw new Error('Meta Graph 401: token expirado');
          },
        },
        new ConfigService(),
      );
      const r = await c.diagnosticar({ accessToken: 'expirado', scopes: ['ads_read'] });
      expect(r.tokenValido).toBe(false);
      expect(r.detalhe).toContain('401');
    });
  });

  it('mapeia insights: actions → leads/conversions, deriva ROAS/CPL', () => {
    const c = new MetaAdsConnector(fakeGraph({}), new ConfigService());
    const ins = c.mapInsight({
      campaign_id: 'c1', date_start: '2026-07-10', spend: '100', impressions: '2000', clicks: '80', ctr: '4', reach: '1500',
      actions: [{ action_type: 'lead', value: '10' }, { action_type: 'offsite_conversion.fb_pixel_purchase', value: '4' }],
      action_values: [{ action_type: 'purchase', value: '500' }],
    });
    expect(ins.leads).toBe(10);
    expect(ins.conversions).toBe(4);
    expect(ins.revenue).toBe(500);
    expect(ins.roas).toBe(5); // 500/100
    expect(ins.cpl).toBe(10); // 100/10
  });
});

import { MetaAdsConnector } from './meta-ads.connector';
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
    process.env.WEB_URL = 'http://localhost:3210';
  });

  it('buildAuthUrl inclui client_id, redirect, scope e state', () => {
    const c = new MetaAdsConnector(fakeGraph({}));
    const url = c.buildAuthUrl('t1', 'STATE');
    expect(url).toContain('client_id=app123');
    expect(url).toContain('state=STATE');
    expect(url).toContain('ads_read');
    expect(decodeURIComponent(url)).toContain('http://localhost:3210/api/integrations/meta/callback');
  });

  it('mapeia ad accounts', async () => {
    const c = new MetaAdsConnector(fakeGraph({ 'me/adaccounts': { data: [{ account_id: '111', name: 'Conta', currency: 'BRL', timezone_name: 'America/Sao_Paulo', account_status: 1 }] } }));
    const accts = await c.listAdAccounts(cred);
    expect(accts).toEqual([{ externalId: 'act_111', name: 'Conta', currency: 'BRL', timezone: 'America/Sao_Paulo', status: '1' }]);
  });

  it('mapeia campanhas (orçamento em centavos → reais)', async () => {
    const c = new MetaAdsConnector(fakeGraph({ '/campaigns': { data: [{ id: 'c1', name: 'Camp', objective: 'LEAD_GENERATION', status: 'ACTIVE', daily_budget: '5000' }] } }));
    const [camp] = await c.syncCampaigns(cred, 'act_111');
    expect(camp.externalId).toBe('c1');
    expect(camp.dailyBudget).toBe(50); // 5000 centavos
  });

  it('mapeia insights: actions → leads/conversions, deriva ROAS/CPL', () => {
    const c = new MetaAdsConnector(fakeGraph({}));
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

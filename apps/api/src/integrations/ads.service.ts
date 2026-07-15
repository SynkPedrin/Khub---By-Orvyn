import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const n = (v: unknown) => Number(v ?? 0);
const derive = (r: any) => ({
  spend: n(r.spend),
  impressions: n(r.impressions),
  clicks: n(r.clicks),
  leads: n(r.leads),
  conversions: n(r.conversions),
  revenue: n(r.revenue),
  ctr: n(r.impressions) ? (n(r.clicks) / n(r.impressions)) * 100 : 0,
  cpc: n(r.clicks) ? n(r.spend) / n(r.clicks) : 0,
  cpl: n(r.leads) ? n(r.spend) / n(r.leads) : 0,
  cpa: n(r.conversions) ? n(r.spend) / n(r.conversions) : 0,
  roas: n(r.spend) ? n(r.revenue) / n(r.spend) : 0,
});

@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [tot] = await tx.$queryRaw<any[]>`
        SELECT coalesce(sum(spend),0)::float8 spend, coalesce(sum(impressions),0)::float8 impressions,
               coalesce(sum(clicks),0)::float8 clicks, coalesce(sum(leads),0)::float8 leads,
               coalesce(sum(conversions),0)::float8 conversions, coalesce(sum(revenue),0)::float8 revenue
        FROM ad_insights`;
      const byProvider = await tx.$queryRaw<any[]>`
        SELECT provider, coalesce(sum(spend),0)::float8 spend, coalesce(sum(leads),0)::float8 leads,
               coalesce(sum(revenue),0)::float8 revenue, coalesce(sum(impressions),0)::float8 impressions,
               coalesce(sum(clicks),0)::float8 clicks, coalesce(sum(conversions),0)::float8 conversions
        FROM ad_insights GROUP BY provider`;
      const connections = await tx.integration.findMany({
        select: { id: true, provider: true, status: true, health: true, lastSyncAt: true },
        orderBy: { createdAt: 'desc' },
      });
      const accounts = await tx.adAccount.count();
      const campaigns = await tx.adCampaign.count();

      return {
        totals: derive(tot),
        byProvider: byProvider.map((r) => ({ provider: r.provider, ...derive(r) })),
        connections,
        counts: { accounts, campaigns },
      };
    });
  }

  async campaigns(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT c.name, c.external_id, c.objective, c.status, c.id,
               coalesce(sum(i.spend),0)::float8 spend, coalesce(sum(i.impressions),0)::float8 impressions,
               coalesce(sum(i.clicks),0)::float8 clicks, coalesce(sum(i.leads),0)::float8 leads,
               coalesce(sum(i.conversions),0)::float8 conversions, coalesce(sum(i.revenue),0)::float8 revenue
        FROM ad_campaigns c
        LEFT JOIN ad_insights i ON i.tenant_id = c.tenant_id AND i.level = 'campaign' AND i.external_ref_id = c.external_id
        GROUP BY c.id, c.name, c.external_id, c.objective, c.status
        ORDER BY spend DESC`;
      return rows.map((r) => ({ id: r.id, nome: r.name, externalId: r.external_id, objetivo: r.objective, status: r.status, ...derive(r) }));
    });
  }

  async creatives(tenantId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<any[]>`
        SELECT cr.external_id, cr.name, cr.thumbnail_url, cr.preview_url, cr.format, cr.cta, cr.body,
               coalesce(m.roas,0)::float8 roas, coalesce(m.spend,0)::float8 spend, coalesce(m.leads,0)::float8 leads
        FROM ad_creatives cr
        LEFT JOIN LATERAL (
          SELECT sum(i.revenue)/NULLIF(sum(i.spend),0) roas, sum(i.spend) spend, sum(i.leads) leads
          FROM ad_insights i
          JOIN ad_campaigns c ON c.id = cr.campaign_id AND i.tenant_id = cr.tenant_id AND i.level='campaign' AND i.external_ref_id = c.external_id
        ) m ON true
        ORDER BY roas DESC NULLS LAST, spend DESC`;
      const mapped = rows.map((r) => ({
        externalId: r.external_id, nome: r.name, thumbnailUrl: r.thumbnail_url, previewUrl: r.preview_url,
        format: r.format, cta: r.cta, body: r.body, roas: n(r.roas), spend: n(r.spend), leads: n(r.leads),
      }));
      const bestIdx = mapped.findIndex((c) => c.roas > 0);
      return mapped.map((c, i) => ({ ...c, melhor: i === bestIdx }));
    });
  }
}

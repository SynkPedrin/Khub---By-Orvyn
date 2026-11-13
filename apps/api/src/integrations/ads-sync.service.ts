import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from './crypto.service';
import { ADS_CONNECTORS, type AdsConnector, type StoredCredentials } from './ads-connector';

/** Dados já buscados no provider, prontos para gravar numa transação só. */
type PacoteConta = {
  acc: Awaited<ReturnType<AdsConnector['listAdAccounts']>>[number];
  campaigns: Awaited<ReturnType<AdsConnector['syncCampaigns']>>;
  creatives: Awaited<ReturnType<AdsConnector['syncCreatives']>>;
  insights: Awaited<ReturnType<AdsConnector['syncInsights']>>;
};

@Injectable()
export class AdsSyncService {
  private readonly log = new Logger(AdsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    @Inject(ADS_CONNECTORS) private readonly connectors: Record<string, AdsConnector>,
  ) {}

  /**
   * Sincroniza uma integração: contas → campanhas/criativos/insights (últimos 30 dias).
   *
   * As chamadas de rede ao provider acontecem FORA da transação: uma
   * transação interativa do Prisma expira em 5s por padrão, e as chamadas à
   * Graph API estouravam esse teto — o sync morria com "Transaction already
   * closed" e a integração ficava `down` sem gravar nada. A transação fica
   * só com as escritas (rápidas), ainda assim com folga de 30s.
   */
  async run(tenantId: string, integrationId: string): Promise<{ records: number }> {
    const run = await this.prisma.withTenant(tenantId, (tx) =>
      tx.adSyncRun.create({ data: { tenantId, integrationId, provider: 'meta', status: 'running' }, select: { id: true } }),
    );
    try {
      // Leitura da integração: transação curta só para respeitar a RLS.
      const { provider, cred } = await this.prisma.withTenant(tenantId, async (tx) => {
        const integ = await tx.integration.findUnique({ where: { id: integrationId } });
        if (!integ?.credentialsEncrypted) throw new Error('integração sem credencial');
        return { provider: integ.provider, cred: this.crypto.decryptJson<StoredCredentials>(integ.credentialsEncrypted) };
      });
      const connector = this.connectors[provider];
      if (!connector) throw new Error(`conector ${provider} indisponível`);

      // Rede: fora de qualquer transação.
      const range = this.last30d();
      const pacotes: PacoteConta[] = [];
      for (const acc of await connector.listAdAccounts(cred)) {
        const [campaigns, creatives, insights] = await Promise.all([
          connector.syncCampaigns(cred, acc.externalId),
          connector.syncCreatives(cred, acc.externalId),
          connector.syncInsights(cred, acc.externalId, range),
        ]);
        pacotes.push({ acc, campaigns, creatives, insights });
      }

      // Escrita: uma transação, sem rede no meio.
      const records = await this.prisma.withTenant(
        tenantId,
        async (tx) => {
          let n = 0;
          for (const { acc, campaigns, creatives, insights } of pacotes) {
            const account = await tx.adAccount.upsert({
              where: { tenantId_provider_externalId: { tenantId, provider, externalId: acc.externalId } },
              create: { tenantId, integrationId, provider, externalId: acc.externalId, name: acc.name, currency: acc.currency, timezone: acc.timezone, status: acc.status ?? 'active' },
              update: { name: acc.name, currency: acc.currency, timezone: acc.timezone, status: acc.status ?? 'active' },
              select: { id: true },
            });

            for (const c of campaigns) {
              await tx.adCampaign.upsert({
                where: { tenantId_externalId: { tenantId, externalId: c.externalId } },
                create: { tenantId, adAccountId: account.id, externalId: c.externalId, name: c.name, objective: c.objective, status: c.status ?? 'active', dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget, startAt: c.startAt ? new Date(c.startAt) : null, stopAt: c.stopAt ? new Date(c.stopAt) : null },
                update: { name: c.name, objective: c.objective, status: c.status ?? 'active', dailyBudget: c.dailyBudget, lifetimeBudget: c.lifetimeBudget },
              });
              n++;
            }

            for (const cr of creatives) {
              await tx.adCreative.upsert({
                where: { tenantId_externalId: { tenantId, externalId: cr.externalId } },
                create: { tenantId, adAccountId: account.id, externalId: cr.externalId, name: cr.name, format: cr.format, thumbnailUrl: cr.thumbnailUrl, previewUrl: cr.previewUrl, body: cr.body, cta: cr.cta, status: cr.status ?? 'active' },
                update: { name: cr.name, thumbnailUrl: cr.thumbnailUrl, previewUrl: cr.previewUrl, body: cr.body, cta: cr.cta, status: cr.status ?? 'active' },
              });
              n++;
            }

            for (const ins of insights) {
              await tx.$executeRaw`
                INSERT INTO ad_insights (tenant_id, level, provider, external_ref_id, date, spend, impressions, clicks, ctr, cpc, cpm, reach, frequency, leads, conversions, revenue, roas, cpl, cpa)
                VALUES (${tenantId}::uuid, ${ins.level}, ${provider}, ${ins.externalRefId}, ${ins.date}::date,
                        ${ins.spend}, ${ins.impressions}, ${ins.clicks}, ${ins.ctr}, ${ins.cpc}, ${ins.cpm}, ${ins.reach}, ${ins.frequency},
                        ${ins.leads}, ${ins.conversions}, ${ins.revenue}, ${ins.roas}, ${ins.cpl}, ${ins.cpa})
                ON CONFLICT (tenant_id, provider, level, external_ref_id, date) DO UPDATE SET
                  spend=EXCLUDED.spend, impressions=EXCLUDED.impressions, clicks=EXCLUDED.clicks, ctr=EXCLUDED.ctr, cpc=EXCLUDED.cpc,
                  cpm=EXCLUDED.cpm, reach=EXCLUDED.reach, frequency=EXCLUDED.frequency, leads=EXCLUDED.leads, conversions=EXCLUDED.conversions,
                  revenue=EXCLUDED.revenue, roas=EXCLUDED.roas, cpl=EXCLUDED.cpl, cpa=EXCLUDED.cpa`;
              n++;
            }
          }
          await tx.integration.update({ where: { id: integrationId }, data: { lastSyncAt: new Date(), health: 'ok', status: 'connected', erro: null } });
          return n;
        },
        { timeout: 30_000, maxWait: 5_000 },
      );

      await this.prisma.withTenant(tenantId, (tx) =>
        tx.adSyncRun.update({ where: { id: run.id }, data: { status: 'success', finishedAt: new Date(), records } }),
      );
      return { records };
    } catch (e) {
      const msg = (e as Error).message;
      this.log.error(`sync falhou (${integrationId}): ${msg}`);
      await this.prisma.withTenant(tenantId, async (tx) => {
        await tx.adSyncRun.update({ where: { id: run.id }, data: { status: 'failed', finishedAt: new Date(), erro: msg } }).catch(() => undefined);
        await tx.integration.update({ where: { id: integrationId }, data: { health: 'down', erro: msg } }).catch(() => undefined);
      });
      throw e;
    }
  }

  private last30d() {
    const until = new Date();
    const since = new Date(until.getTime() - 30 * 86400000);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    return { since: fmt(since), until: fmt(until) };
  }
}

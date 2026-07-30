import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { MetaLeadsService } from './meta-leads.service';
import { CryptoService } from './crypto.service';
import { MetaGraphClient, META_GRAPH } from './providers/meta-graph.client';
import { MetaAdsConnector } from './providers/meta-ads.connector';
import { ADS_CONNECTORS, type AdsConnector } from './ads-connector';
import { IntegrationsService } from './integrations.service';
import { AdsService } from './ads.service';
import { AdsSyncService } from './ads-sync.service';
import { AdsSyncProcessor } from './ads-sync.processor';
import { AdsController, IntegrationsController } from './integrations.controller';
import { MetaWebhookController } from './meta-webhook.controller';

function redisConn() {
  const u = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
  return { host: u.hostname, port: Number(u.port || 6379), maxRetriesPerRequest: null };
}

@Module({
  imports: [
    BullModule.forRoot({ connection: redisConn() }),
    BullModule.registerQueue({ name: 'ads-sync' }),
    // integrations -> crm (superfície pública: LeadsService). O CRM não conhece
    // integrations, então não há ciclo: quem tem a credencial busca o lead e
    // entrega para quem sabe criar contato.
    CrmModule,
  ],
  controllers: [IntegrationsController, AdsController, MetaWebhookController],
  providers: [
    MetaLeadsService,
    CryptoService,
    { provide: META_GRAPH, useClass: MetaGraphClient },
    MetaAdsConnector,
    {
      provide: ADS_CONNECTORS,
      inject: [MetaAdsConnector],
      useFactory: (meta: MetaAdsConnector): Record<string, AdsConnector> => ({ meta }),
    },
    IntegrationsService,
    AdsService,
    AdsSyncService,
    AdsSyncProcessor,
  ],
  exports: [AdsSyncService, CryptoService],
})
export class IntegrationsModule {}

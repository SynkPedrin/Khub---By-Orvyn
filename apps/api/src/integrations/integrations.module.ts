import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { CrmModule } from '../crm/crm.module';
import { RedesModule } from '../redes/redes.module';
import { MetaLeadsService } from './meta-leads.service';
import { CryptoService } from './crypto.service';
import { MetaGraphClient, META_GRAPH } from './providers/meta-graph.client';
import { MetaAdsConnector } from './providers/meta-ads.connector';
import { ADS_CONNECTORS, type AdsConnector } from './ads-connector';
import { IntegrationsService } from './integrations.service';
import { AdsService } from './ads.service';
import { AdsSimulatorService } from './ads-simulator.service';
import { AdsSyncService } from './ads-sync.service';
import { AdsSyncProcessor } from './ads-sync.processor';
import { AdsSyncScheduler } from './ads-sync.scheduler';
import { AdsController, AdsSimuladorController, IntegrationsController } from './integrations.controller';
import { MetaWebhookController } from './meta-webhook.controller';
import { AvecModule } from './avec/avec.module';

import { queueConnection, isWorker } from '../common/queue-connection';

@Module({
  imports: [
    BullModule.forRoot({ connection: queueConnection() }),
    BullModule.registerQueue({ name: 'ads-sync' }),
    // integrations -> crm (superfície pública: LeadsService). O CRM não conhece
    // integrations, então não há ciclo: quem tem a credencial busca o lead e
    // entrega para quem sabe criar contato.
    CrmModule,
    // integrations -> redes (o simulador puxa posts do Instagram). Redes não
    // importa integrations como módulo, então não há ciclo.
    RedesModule,
    // Agenda do Avec: o processor da fila 'ads-sync' roda o sync periódico dela.
    AvecModule,
  ],
  controllers: [IntegrationsController, AdsController, AdsSimuladorController, MetaWebhookController],
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
    AdsSimulatorService,
    AdsSyncService,
    AdsSyncScheduler,
    ...(isWorker() ? [AdsSyncProcessor] : []),
  ],
  exports: [AdsSyncService, CryptoService, MetaLeadsService],
})
export class IntegrationsModule {}

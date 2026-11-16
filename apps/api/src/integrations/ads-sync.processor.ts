import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AdsSyncService } from './ads-sync.service';
import { ADS_CONNECTORS, type AdsConnector } from './ads-connector';

interface SyncJob {
  tenantId: string;
  integrationId: string;
}

interface ResultadoSyncTodos {
  integracoes: number;
  records: number;
  falhas: number;
}

@Processor('ads-sync')
export class AdsSyncProcessor extends WorkerHost {
  private readonly log = new Logger(AdsSyncProcessor.name);

  constructor(
    private readonly sync: AdsSyncService,
    private readonly prisma: PrismaService,
    @Inject(ADS_CONNECTORS) private readonly connectors: Record<string, AdsConnector>,
  ) {
    super();
  }

  async process(job: Job<SyncJob>): Promise<{ records: number } | ResultadoSyncTodos> {
    // 'sync-todos' vem do agendador periódico (ads-sync.scheduler.ts); o resto
    // é o sync manual de UMA integração (POST /integrations/:id/sync).
    if (job.name === 'sync-todos') return this.syncTodos();
    const { tenantId, integrationId } = job.data;
    this.log.debug(`ads-sync ${integrationId} (tenant ${tenantId.slice(0, 8)})`);
    return this.sync.run(tenantId, integrationId);
  }

  /**
   * Varredura periódica: toda integração de anúncios conectada. A lista vem de
   * `ads_integracoes_para_sync` (db/073, SECURITY DEFINER): sem tenant na
   * sessão a RLS esconderia tudo. Cada sync roda sob a RLS do próprio tenant
   * dentro de AdsSyncService.run. Falha de uma integração não derruba as
   * outras — o run já marca health/erro nela.
   */
  private async syncTodos(): Promise<ResultadoSyncTodos> {
    const integracoes = await this.prisma.$queryRaw<{ id: string; tenant_id: string }[]>`
      SELECT tenant_id, integration_id AS id FROM ads_integracoes_para_sync(${Object.keys(this.connectors)}::text[])`;
    let records = 0;
    let falhas = 0;
    for (const i of integracoes) {
      try {
        records += (await this.sync.run(i.tenant_id, i.id)).records;
      } catch (e) {
        falhas++;
        this.log.error(`sync periódico ${i.id}: ${(e as Error).message}`);
      }
    }
    this.log.log(`sync periódico de anúncios: ${integracoes.length} integrações, ${records} registros, ${falhas} falhas`);
    return { integracoes: integracoes.length, records, falhas };
  }
}

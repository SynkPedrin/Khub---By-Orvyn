import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AdsSyncService } from './ads-sync.service';

interface SyncJob {
  tenantId: string;
  integrationId: string;
}

@Processor('ads-sync')
export class AdsSyncProcessor extends WorkerHost {
  private readonly log = new Logger(AdsSyncProcessor.name);

  constructor(private readonly sync: AdsSyncService) {
    super();
  }

  async process(job: Job<SyncJob>): Promise<{ records: number }> {
    const { tenantId, integrationId } = job.data;
    this.log.debug(`ads-sync ${integrationId} (tenant ${tenantId.slice(0, 8)})`);
    return this.sync.run(tenantId, integrationId);
  }
}

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { isWorker } from '../common/queue-connection';

/** 4x ao dia: a Graph API consolida insights com atraso, sync mais frequente repete dado. */
const A_CADA = 6 * 3_600_000;

/**
 * Agenda o sync periódico de anúncios (SÓ no worker, mesmo desenho de
 * redes.worker.ts). Sem ele o sync só rodava no clique manual
 * (POST /integrations/:id/sync) e o painel ficava semanas desatualizado.
 */
@Injectable()
export class AdsSyncScheduler implements OnModuleInit {
  private readonly log = new Logger(AdsSyncScheduler.name);

  constructor(@InjectQueue('ads-sync') private readonly fila: Queue) {}

  async onModuleInit() {
    if (!isWorker()) return;
    await this.fila.upsertJobScheduler('ads-sync-6h', { every: A_CADA }, { name: 'sync-todos', data: {}, opts: { removeOnComplete: 20, removeOnFail: 100 } });
    this.log.log('sync de anúncios agendado (a cada 6h)');
  }
}

import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { isWorker } from '../common/queue-connection';

/** 4x ao dia: a Graph API consolida insights com atraso, sync mais frequente repete dado. */
const A_CADA = 6 * 3_600_000;
/** Agenda do Avec (ADR-0052): a cada 10 min; antes de oferecer/reservar a IA ainda relê o dia ao vivo. */
const AVEC_A_CADA = 10 * 60_000;
/** Saúde do WhatsApp (Stevo): a cada 5 min — instância que para sem avisar aparece em minutos, não em dias. */
const WHATSAPP_A_CADA = 5 * 60_000;

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
    await this.fila.upsertJobScheduler('avec-agenda-10min', { every: AVEC_A_CADA }, { name: 'avec-agenda', data: {}, opts: { removeOnComplete: 20, removeOnFail: 100 } });
    await this.fila.upsertJobScheduler('whatsapp-saude-5min', { every: WHATSAPP_A_CADA }, { name: 'whatsapp-saude', data: {}, opts: { removeOnComplete: 20, removeOnFail: 100 } });
    this.log.log('sync de anúncios agendado (a cada 6h), agenda do Avec (a cada 10 min) e saúde do WhatsApp (a cada 5 min)');
  }
}

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { DeliveryService, FILA_ENTREGAS, type EntregaJob } from './delivery.service';

/**
 * Worker de entrega dos blocos. Concorrência e limiter respeitam o provedor:
 * no máximo 20 envios/s no cluster (Evolution/Stevo aguentam bem menos que o
 * Redis) — o excesso espera na fila, não falha.
 */
@Processor(FILA_ENTREGAS, { concurrency: 8, limiter: { max: 20, duration: 1000 } })
export class DeliveryProcessor extends WorkerHost {
  private readonly log = new Logger('AgentDelivery');

  constructor(private readonly entregas: DeliveryService) {
    super();
  }

  async process(job: Job<EntregaJob>): Promise<void> {
    const r = await this.entregas.processar(job.data);
    if (r !== 'enviado' && r !== 'ignorado') this.log.log(`bloco ${job.data.deliveryId}: ${r}`);
  }
}

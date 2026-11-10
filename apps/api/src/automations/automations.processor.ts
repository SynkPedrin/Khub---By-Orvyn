import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { RunsService, FILA_PASSOS, type PassoJob } from './runs.service';
import { TriggersService } from './triggers.service';
import { FILA_GATILHOS, type GatilhoJob } from '../events/domain-events.service';

/** Worker dos PASSOS: um job = um nó. Retry/backoff vêm do BullMQ. */
@Processor(FILA_PASSOS, { concurrency: 8 })
export class PassosProcessor extends WorkerHost {
  private readonly log = new Logger('Automations');

  constructor(private readonly runs: RunsService) {
    super();
  }

  async process(job: Job<PassoJob>): Promise<void> {
    await this.runs.processarPasso(job.data, job.attemptsMade + 1);
  }

  /** Última tentativa falhou → dead-letter (PRD §7.2), com o run marcado. */
  @OnWorkerEvent('failed')
  async aoFalhar(job: Job<PassoJob>, erro: Error): Promise<void> {
    const tentativas = job.attemptsMade;
    const maximo = job.opts.attempts ?? 1;
    if (tentativas < maximo && erro.name !== 'UnrecoverableError') {
      this.log.warn(`passo ${job.data.noId} falhou (${tentativas}/${maximo}), vai tentar de novo: ${erro.message}`);
      return;
    }
    await this.runs.paraDlq(job.data, erro.message, tentativas).catch((e) => this.log.error(`falha ao gravar DLQ: ${(e as Error).message}`));
  }
}

/** Worker dos GATILHOS: casa evento de domínio com workflow ativo. */
@Processor(FILA_GATILHOS, { concurrency: 8 })
export class GatilhosProcessor extends WorkerHost {
  private readonly log = new Logger('Automations');

  constructor(private readonly triggers: TriggersService) {
    super();
  }

  async process(job: Job<GatilhoJob>): Promise<void> {
    await this.triggers.processar(job.data);
  }

  @OnWorkerEvent('failed')
  aoFalhar(job: Job<GatilhoJob>, erro: Error): void {
    this.log.error(`gatilho ${job.data?.evento} falhou: ${erro.message}`);
  }
}

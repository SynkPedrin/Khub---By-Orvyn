import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { AgentRuntimeService, FILA_AGENTES, type AgenteJob } from './agent-runtime.service';

/**
 * Worker das respostas de agente. Concorrência moderada: cada job é uma ida
 * (ou algumas) ao modelo. Retry só para falha de infraestrutura ANTES do run
 * existir — depois disso o runtime é idempotente e transfere em caso de erro.
 */
@Processor(FILA_AGENTES, { concurrency: 4 })
export class AgentesProcessor extends WorkerHost {
  private readonly log = new Logger('Agentes');

  constructor(private readonly runtime: AgentRuntimeService) {
    super();
  }

  async process(job: Job<AgenteJob>): Promise<void> {
    const desfecho = await this.runtime.responder(job.data);
    if (desfecho !== 'nada') this.log.log(`mensagem ${job.data.messageId}: ${desfecho}`);
  }
}

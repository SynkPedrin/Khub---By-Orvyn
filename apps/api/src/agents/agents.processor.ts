import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, type Job } from 'bullmq';
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

  async process(job: Job<AgenteJob>, token?: string): Promise<void> {
    const r = await this.runtime.responderOuAdiar(job.data);
    if (r.desfecho === 'adiado' && r.adiarAte && token) {
      // Fora do horário: o MESMO job volta para a fila na abertura (BullMQ).
      this.log.log(`mensagem ${job.data.messageId}: fora do horário, responde em ${r.adiarAte.toISOString()}`);
      await job.moveToDelayed(r.adiarAte.getTime(), token);
      throw new DelayedError();
    }
    if (r.desfecho !== 'nada') this.log.log(`mensagem ${job.data.messageId}: ${r.desfecho}`);
  }
}

import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { isWorker } from '../common/queue-connection';
import { RedesPublicacaoService } from './redes-publicacao.service';
import { RedesService } from './redes.service';

export const FILA_REDES = 'redes-sociais';

/**
 * Tique das redes (SÓ no processo worker, a cada 60 s; mesmo desenho de
 * agents/workers.ts): publica o que venceu, acompanha o processamento na rede
 * e, 1x por hora, tira a foto diária das contas que ainda não têm a de hoje.
 */
@Injectable()
export class RedesScheduler implements OnModuleInit {
  private readonly log = new Logger('RedesWorker');
  constructor(@InjectQueue(FILA_REDES) private readonly fila: Queue) {}

  async onModuleInit() {
    if (!isWorker()) return;
    await this.fila.upsertJobScheduler('redes-tick', { every: 60_000 }, { name: 'tick', data: {}, opts: { removeOnComplete: 20, removeOnFail: 100 } });
    this.log.log('tique das redes sociais agendado (60s)');
  }
}

@Processor(FILA_REDES, { concurrency: 1 })
export class RedesProcessor extends WorkerHost {
  private readonly log = new Logger('RedesWorker');
  private ultimaFoto = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publicacoes: RedesPublicacaoService,
    private readonly redes: RedesService,
  ) {
    super();
  }

  async process(): Promise<void> {
    // Só (tenant_id, id) atravessa: a leitura real roda depois sob RLS do tenant (db/068).
    const pendentes = await this.prisma.$queryRaw<{ tenant_id: string; id: string }[]>`SELECT tenant_id, id FROM redes_publicacoes_pendentes(50)`;
    for (const p of pendentes) {
      await this.publicacoes.processar(p.tenant_id, p.id).catch((e: Error) => this.log.error(`publicação ${p.id} (tenant ${p.tenant_id}): ${e.message}`));
    }
    if (Date.now() - this.ultimaFoto < 3_600_000) return;
    this.ultimaFoto = Date.now();
    const contas = await this.prisma.$queryRaw<{ tenant_id: string; id: string }[]>`SELECT tenant_id, id FROM redes_conexoes_sem_snapshot(50)`;
    for (const c of contas) {
      await this.redes.fotografarConta(c.tenant_id, c.id).catch((e: Error) => this.log.warn(`foto diária ${c.id} (tenant ${c.tenant_id}): ${e.message}`));
    }
  }
}

import { OnModuleInit, Logger } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { DisparosService } from './disparos.service';

export const FILA_DISPAROS = 'khub-broadcasts';
/** De quanto em quanto tempo o worker procura lote vencido. */
export const INTERVALO_VARREDURA_MS = 10_000;

/**
 * Worker dos disparos (só existe com KHUB_PROCESS_ROLE=worker). Um job
 * repetido varre os tenants ativos e manda os lotes vencidos. Concorrência 1
 * por processo; entre processos, o lease em `broadcasts` garante um só por disparo.
 */
@Processor(FILA_DISPAROS, { concurrency: 1 })
export class DisparosProcessor extends WorkerHost implements OnModuleInit {
  private readonly log = new Logger('Disparos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly disparos: DisparosService,
    @InjectQueue(FILA_DISPAROS) private readonly fila: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.fila.upsertJobScheduler('varrer', { every: INTERVALO_VARREDURA_MS }, { name: 'varrer', data: {}, opts: { removeOnComplete: 10, removeOnFail: 50 } })
      .catch((e: Error) => this.log.error(`agendador de disparos não instalado: ${e.message}`));
  }

  async process(_job: Job): Promise<void> {
    await this.varrer();
  }

  async varrer(agora = new Date()): Promise<void> {
    let cursor: string | undefined;
    do {
      const tenants = await this.prisma.tenant.findMany({ where: { status: 'active' }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!tenants.length) break;
      for (const t of tenants) {
        try {
          for (const id of await this.disparos.pendentesDoTenant(t.id, agora)) {
            const r = await this.disparos.processarLote(t.id, id);
            if (r.resultado !== 'ocupado' && r.resultado !== 'fora_da_janela') this.log.log(`disparo ${id} (tenant ${t.id}): ${r.resultado}${r.enviados !== undefined ? `, ${r.enviados} enviado(s)` : ''}`);
          }
        } catch (e) {
          // Um tenant com problema não trava os outros.
          this.log.error(`varredura de disparos falhou (tenant ${t.id}): ${(e as Error).message}`);
        }
      }
      cursor = tenants.at(-1)!.id;
    } while (cursor);
  }
}

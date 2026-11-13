import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { isWorker } from '../common/queue-connection';
import { NyroService } from './nyro.service';
import { proximaExecucao, type Frequencia } from './analises.service';

export const FILA_NICO_ROTINAS = 'nico-rotinas';
/** Rotina atrasada além disso (worker parado) não roda: relatório "de segunda" na sexta é ruído. Pula para a próxima. */
const TOLERANCIA_MS = 6 * 3_600_000;
/** No máximo isto por tenant a cada passada: rotina em excesso não monopoliza o worker. */
const MAX_POR_TENANT = 5;

/** Registra o tick de 60s (só no processo worker). */
@Injectable()
export class NicoRotinasScheduler implements OnModuleInit {
  private readonly log = new Logger('NicoRotinas');
  constructor(@InjectQueue(FILA_NICO_ROTINAS) private readonly fila: Queue) {}

  async onModuleInit() {
    if (!isWorker()) return;
    await this.fila.upsertJobScheduler('nico-rotinas-tick', { every: 60_000 }, { name: 'tick', data: {}, opts: { removeOnComplete: 20, removeOnFail: 100 } });
    this.log.log('rotinas da NICO agendadas (tick de 60s)');
  }
}

/**
 * Executa as rotinas da NICO (`agendar_rotina`). Antes disto as rotinas eram
 * gravadas e NUNCA rodavam. A "reserva" é atômica: o `proximo_em` avança no
 * mesmo UPDATE que confere o vencimento, então dois workers nunca rodam a mesma.
 */
@Processor(FILA_NICO_ROTINAS, { concurrency: 1 })
export class NicoRotinasProcessor extends WorkerHost {
  private readonly log = new Logger('NicoRotinas');

  constructor(private readonly prisma: PrismaService, private readonly nyro: NyroService) {
    super();
  }

  async process(): Promise<void> {
    if (!this.nyro.configurada()) return; // sem chave não há o que rodar (gating)
    let cursor: string | undefined;
    do {
      const tenants = await this.prisma.tenant.findMany({ where: { status: 'active' }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!tenants.length) break;
      for (const t of tenants) await this.rodarVencidas(t.id).catch((e: Error) => this.log.error(`rotinas (tenant ${t.id}): ${e.message}`));
      cursor = tenants[tenants.length - 1].id;
    } while (cursor);
  }

  private async rodarVencidas(tenantId: string, agora = new Date()): Promise<void> {
    const vencidas = await this.prisma.withTenant(tenantId, (tx) =>
      tx.nicoAgendamento.findMany({ where: { ativo: true, proximoEm: { lte: agora } }, orderBy: { proximoEm: 'asc' }, take: MAX_POR_TENANT }),
    );
    for (const a of vencidas) {
      const proximo = proximaExecucao({ frequencia: a.frequencia as Frequencia, hora: a.hora, diaSemana: a.diaSemana, diaMes: a.diaMes, fuso: a.fuso }, agora);
      // reserva atômica: só quem avançar o proximo_em executa
      const reservou = await this.prisma.withTenant(tenantId, (tx) => tx.nicoAgendamento.updateMany({ where: { id: a.id, ativo: true, proximoEm: a.proximoEm }, data: { proximoEm: proximo, updatedAt: new Date() } }));
      if (!reservou.count) continue;
      if (agora.getTime() - a.proximoEm.getTime() > TOLERANCIA_MS) {
        await this.registrar(tenantId, a.id, 'pulada', 'janela perdida (worker parado); seguiu para a próxima execução');
        continue;
      }
      try {
        await this.nyro.executarRotina({ id: a.id, tenantId, titulo: a.titulo, instrucao: a.instrucao, destinatarioId: a.destinatarioId, criadoPor: a.criadoPor });
        await this.registrar(tenantId, a.id, 'ok', null);
      } catch (e) {
        const msg = (e as Error).message.slice(0, 300);
        this.log.warn(`rotina "${a.titulo}" falhou (tenant ${tenantId}): ${msg}`);
        await this.registrar(tenantId, a.id, 'erro', msg);
      }
    }
  }

  private registrar(tenantId: string, id: string, status: string, erro: string | null) {
    return this.prisma.withTenant(tenantId, (tx) => tx.nicoAgendamento.update({ where: { id }, data: { ultimoEm: new Date(), ultimoStatus: status, ultimoErro: erro } })).catch(() => undefined);
  }
}

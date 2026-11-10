import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Job, Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { isWorker } from '../common/queue-connection';
import { DeliveryService } from './delivery/delivery.service';
import { EvaluationService, FILA_AVALIACOES, type AvaliacaoJob } from './evaluation/evaluation.service';
import { FollowupService } from './followup/followup.service';
import { MemoryService } from './intelligence/memory.service';
import { aplicarPatch, LearningService } from './learning/learning.service';
import { resolverConfig } from './config/agent-config';
import { VersioningService } from './versioning/versioning.service';

export const FILA_MANUTENCAO_AGENTES = 'agent-maintenance';

/**
 * Avaliações (fila própria: uma avaliação = vários cenários × modelo).
 * Quando a avaliação é de uma PROPOSTA aprovada por humano:
 *   sem regressão → o patch entra no rascunho (e publica, se pedido);
 *   com regressão → a proposta volta para `aberta` com o resultado anexado
 *   (o humano decide aplicar mesmo assim, com `forcar`).
 */
@Processor(FILA_AVALIACOES, { concurrency: 2 })
export class AvaliacoesProcessor extends WorkerHost {
  private readonly log = new Logger('AgentEvaluation');

  constructor(
    private readonly prisma: PrismaService,
    private readonly avaliacoes: EvaluationService,
    private readonly aprendizado: LearningService,
    private readonly versoes: VersioningService,
  ) {
    super();
  }

  async process(job: Job<AvaliacaoJob>): Promise<void> {
    const av = await this.avaliacoes.executar(job.data);
    if (!av) return;
    this.log.log(`avaliação ${av.id}: nota ${av.nota ?? '—'}${av.regressao ? ' (REGRESSÃO)' : ''}`);
    if (av.alvo !== 'proposta' || !av.propostaId) return;
    const { tenantId } = job.data;
    const proposta = await this.aprendizado.obterProposta(tenantId, av.propostaId);
    if (av.regressao) {
      await this.aprendizado.marcar(tenantId, av.propostaId, { status: 'aberta', avaliacaoId: av.id });
      return;
    }
    await aplicarPropostaNoRascunho(this.prisma, tenantId, proposta.agentId, proposta.patch);
    await this.aprendizado.marcar(tenantId, av.propostaId, { status: 'aplicada', avaliacaoId: av.id });
    if ((av.metricas as Record<string, unknown>)?.publicarSeAprovada) {
      await this.versoes
        .publicar(tenantId, { identityId: proposta.decididoPor ?? '' }, proposta.agentId, { notas: `Proposta aplicada: ${proposta.titulo}`, origem: 'proposta', propostaId: proposta.id })
        .catch((e: Error) => this.log.warn(`proposta aplicada mas não publicada: ${e.message}`));
    }
  }
}

/** Patch de proposta → rascunho (só comportamento/regras/gatilhos — nunca políticas). */
export async function aplicarPropostaNoRascunho(prisma: PrismaService, tenantId: string, agentId: string, patch: unknown) {
  if (!patch) return;
  await prisma.withTenant(tenantId, async (tx) => {
    const a = await tx.agent.findUnique({ where: { id: agentId }, select: { config: true } });
    if (!a) return;
    const nova = aplicarPatch(resolverConfig(a.config).config, patch);
    await tx.agent.update({ where: { id: agentId }, data: { config: nova as unknown as Prisma.InputJsonValue, updatedAt: new Date() } });
  });
}

/**
 * Manutenção dos agentes (worker, a cada minuto): follow-ups vencidos,
 * recuperação de blocos de entrega perdidos, retenção de memória e — 1×/hora
 * por tenant — varreduras de reativação/oportunidade perdida e detecção de
 * padrões de aprendizado.
 */
@Injectable()
export class ManutencaoAgentesScheduler implements OnModuleInit {
  private readonly log = new Logger('AgentMaintenance');
  constructor(@InjectQueue(FILA_MANUTENCAO_AGENTES) private readonly fila: Queue) {}

  async onModuleInit() {
    if (!isWorker()) return;
    await this.fila.upsertJobScheduler('agentes-tick', { every: 60_000 }, { name: 'tick', data: {}, opts: { removeOnComplete: 20, removeOnFail: 100 } });
    this.log.log('manutenção dos agentes agendada (60s)');
  }
}

@Processor(FILA_MANUTENCAO_AGENTES, { concurrency: 1 })
export class ManutencaoAgentesProcessor extends WorkerHost {
  private readonly log = new Logger('AgentMaintenance');
  private ultimaVarredura = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly followups: FollowupService,
    private readonly entregas: DeliveryService,
    private readonly memoria: MemoryService,
    private readonly aprendizado: LearningService,
  ) {
    super();
  }

  async process(): Promise<void> {
    let cursor: string | undefined;
    do {
      const tenants = await this.prisma.tenant.findMany({ where: { status: 'active' }, select: { id: true }, orderBy: { id: 'asc' }, take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
      if (!tenants.length) break;
      for (const t of tenants) {
        const temAgente = await this.prisma.withTenant(t.id, (tx) => tx.agent.count({ where: { status: { in: ['ativo', 'pausado'] } } }));
        if (!temAgente) continue;
        await this.followups.processarVencidos(t.id).catch((e: Error) => this.log.error(`follow-ups (tenant ${t.id}): ${e.message}`));
        await this.entregas.reconciliar(t.id).catch((e: Error) => this.log.error(`entregas (tenant ${t.id}): ${e.message}`));
        const ultima = this.ultimaVarredura.get(t.id) ?? 0;
        if (Date.now() - ultima > 3_600_000) {
          this.ultimaVarredura.set(t.id, Date.now());
          await this.memoria.removerExpiradas(t.id).catch((e: Error) => this.log.error(`retenção (tenant ${t.id}): ${e.message}`));
          await this.followups.varrer(t.id).catch((e: Error) => this.log.error(`varredura (tenant ${t.id}): ${e.message}`));
          const agentes = await this.prisma.withTenant(t.id, (tx) => tx.agent.findMany({ where: { status: 'ativo' }, select: { id: true } }));
          for (const a of agentes) await this.aprendizado.analisar(t.id, a.id).catch((e: Error) => this.log.error(`aprendizado (agente ${a.id}): ${e.message}`));
        }
      }
      cursor = tenants[tenants.length - 1].id;
    } while (cursor);
  }
}

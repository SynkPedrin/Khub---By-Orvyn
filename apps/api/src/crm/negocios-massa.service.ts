import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { DomainEventsService } from '../events/domain-events.service';
import { MAX_OBS_PERDA, limparObsPerda, resolverMotivoPerda } from './lost-reasons.service';

/** Teto por operação em massa de negócios (Q2.1). */
export const LIMITE_MASSA_NEGOCIOS = 1000;

export const ACOES_MASSA_NEGOCIOS = ['etapa', 'dono', 'ganho', 'perdido', 'excluir'] as const;
export type AcaoMassaNegocios = (typeof ACOES_MASSA_NEGOCIOS)[number];

/** Parâmetros por ação: validados aqui (o formato depende da ação). */
export const PARAMS_MASSA_NEGOCIOS = {
  etapa: z.object({ stageId: z.string().uuid() }).strict(),
  dono: z.object({ ownerId: z.string().uuid().nullable() }).strict(),
  ganho: z.object({}).strict(),
  perdido: z.object({ motivoPerdaId: z.string().uuid().nullable().optional(), motivoPerdaObs: z.string().max(MAX_OBS_PERDA).nullable().optional() }).strict(),
  excluir: z.object({}).strict(),
} satisfies Record<AcaoMassaNegocios, z.ZodTypeAny>;

export interface EntradaMassaNegocios {
  ids: string[];
  acao: AcaoMassaNegocios;
  params?: unknown;
}
export interface ResultadoMassaNegocios {
  acao: AcaoMassaNegocios;
  /** Negócios alcançados (ids que existem no tenant). */
  alvo: number;
  /** Efetivamente alterados. */
  afetados: number;
  /** Alcançados que já estavam como pedido (mesma etapa, mesmo dono, já ganho...). */
  ignorados: number;
}

const DESCRICAO: Record<AcaoMassaNegocios, string> = {
  etapa: 'moveu de etapa', dono: 'atribuiu dono a', ganho: 'marcou como ganho', perdido: 'marcou como perdido', excluir: 'excluiu',
};

/**
 * Ações em massa da visão Lista do Pipeline (Q2.1). Uma transação por
 * operação, sob RLS, com UMA linha de auditoria (`deals.bulk.<acao>`) que
 * leva os ids e os parâmetros. Os eventos duráveis (`deal.moved`,
 * `deal.status_changed`) saem do gatilho de outbox do banco por linha, como
 * no PATCH unitário; aqui só avisamos as telas (`pipeline.updated`).
 * Perdido em massa segue a regra do unitário: motivo obrigatório se o tenant
 * tem motivos ativos.
 */
@Injectable()
export class NegociosMassaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventos: DomainEventsService,
  ) {}

  async executar(tenantId: string, identityId: string, entrada: EntradaMassaNegocios): Promise<ResultadoMassaNegocios> {
    const schema = PARAMS_MASSA_NEGOCIOS[entrada.acao];
    if (!schema) throw new BadRequestException('ação inválida');
    const p = schema.safeParse(entrada.params ?? {});
    if (!p.success) throw new BadRequestException(`parâmetros inválidos para "${entrada.acao}": ${p.error.issues.map((i) => `${i.path.join('.') || 'params'} ${i.message}`).join('; ')}`);
    const params = p.data as Record<string, unknown>;
    if (!Array.isArray(entrada.ids) || entrada.ids.length === 0) throw new BadRequestException('informe os ids dos negócios');
    const unicos = [...new Set(entrada.ids)];
    if (unicos.length > LIMITE_MASSA_NEGOCIOS) throw new BadRequestException(`no máximo ${LIMITE_MASSA_NEGOCIOS} negócios por operação`);

    const r = await this.prisma.withTenant(tenantId, async (tx) => {
      // ids de outro tenant somem aqui (RLS), em silêncio
      const alvo = await tx.deal.findMany({ where: { id: { in: unicos } }, select: { id: true, titulo: true, pipelineId: true, contactId: true } });
      const ids = alvo.map((d) => d.id);
      const aplicado = ids.length ? await this.aplicar(tx, tenantId, entrada.acao, params, alvo) : { afetados: 0, detalhe: {}, funis: [] as string[] };
      const resultado: ResultadoMassaNegocios = { acao: entrada.acao, alvo: ids.length, afetados: aplicado.afetados, ignorados: Math.max(ids.length - aplicado.afetados, 0) };
      if (aplicado.afetados > 0) {
        await tx.activity.create({ data: { tenantId, actor: 'Você', acao: `${DESCRICAO[entrada.acao]} ${aplicado.afetados} negócio(s) em massa`, tone: entrada.acao === 'excluir' || entrada.acao === 'perdido' ? 'warn' : 'neutral' } });
      }
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, ${`deals.bulk.${entrada.acao}`}, 'deal', NULL,
                ${JSON.stringify({ params, alvo: ids.length, afetados: aplicado.afetados, ...aplicado.detalhe, ids })}::jsonb)`;
      return { resultado, funis: [...new Set([...alvo.map((d) => d.pipelineId), ...aplicado.funis])] };
    }, { timeout: 60_000 });

    if (r.resultado.afetados > 0) for (const id of r.funis) this.eventos.publicar(tenantId, 'pipeline.updated', { id });
    return r.resultado;
  }

  private async aplicar(
    tx: Prisma.TransactionClient,
    tenantId: string,
    acao: AcaoMassaNegocios,
    params: Record<string, unknown>,
    alvo: { id: string; titulo: string; pipelineId: string; contactId: string | null }[],
  ): Promise<{ afetados: number; detalhe: Record<string, unknown>; funis: string[] }> {
    const ids = alvo.map((d) => d.id);
    const agora = new Date();
    switch (acao) {
      case 'etapa': {
        const stage = await tx.stage.findUnique({ where: { id: params.stageId as string }, select: { id: true, nome: true, pipelineId: true } });
        if (!stage) throw new NotFoundException('etapa inexistente');
        const mover = await tx.deal.findMany({ where: { id: { in: ids }, stageId: { not: stage.id } }, select: { id: true, titulo: true, contactId: true } });
        if (mover.length) {
          await tx.deal.updateMany({ where: { id: { in: mover.map((d) => d.id) } }, data: { stageId: stage.id, pipelineId: stage.pipelineId, updatedAt: agora } });
          await tx.activity.createMany({ data: mover.map((d) => ({ tenantId, actor: 'Você', acao: `moveu "${d.titulo}" para ${stage.nome}`, tone: 'neutral', dealId: d.id, contactId: d.contactId })) });
        }
        return { afetados: mover.length, detalhe: { stageId: stage.id }, funis: [stage.pipelineId] };
      }
      case 'dono': {
        const ownerId = params.ownerId as string | null;
        if (ownerId) {
          const m = await tx.membership.findUnique({ where: { identityId_tenantId: { identityId: ownerId, tenantId } }, select: { id: true } });
          if (!m) throw new BadRequestException('responsável não é membro desta operação');
        }
        const r = await tx.deal.updateMany({
          where: { id: { in: ids }, ...(ownerId ? { OR: [{ ownerId: null }, { ownerId: { not: ownerId } }] } : { ownerId: { not: null } }) },
          data: { ownerId, updatedAt: agora },
        });
        return { afetados: r.count, detalhe: { ownerId }, funis: [] };
      }
      case 'ganho': {
        const r = await tx.deal.updateMany({ where: { id: { in: ids }, status: { not: 'ganho' } }, data: { status: 'ganho', motivoPerdaId: null, motivoPerdaObs: null, updatedAt: agora } });
        return { afetados: r.count, detalhe: {}, funis: [] };
      }
      case 'perdido': {
        const motivoPerdaId = await resolverMotivoPerda(tx, tenantId, params.motivoPerdaId as string | null | undefined, true);
        const motivoPerdaObs = limparObsPerda(params.motivoPerdaObs as string | null | undefined) ?? null;
        const r = await tx.deal.updateMany({ where: { id: { in: ids }, status: { not: 'perdido' } }, data: { status: 'perdido', motivoPerdaId, motivoPerdaObs, updatedAt: agora } });
        return { afetados: r.count, detalhe: { motivoPerdaId }, funis: [] };
      }
      case 'excluir': {
        // mesma semântica do DELETE unitário: tarefas/notas/atividades do negócio caem junto (CASCADE)
        const r = await tx.deal.deleteMany({ where: { id: { in: ids } } });
        return { afetados: r.count, detalhe: { titulos: alvo.slice(0, 50).map((d) => d.titulo) }, funis: [] };
      }
    }
  }
}

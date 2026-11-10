import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Analytics dedicado: custo de IA por tenant + performance de automações. Só
 *  leitura, sempre sob RLS (withTenant). Nada de dado global. */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private cutoff(dias: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - Math.max(1, Math.min(dias, 365)));
    return d;
  }

  async aiUsage(tenantId: string, dias = 30) {
    const desde = this.cutoff(dias);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [tot] = await tx.$queryRaw<{ custo: number; tokens: number; execucoes: number; erros: number }[]>`
        SELECT COALESCE(SUM(custo_usd),0)::float AS custo,
               COALESCE(SUM(tokens_entrada + tokens_saida),0)::int AS tokens,
               COUNT(*)::int AS execucoes,
               COUNT(*) FILTER (WHERE erro IS NOT NULL)::int AS erros
        FROM ai_usage_events WHERE created_at >= ${desde}`;
      const porAgente = await tx.$queryRaw<{ agente: string; custo: number; n: number }[]>`
        SELECT agente, SUM(custo_usd)::float AS custo, COUNT(*)::int AS n
        FROM ai_usage_events WHERE created_at >= ${desde} GROUP BY agente ORDER BY custo DESC`;
      const porModelo = await tx.$queryRaw<{ modelo: string; custo: number; n: number }[]>`
        SELECT modelo, SUM(custo_usd)::float AS custo, COUNT(*)::int AS n
        FROM ai_usage_events WHERE created_at >= ${desde} GROUP BY modelo ORDER BY custo DESC`;
      const porDia = await tx.$queryRaw<{ dia: string; custo: number }[]>`
        SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS dia, SUM(custo_usd)::float AS custo
        FROM ai_usage_events WHERE created_at >= ${desde} GROUP BY 1 ORDER BY 1`;
      return { dias, custoUsd: tot?.custo ?? 0, tokens: tot?.tokens ?? 0, execucoes: tot?.execucoes ?? 0, erros: tot?.erros ?? 0, porAgente, porModelo, porDia };
    });
  }

  async automacoes(tenantId: string, dias = 30) {
    const desde = this.cutoff(dias);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const grupos = await tx.workflowRun.groupBy({ by: ['status'], _count: true, where: { startedAt: { gte: desde } } });
      const porStatus: Record<string, number> = {};
      for (const g of grupos) porStatus[g.status] = g._count;
      const total = Object.values(porStatus).reduce((a, b) => a + b, 0);
      const concluidos = porStatus['concluido'] ?? 0;
      const falhas = (porStatus['falha'] ?? 0) + (porStatus['erro'] ?? 0);
      const naDlq = await tx.workflowDlq.count();
      const finalizados = concluidos + falhas;
      return {
        dias, total, concluidos, falhas, naDlq,
        rodando: porStatus['rodando'] ?? 0,
        taxaSucesso: finalizados > 0 ? Math.round((concluidos / finalizados) * 100) : null,
        porStatus,
      };
    });
  }
}

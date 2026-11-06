import { AnalyticsService } from './analytics.service';
import type { PrismaService } from '../prisma/prisma.service';

const TENANT = '11111111-1111-1111-1111-111111111111';

/**
 * Prisma falso: `$queryRaw` (template tag) devolve o próximo item da fila de
 * respostas configurada pelo teste, na ordem em que o serviço chama —
 * suficiente pra testar a AGREGAÇÃO/FORMATAÇÃO do serviço (o que pode
 * quebrar por bug de código), não a query SQL em si (provada pelo schema
 * real + leitura do texto da query, que é agregação parametrizada simples).
 */
function fakePrisma(respostasQueryRaw: unknown[], groupByResult: unknown[] = [], dlqCount = 0) {
  let i = 0;
  const tx = {
    $queryRaw: jest.fn(async () => respostasQueryRaw[i++]),
    workflowRun: { groupBy: jest.fn(async () => groupByResult) },
    workflowDlq: { count: jest.fn(async () => dlqCount) },
  };
  const prisma = {
    withTenant: jest.fn(async (_t: string, work: (tx: unknown) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;
  return { prisma, tx };
}

describe('AnalyticsService', () => {
  describe('aiUsage', () => {
    it('tenant sem nenhum evento de IA: zeros reais, não null/undefined vazando pro JSON', async () => {
      const { prisma } = fakePrisma([
        [{ custo: 0, tokens: 0, execucoes: 0, erros: 0 }],
        [],
        [],
        [],
      ]);
      const svc = new AnalyticsService(prisma);
      const r = await svc.aiUsage(TENANT, 30);
      expect(r).toEqual({ dias: 30, custoUsd: 0, tokens: 0, execucoes: 0, erros: 0, porAgente: [], porModelo: [], porDia: [] });
    });

    it('linha totalizadora ausente (COALESCE não geraria isso, mas o código não deve quebrar mesmo assim)', async () => {
      const { prisma } = fakePrisma([[], [], [], []]);
      const svc = new AnalyticsService(prisma);
      const r = await svc.aiUsage(TENANT, 30);
      expect(r.custoUsd).toBe(0);
      expect(r.execucoes).toBe(0);
    });

    it('agrega custo/tokens/execuções reais e preserva o detalhamento por agente/modelo/dia', async () => {
      const { prisma } = fakePrisma([
        [{ custo: 12.5, tokens: 48000, execucoes: 30, erros: 2 }],
        [{ agente: 'atendente', custo: 8.1, n: 20 }, { agente: 'arquiteta', custo: 4.4, n: 10 }],
        [{ modelo: 'claude-sonnet-5', custo: 12.5, n: 30 }],
        [{ dia: '2026-09-20', custo: 6.0 }, { dia: '2026-09-21', custo: 6.5 }],
      ]);
      const svc = new AnalyticsService(prisma);
      const r = await svc.aiUsage(TENANT, 30);
      expect(r.custoUsd).toBe(12.5);
      expect(r.tokens).toBe(48000);
      expect(r.execucoes).toBe(30);
      expect(r.erros).toBe(2);
      expect(r.porAgente).toHaveLength(2);
      expect(r.porModelo[0].modelo).toBe('claude-sonnet-5');
      expect(r.porDia).toHaveLength(2);
    });
  });

  describe('automacoes', () => {
    it('tenant sem nenhuma run: taxaSucesso é null (não 0% nem 100% fabricado)', async () => {
      const { prisma } = fakePrisma([], [], 0);
      const svc = new AnalyticsService(prisma);
      const r = await svc.automacoes(TENANT, 30);
      expect(r.total).toBe(0);
      expect(r.taxaSucesso).toBeNull();
      expect(r.naDlq).toBe(0);
    });

    it('calcula taxa de sucesso só sobre runs finalizadas (rodando não entra no denominador)', async () => {
      const { prisma } = fakePrisma(
        [],
        [
          { status: 'concluido', _count: 7 },
          { status: 'falha', _count: 3 },
          { status: 'rodando', _count: 5 },
        ],
        2,
      );
      const svc = new AnalyticsService(prisma);
      const r = await svc.automacoes(TENANT, 30);
      // 7 concluídas de 10 finalizadas (7 concluído + 3 falha) = 70% — os 5 "rodando" não contam.
      expect(r.taxaSucesso).toBe(70);
      expect(r.total).toBe(15);
      expect(r.rodando).toBe(5);
      expect(r.naDlq).toBe(2);
    });

    it('trata "erro" como falha (mesma família de "falha") no cálculo da taxa', async () => {
      const { prisma } = fakePrisma(
        [],
        [
          { status: 'concluido', _count: 1 },
          { status: 'erro', _count: 1 },
        ],
        0,
      );
      const svc = new AnalyticsService(prisma);
      const r = await svc.automacoes(TENANT, 30);
      expect(r.taxaSucesso).toBe(50);
    });
  });

  describe('cutoff (janela de dias)', () => {
    const zeroRows = () => [[{ custo: 0, tokens: 0, execucoes: 0, erros: 0 }], [], [], []];

    it('aceita janela grande (clampa internamente, mas não quebra nem perde o valor pedido na resposta)', async () => {
      const { prisma } = fakePrisma(zeroRows());
      const svc = new AnalyticsService(prisma);
      await expect(svc.aiUsage(TENANT, 9999)).resolves.toMatchObject({ dias: 9999 });
    });

    it('aceita janela não-positiva sem quebrar (cutoff() clampa pro mínimo de 1 dia internamente)', async () => {
      const { prisma } = fakePrisma(zeroRows());
      const svc = new AnalyticsService(prisma);
      await expect(svc.aiUsage(TENANT, -5)).resolves.toMatchObject({ dias: -5 });
    });
  });
});

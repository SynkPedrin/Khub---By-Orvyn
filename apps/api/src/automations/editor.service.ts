import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CATALOGO, grafoSchema } from './catalogo';

/** Contagem de um nó no período: o que o canvas desenha embaixo de cada card. */
export interface EstatisticaNo {
  /** Execuções que passaram por este nó com sucesso. */
  concluidos: number;
  /** Execuções paradas AGORA neste nó (espera, janela de envio, fila). */
  esperando: number;
  /** Execuções em que o nó falhou e não teve sucesso depois (retry que deu certo não conta). */
  erros: number;
}

export interface EstatisticasFluxo {
  desde: string;
  nos: Record<string, EstatisticaNo>;
  total: { entraram: number; concluidos: number; esperando: number; erros: number };
}

/** Janela máxima da estatística: 90 dias. Mais que isso vira relatório, não canvas. */
const JANELA_MAX_MS = 90 * 24 * 60 * 60 * 1000;
const STATUS_ATIVOS = ['rodando', 'esperando'];

const num = (v: bigint | number | null | undefined): number => Number(v ?? 0);

/** Rótulo de um nó para quem lê fora do canvas (perfil do contato, histórico). */
export function rotuloDoNo(grafoBruto: unknown, noId: string | null): string | null {
  if (!noId) return null;
  const g = grafoSchema.safeParse(grafoBruto);
  if (!g.success) return null;
  const no = g.data.nos.find((n) => n.id === noId);
  if (!no) return null;
  return no.rotulo?.trim() || CATALOGO.find((c) => c.tipo === no.tipo)?.nome || no.tipo;
}

/**
 * Normaliza o `?desde=` da estatística: padrão 7 dias, nunca no futuro, nunca
 * além de 90 dias. Data inválida é 400, não "zero execuções" silencioso.
 */
export function normalizarDesde(bruto: string | undefined, agora = new Date()): Date {
  if (!bruto) return new Date(agora.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d = new Date(bruto);
  if (Number.isNaN(d.getTime())) throw new BadRequestException('desde: data inválida (use ISO 8601)');
  if (d.getTime() > agora.getTime()) throw new BadRequestException('desde: não pode estar no futuro');
  const piso = new Date(agora.getTime() - JANELA_MAX_MS);
  return d < piso ? piso : d;
}

/**
 * Serviços do editor (Q3.3): estatística por etapa, histórico de versões,
 * duplicar fluxo, métricas da lista e execuções por contato. Separado do
 * `WorkflowsService` (que é o ciclo de vida do grafo) para não misturar leitura
 * analítica com a escrita versionada. Toda consulta roda em `withTenant` (RLS).
 */
@Injectable()
export class EditorService {
  constructor(private readonly prisma: PrismaService) {}

  /** Estatística por nó no período (execuções de teste não entram). */
  async estatisticas(tenantId: string, workflowId: string, desde: Date): Promise<EstatisticasFluxo> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id: workflowId }, select: { id: true } });
      if (!w) throw new NotFoundException('workflow inexistente');

      // Poda pelos runs que ainda podiam ter passo no período (índice db/058),
      // depois desce aos passos pelo índice (tenant_id, run_id, created_at).
      const passos = await tx.$queryRaw<{ no_id: string; concluidos: bigint; erros: bigint }[]>`
        SELECT s.no_id,
               COUNT(DISTINCT s.run_id) FILTER (WHERE s.status = 'ok') AS concluidos,
               COUNT(DISTINCT s.run_id) FILTER (
                 WHERE s.status = 'falhou' AND NOT EXISTS (
                   SELECT 1 FROM workflow_run_steps s2
                    WHERE s2.run_id = s.run_id AND s2.no_id = s.no_id
                      AND s2.status = 'ok' AND s2.created_at > s.created_at)
               ) AS erros
          FROM workflow_run_steps s
          JOIN workflow_runs r ON r.id = s.run_id
         WHERE r.workflow_id = ${workflowId}::uuid
           AND r.teste = false
           AND (r.finished_at IS NULL OR r.finished_at >= ${desde})
           AND s.created_at >= ${desde}
         GROUP BY s.no_id`;

      const parados = await tx.$queryRaw<{ no_atual: string; n: bigint }[]>`
        SELECT no_atual, COUNT(*) AS n
          FROM workflow_runs
         WHERE workflow_id = ${workflowId}::uuid AND teste = false
           AND status IN ('rodando', 'esperando') AND no_atual IS NOT NULL
         GROUP BY no_atual`;

      const [tot] = await tx.$queryRaw<{ entraram: bigint; concluidos: bigint; erros: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE started_at >= ${desde}) AS entraram,
               COUNT(*) FILTER (WHERE status = 'concluido' AND finished_at >= ${desde}) AS concluidos,
               COUNT(*) FILTER (WHERE status = 'falhou' AND finished_at >= ${desde}) AS erros
          FROM workflow_runs
         WHERE workflow_id = ${workflowId}::uuid AND teste = false
           AND (finished_at IS NULL OR finished_at >= ${desde})`;

      const nos: Record<string, EstatisticaNo> = {};
      const de = (id: string) => (nos[id] ??= { concluidos: 0, esperando: 0, erros: 0 });
      for (const p of passos) {
        const e = de(p.no_id);
        e.concluidos = num(p.concluidos);
        e.erros = num(p.erros);
      }
      let esperando = 0;
      for (const p of parados) {
        de(p.no_atual).esperando = num(p.n);
        esperando += num(p.n);
      }
      return {
        desde: desde.toISOString(),
        nos,
        total: { entraram: num(tot?.entraram), concluidos: num(tot?.concluidos), esperando, erros: num(tot?.erros) },
      };
    });
  }

  /** Métricas dos cards da lista: ativos agora, concluídos e erros no período. */
  async metricas(tenantId: string, dias: number) {
    const desde = new Date(Date.now() - Math.min(Math.max(dias, 1), 90) * 24 * 60 * 60 * 1000);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const linhas = await tx.$queryRaw<{ workflow_id: string; ativos: bigint; concluidos: bigint; erros: bigint }[]>`
        SELECT workflow_id,
               COUNT(*) FILTER (WHERE status IN ('rodando', 'esperando')) AS ativos,
               COUNT(*) FILTER (WHERE status = 'concluido' AND finished_at >= ${desde}) AS concluidos,
               COUNT(*) FILTER (WHERE status = 'falhou' AND finished_at >= ${desde}) AS erros
          FROM workflow_runs
         WHERE teste = false
           AND (status IN ('rodando', 'esperando') OR finished_at >= ${desde})
         GROUP BY workflow_id`;
      const porFluxo: Record<string, { ativos: number; concluidos: number; erros: number }> = {};
      for (const l of linhas) porFluxo[l.workflow_id] = { ativos: num(l.ativos), concluidos: num(l.concluidos), erros: num(l.erros) };
      return { desde: desde.toISOString(), dias, porFluxo };
    });
  }

  /** Histórico de versões publicadas: número, data, autor, nº de nós e qual está no ar. */
  async versoes(tenantId: string, workflowId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id: workflowId }, select: { versaoAtivaId: true } });
      if (!w) throw new NotFoundException('workflow inexistente');
      const vs = await tx.workflowVersion.findMany({
        where: { workflowId, publicadoEm: { not: null } },
        orderBy: { versao: 'desc' },
        take: 100,
        select: { id: true, versao: true, publicadoEm: true, publicadoPor: true, grafo: true },
      });
      const autores = Array.from(new Set(vs.map((v) => v.publicadoPor).filter((x): x is string => !!x)));
      const usuarios = autores.length
        ? await tx.user.findMany({ where: { identityId: { in: autores } }, select: { identityId: true, nome: true } })
        : [];
      const nome = new Map(usuarios.map((u) => [u.identityId, u.nome]));
      return vs.map((v) => {
        const g = grafoSchema.safeParse(v.grafo);
        return {
          id: v.id,
          versao: v.versao,
          publicadoEm: v.publicadoEm,
          autor: v.publicadoPor ? { id: v.publicadoPor, nome: nome.get(v.publicadoPor) ?? null } : null,
          nos: g.success ? g.data.nos.length : 0,
          ativa: v.id === w.versaoAtivaId,
        };
      });
    });
  }

  /** Grafo de uma versão, para ver em modo leitura no canvas. */
  async versao(tenantId: string, workflowId: string, versionId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const v = await tx.workflowVersion.findFirst({
        where: { id: versionId, workflowId },
        select: { id: true, versao: true, publicadoEm: true, grafo: true },
      });
      if (!v) throw new NotFoundException('versão inexistente');
      return v;
    });
  }

  /**
   * Duplica o fluxo: o que está no canvas (rascunho, ou a versão no ar se não
   * houver rascunho) vira o rascunho v1 do fluxo novo, com as mesmas
   * configurações. Nasce em rascunho, sem URL de webhook nem segredo: a cópia
   * não pode disparar com a credencial do original.
   */
  async duplicar(tenantId: string, identityId: string, workflowId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const w = await tx.workflow.findUnique({ where: { id: workflowId }, include: { versaoAtiva: { select: { grafo: true } } } });
      if (!w) throw new NotFoundException('workflow inexistente');
      const rascunho = await tx.workflowVersion.findFirst({ where: { workflowId, publicadoEm: null }, orderBy: { versao: 'desc' }, select: { grafo: true } });
      const grafo = (rascunho?.grafo ?? w.versaoAtiva?.grafo ?? { nos: [], arestas: [] }) as Prisma.InputJsonValue;

      const novo = await tx.workflow.create({
        data: {
          tenantId,
          nome: `${w.nome} (cópia)`.slice(0, 160),
          descricao: w.descricao,
          tags: w.tags,
          pasta: w.pasta,
          criadoPor: identityId,
          status: 'rascunho',
          reentrada: w.reentrada,
          pararNoReply: w.pararNoReply,
          janelaAtiva: w.janelaAtiva,
          janelaDias: w.janelaDias,
          janelaInicio: w.janelaInicio,
          janelaFim: w.janelaFim,
          timezone: w.timezone,
          janelaIncluiEquipe: w.janelaIncluiEquipe,
        },
        select: { id: true, nome: true },
      });
      await tx.workflowVersion.create({ data: { tenantId, workflowId: novo.id, versao: 1, grafo } });
      await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
        VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.duplicate', 'workflow', ${novo.id}, ${JSON.stringify({ origem: workflowId })}::jsonb)`;
      return novo;
    });
  }

  /** Execuções de um contato em todos os fluxos (perfil do contato). */
  async runsDoContato(tenantId: string, contactId: string, limite = 50) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const runs = await tx.workflowRun.findMany({
        where: { contactId },
        orderBy: { startedAt: 'desc' },
        take: Math.min(Math.max(limite, 1), 100),
        select: {
          id: true, workflowId: true, versionId: true, gatilho: true, status: true, noAtual: true, erro: true,
          startedAt: true, finishedAt: true, teste: true, grafoTeste: true,
          workflow: { select: { nome: true } },
        },
      });
      // Um SELECT por versão distinta, não por run: o perfil abre rápido mesmo
      // com o contato em vários fluxos.
      const idsVersao = Array.from(new Set(runs.filter((r) => !r.grafoTeste).map((r) => r.versionId)));
      const versoes = idsVersao.length
        ? await tx.workflowVersion.findMany({ where: { id: { in: idsVersao } }, select: { id: true, grafo: true } })
        : [];
      const grafoDa = new Map(versoes.map((v) => [v.id, v.grafo]));
      return runs.map((r) => ({
        id: r.id,
        workflowId: r.workflowId,
        workflowNome: r.workflow.nome,
        gatilho: r.gatilho,
        status: r.status,
        noAtual: r.noAtual,
        noAtualRotulo: rotuloDoNo(r.grafoTeste ?? grafoDa.get(r.versionId), r.noAtual),
        erro: r.erro,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        teste: r.teste,
        ativo: STATUS_ATIVOS.includes(r.status),
      }));
    });
  }

  /**
   * "Remover deste fluxo": cancela a execução que ainda está correndo. O job
   * já enfileirado acorda, vê `cancelado` e não executa nada (RunsService).
   * Auditado: é uma decisão humana sobre o contato.
   */
  async cancelarRun(tenantId: string, runId: string, identityId: string) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const run = await tx.workflowRun.findUnique({ where: { id: runId }, select: { id: true, workflowId: true, contactId: true } });
      if (!run) throw new NotFoundException('execução inexistente');
      const r = await tx.workflowRun.updateMany({
        where: { id: runId, status: { in: STATUS_ATIVOS } },
        data: { status: 'cancelado', erro: 'removido do fluxo manualmente', finishedAt: new Date() },
      });
      if (r.count) {
        await tx.$executeRaw`INSERT INTO audit_logs (tenant_id, actor_type, actor_id, acao, entidade, entidade_id, payload)
          VALUES (${tenantId}::uuid, 'humano', ${identityId}, 'workflow.run_cancel', 'workflow', ${run.workflowId}, ${JSON.stringify({ runId, contactId: run.contactId })}::jsonb)`;
      }
      return { ok: true, cancelado: r.count > 0 };
    });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/**
 * AGENT ANALYTICS (docs/AI_AGENT_ARCHITECTURE.md §4 e §16)
 *
 * Tudo calculado das tabelas operacionais (runs, entregas, follow-ups,
 * perfis, agenda, negócios) — índices por (tenant, agente, data). Sem tabela
 * de agregados: com o volume atual uma consulta indexada responde em ms e
 * não existe risco de o painel divergir da operação. Quando o volume pedir,
 * um rollup diário entra sem mudar este contrato.
 */
@Injectable()
export class AgentAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Agent Manager — visão do tenant inteiro. */
  async dashboard(tenantId: string, dias = 30) {
    const desde = new Date(Date.now() - dias * 86_400_000);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [agentes, runs, conversas, mensagens, qualificados, followupsEnviados, recuperados, agendamentos, conversoes, erros, atividades, processandoDocs, avaliando, aprovacoes] = await Promise.all([
        tx.agent.groupBy({ by: ['status'], _count: { _all: true } }),
        tx.agentRun.groupBy({ by: ['status'], where: { createdAt: { gte: desde } }, _count: { _all: true }, _sum: { custoUsd: true, tokensEntrada: true, tokensSaida: true } }),
        tx.agentRun.findMany({ where: { createdAt: { gte: desde } }, distinct: ['conversationId'], select: { conversationId: true } }),
        tx.message.count({ where: { autorTipo: 'ia', createdAt: { gte: desde } } }),
        tx.agentCustomerProfile.count({ where: { temperatura: { in: ['quente', 'morna'] }, ultimoAgentId: { not: null }, updatedAt: { gte: desde } } }),
        tx.agentFollowup.count({ where: { status: 'enviado', executadoEm: { gte: desde } } }),
        tx.$queryRaw<{ n: bigint }[]>`
          SELECT count(DISTINCT f.contact_id) AS n FROM agent_followups f
          JOIN contacts c ON c.id = f.contact_id
          WHERE f.status = 'enviado' AND f.executado_em >= ${desde} AND c.last_inbound_at > f.executado_em`,
        tx.agendaCompromisso.count({ where: { createdAt: { gte: desde }, createdBy: { in: (await tx.agent.findMany({ select: { id: true } })).map((a) => a.id) } } }),
        tx.agentCustomerProfile.count({ where: { convertidoEm: { gte: desde }, ultimoAgentId: { not: null } } }),
        tx.agentRun.findMany({ where: { status: 'erro', createdAt: { gte: desde } }, orderBy: { createdAt: 'desc' }, take: 8, select: { id: true, agentId: true, motivo: true, createdAt: true, conversationId: true } }),
        tx.agentRun.findMany({ where: { status: { not: 'processando' } }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, agentId: true, status: true, intencao: true, motivo: true, createdAt: true, conversationId: true, blocos: true, custoUsd: true } }),
        tx.ragDocument.count({ where: { status: { in: ['pending', 'processing'] } } }),
        tx.agentEvaluation.findMany({ where: { status: 'executando' }, distinct: ['agentId'], select: { agentId: true } }),
        tx.agentToolExecution.count({ where: { status: 'aguardando_aprovacao' } }),
      ]);
      const nomes = new Map((await tx.agent.findMany({ select: { id: true, nome: true } })).map((a) => [a.id, a.nome]));
      const docsIndexando = await tx.ragDocument.findMany({ where: { status: { in: ['pending', 'processing'] } }, select: { id: true } });
      const indexando = docsIndexando.length ? await tx.agentKnowledgeSource.findMany({ where: { documentId: { in: docsIndexando.map((d) => d.id) } }, distinct: ['agentId'], select: { agentId: true } }) : [];
      const porStatus = Object.fromEntries(agentes.map((a) => [a.status, a._count._all]));
      const totalRuns = runs.reduce((t, r) => t + r._count._all, 0);
      const transferidos = runs.find((r) => r.status === 'transferido')?._count._all ?? 0;
      return {
        periodoDias: dias,
        agentes: {
          total: agentes.filter((a) => a.status !== 'arquivado').reduce((t, a) => t + a._count._all, 0),
          ativos: porStatus.ativo ?? 0,
          pausados: porStatus.pausado ?? 0,
          rascunhos: porStatus.rascunho ?? 0,
          // "Em treinamento" = indexando conhecimento ou rodando avaliação agora.
          emTreinamento: new Set([...avaliando.map((a) => a.agentId), ...indexando.map((i) => i.agentId)]).size,
        },
        conversasAtendidas: conversas.length,
        mensagensEnviadas: mensagens,
        leadsQualificados: qualificados,
        followupsEnviados,
        oportunidadesRecuperadas: Number(recuperados[0]?.n ?? 0),
        agendamentos,
        conversoes,
        taxaTransferencia: pct(transferidos, totalRuns),
        execucoes: Object.fromEntries(runs.map((r) => [r.status, r._count._all])),
        tokens: runs.reduce((t, r) => t + num(r._sum.tokensEntrada) + num(r._sum.tokensSaida), 0),
        custoUsd: Math.round(runs.reduce((t, r) => t + num(r._sum.custoUsd), 0) * 10000) / 10000,
        documentosProcessando: processandoDocs,
        aprovacoesPendentes: aprovacoes,
        errosRecentes: erros.map((e) => ({ ...e, agente: e.agentId ? nomes.get(e.agentId) ?? null : null })),
        ultimasAtividades: atividades.map((a) => ({ ...a, custoUsd: num(a.custoUsd), agente: a.agentId ? nomes.get(a.agentId) ?? null : null })),
      };
    });
  }

  /** Analytics Dashboard de UM agente. */
  async agente(tenantId: string, agentId: string, dias = 30) {
    const desde = new Date(Date.now() - dias * 86_400_000);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const a = await tx.agent.findUnique({ where: { id: agentId }, select: { id: true, nome: true } });
      if (!a) throw new NotFoundException('agente inexistente');
      const [serie, intencoes, sentimentos, objecoes, lacunas, entregas, followups, latencia, ferramentas, versoes, conversas] = await Promise.all([
        tx.$queryRaw<{ dia: Date; status: string; n: bigint; custo: number; tokens: bigint }[]>`
          SELECT date_trunc('day', created_at) AS dia, status, count(*) AS n, COALESCE(sum(custo_usd), 0)::float AS custo, COALESCE(sum(tokens_entrada + tokens_saida), 0) AS tokens
          FROM agent_runs WHERE agent_id = ${agentId}::uuid AND created_at >= ${desde}
          GROUP BY 1, 2 ORDER BY 1`,
        tx.agentRun.groupBy({ by: ['intencao'], where: { agentId, createdAt: { gte: desde }, intencao: { not: null } }, _count: { _all: true } }),
        tx.agentRun.groupBy({ by: ['sentimento'], where: { agentId, createdAt: { gte: desde }, sentimento: { not: null } }, _count: { _all: true } }),
        tx.agentLearningEvent.groupBy({ by: ['chave'], where: { agentId, tipo: 'objecao', createdAt: { gte: desde } }, _count: { _all: true } }),
        tx.agentLearningEvent.groupBy({ by: ['chave'], where: { agentId, tipo: 'lacuna_conhecimento', createdAt: { gte: desde } }, _count: { _all: true }, orderBy: { _count: { chave: 'desc' } }, take: 10 }),
        tx.agentDelivery.groupBy({ by: ['status'], where: { agentId, createdAt: { gte: desde } }, _count: { _all: true } }),
        tx.agentFollowup.groupBy({ by: ['status', 'estrategia'], where: { agentId, createdAt: { gte: desde } }, _count: { _all: true } }),
        tx.$queryRaw<{ p50: number | null; p95: number | null; media: number | null }[]>`
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY latencia_ms) AS p50, percentile_cont(0.95) WITHIN GROUP (ORDER BY latencia_ms) AS p95, avg(latencia_ms)::float AS media
          FROM agent_runs WHERE agent_id = ${agentId}::uuid AND created_at >= ${desde} AND latencia_ms IS NOT NULL`,
        tx.agentToolExecution.groupBy({ by: ['ferramenta', 'status'], where: { agentId, createdAt: { gte: desde } }, _count: { _all: true } }),
        this.porVersao(tx, agentId),
        tx.agentRun.findMany({ where: { agentId, createdAt: { gte: desde } }, distinct: ['conversationId'], select: { conversationId: true } }),
      ]);
      const dias_: Record<string, { dia: string; respondido: number; transferido: number; erro: number; ignorado: number; custoUsd: number; tokens: number }> = {};
      for (const l of serie) {
        const k = l.dia.toISOString().slice(0, 10);
        dias_[k] ??= { dia: k, respondido: 0, transferido: 0, erro: 0, ignorado: 0, custoUsd: 0, tokens: 0 };
        if (l.status in dias_[k]) (dias_[k] as unknown as Record<string, number>)[l.status] += Number(l.n);
        dias_[k].custoUsd += l.custo;
        dias_[k].tokens += Number(l.tokens);
      }
      const total = serie.reduce((t, l) => t + Number(l.n), 0);
      const transf = serie.filter((l) => l.status === 'transferido').reduce((t, l) => t + Number(l.n), 0);
      return {
        agente: a,
        periodoDias: dias,
        resumo: {
          execucoes: total,
          conversas: conversas.length,
          taxaTransferencia: pct(transf, total),
          taxaErro: pct(serie.filter((l) => l.status === 'erro').reduce((t, l) => t + Number(l.n), 0), total),
          custoUsd: Math.round(serie.reduce((t, l) => t + l.custo, 0) * 10000) / 10000,
          tokens: serie.reduce((t, l) => t + Number(l.tokens), 0),
          latenciaP50Ms: latencia[0]?.p50 ?? null,
          latenciaP95Ms: latencia[0]?.p95 ?? null,
        },
        serie: Object.values(dias_),
        intencoes: intencoes.map((i) => ({ intencao: i.intencao, n: i._count._all })).sort((x, y) => y.n - x.n),
        sentimentos: sentimentos.map((s) => ({ sentimento: s.sentimento, n: s._count._all })),
        objecoes: objecoes.map((o) => ({ objecao: o.chave, n: o._count._all })).sort((x, y) => y.n - x.n),
        lacunas: lacunas.map((l) => ({ pergunta: l.chave, n: l._count._all })),
        entregas: Object.fromEntries(entregas.map((e) => [e.status, e._count._all])),
        followups: followups.map((f) => ({ status: f.status, estrategia: f.estrategia, n: f._count._all })),
        ferramentas: ferramentas.map((f) => ({ ferramenta: f.ferramenta, status: f.status, n: f._count._all })),
        versoes,
      };
    });
  }

  /**
   * Desempenho por versão publicada (taxa de transferência, erro, guardrail,
   * confiança). Marca `piorou` quando a versão atual tem amostra suficiente e
   * é pior que a anterior além da tolerância — é o alarme de "nova versão
   * piorou o desempenho" (rollback sugerido na UI).
   */
  private async porVersao(tx: Parameters<Parameters<PrismaService['withTenant']>[1]>[0], agentId: string) {
    const linhas = await tx.$queryRaw<{ version_id: string | null; n: bigint; transf: bigint; erros: bigint; guardrail: bigint; conf: number | null }[]>`
      SELECT version_id, count(*) AS n,
        count(*) FILTER (WHERE status = 'transferido') AS transf,
        count(*) FILTER (WHERE status = 'erro') AS erros,
        count(*) FILTER (WHERE trace->'guardrail' IS NOT NULL AND trace->>'guardrail' <> 'null') AS guardrail,
        avg(confianca)::float AS conf
      FROM agent_runs WHERE agent_id = ${agentId}::uuid AND created_at >= now() - interval '90 days'
      GROUP BY version_id`;
    const versoes = await tx.agentVersion.findMany({ where: { agentId }, orderBy: { numero: 'desc' }, take: 20, select: { id: true, numero: true, createdAt: true } });
    const porId = new Map(linhas.map((l) => [l.version_id, l]));
    const lista = versoes.map((v) => {
      const l = porId.get(v.id);
      const n = Number(l?.n ?? 0);
      return { versionId: v.id, numero: v.numero, publicadaEm: v.createdAt, execucoes: n, taxaTransferencia: pct(Number(l?.transf ?? 0), n), taxaErro: pct(Number(l?.erros ?? 0), n), taxaGuardrail: pct(Number(l?.guardrail ?? 0), n), confiancaMedia: l?.conf ?? null, piorou: false };
    });
    const MIN_AMOSTRA = 20;
    for (let i = 0; i < lista.length - 1; i++) {
      const atual = lista[i];
      const anterior = lista[i + 1];
      if (atual.execucoes >= MIN_AMOSTRA && anterior.execucoes >= MIN_AMOSTRA) {
        atual.piorou = atual.taxaTransferencia - anterior.taxaTransferencia > 10 || atual.taxaErro - anterior.taxaErro > 5 || atual.taxaGuardrail - anterior.taxaGuardrail > 5;
      }
    }
    const legado = porId.get(null);
    return { versoes: lista, semVersao: legado ? { execucoes: Number(legado.n), taxaTransferencia: pct(Number(legado.transf), Number(legado.n)) } : null };
  }

  /** Execution Logs: runs com trace estruturado (paginado por cursor). */
  async logs(tenantId: string, agentId: string, f: { status?: string; intencao?: string; cursor?: string; limit?: number }) {
    const take = Math.min(f.limit ?? 30, 100);
    return this.prisma.withTenant(tenantId, async (tx) => {
      const itens = await tx.agentRun.findMany({
        where: { agentId, ...(f.status ? { status: f.status } : {}), ...(f.intencao ? { intencao: f.intencao } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        ...(f.cursor ? { cursor: { id: f.cursor }, skip: 1 } : {}),
      });
      const pagina = itens.slice(0, take);
      const msgs = await tx.message.findMany({ where: { id: { in: pagina.map((r) => r.messageId) } }, select: { id: true, corpo: true } });
      const corpo = new Map(msgs.map((m) => [m.id, m.corpo]));
      return {
        itens: pagina.map((r) => ({ ...r, custoUsd: num(r.custoUsd), confianca: r.confianca === null ? null : num(r.confianca), mensagem: corpo.get(r.messageId)?.slice(0, 500) ?? null })),
        nextCursor: itens.length > take ? pagina[pagina.length - 1].id : null,
      };
    });
  }

  async ferramentas(tenantId: string, agentId: string, f: { status?: string; limit?: number }) {
    return this.prisma.withTenant(tenantId, (tx) =>
      tx.agentToolExecution.findMany({ where: { agentId, ...(f.status ? { status: f.status } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(f.limit ?? 100, 300) }),
    );
  }
}

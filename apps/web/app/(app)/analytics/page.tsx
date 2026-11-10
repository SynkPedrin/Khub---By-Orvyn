'use client';

import { AnalyticsReal } from '@/components/revenue/AnalyticsReal';
import Link from 'next/link';
import { Icon, type IconName } from '@/components/icons';
import { Avatar } from '@/components/ui';
import { PageShell, PageHeader, KpiGrid, Section } from '@/components/revenue/Page';
import { KpiCard } from '@/components/revenue/Kpi';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { EmptyState } from '@/components/revenue/States';
import {
  AreaReceita,
  BarrasAgrupadas,
  BarrasHorizontais,
  BarrasVerticais,
  Funil,
  Rosca,
} from '@/components/revenue/charts';
import { duracao, moeda, percentual } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import {
  ANALYTICS_KPIS,
  FUNIL_CONVERSAO,
  INSIGHTS_ANALYTICS,
  LEADS_POR_STATUS,
  META_VS_REALIZADO,
  RECEITA_30D,
  RECEITA_POR_CANAL,
  RELATORIOS_RAPIDOS,
  TEMPO_RESPOSTA_EQUIPE,
} from '@/lib/demo/dataset';

/**
 * ANALYTICS — o que aconteceu e por quê.
 *
 * Seis KPIs no topo, widgets de diagnóstico no corpo, e os insights da IA
 * num painel SEPARADO à direita — separação deliberada: número medido e
 * interpretação de modelo não podem se misturar na mesma superfície, senão
 * o leitor não distingue fato de opinião.
 */
export default function AnalyticsPage() {
  const demo = modoDemo();

  return (
    <PageShell>
      <PageHeader
        title="Analytics e Relatórios"
        subtitle="Dados que impulsionam um crescimento previsível."
        actions={
          // Período e canal ainda não filtram os dados reais: só aparecem no demo.
          demo ? (
            <>
              <SeloDemo />
              <button type="button" className="btn">
                <Icon name="calendar" size={15} />
                Últimos 30 dias
                <Icon name="chevronDown" size={14} />
              </button>
              <button type="button" className="btn">
                <Icon name="filter" size={15} />
                Todos os Canais
                <Icon name="chevronDown" size={14} />
              </button>
            </>
          ) : undefined
        }
      />

      {demo ? <AnalyticsComDados /> : <AnalyticsReal />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Analytics REAL — só existem dois indicadores medidos hoje no backend
 * (custo/uso de IA e performance de automações; `AnalyticsService`). Os
 * demais widgets do modo demo (CAC, ROI, receita por canal, funil, meta vs.
 * realizado, comparecimento, "insights da IA") não têm fonte de dado real
 * ainda — não fabricamos número pra preencher espaço. Quando o backend
 * ganhar essas métricas, este componente cresce; até lá, honesto > completo.
 */

function AnalyticsComDados() {
  const k = ANALYTICS_KPIS;

  return (
    <>
      <KpiGrid cols={6}>
        <KpiCard label="Receita Gerada" compacto value={moeda(k.receita.valor)} icon="dollar" tom="success" delta={k.receita.delta} comparacao="vs. mês anterior" />
        {/* CAC caindo é bom: deltaBom=false pinta a queda de verde. */}
        <KpiCard label="CAC" compacto value={moeda(k.cac.valor, true)} icon="user" delta={k.cac.delta} deltaBom={false} comparacao="vs. mês anterior" />
        <KpiCard label="Taxa de Conversão" compacto value={percentual(k.conversao.valor, 0, true)} icon="chat" delta={k.conversao.delta} comparacao="vs. mês anterior" />
        <KpiCard label="Tempo de Resposta" compacto value={duracao(k.tempoResposta.valor)} icon="clock" delta={k.tempoResposta.delta} deltaBom={false} comparacao="vs. mês anterior" />
        <KpiCard label="ROI" compacto value={`${k.roi.valor.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}x`} icon="chart" delta={k.roi.delta} comparacao="vs. mês anterior" />
        <KpiCard label="Taxa de Comparecimento" compacto value={percentual(k.comparecimento.valor, 0, true)} icon="users" delta={k.comparecimento.delta} comparacao="vs. mês anterior" />
      </KpiGrid>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title={<ComAjuda>Receita por Canal</ComAjuda>}
              info="Distribuição da receita gerada em cada canal"
              action={
                <select className="select h-8 w-auto text-[13px]" aria-label="Métrica do gráfico">
                  <option>Receita</option>
                </select>
              }
            >
              <BarrasVerticais dados={RECEITA_POR_CANAL} />
            </Section>

            <Section
              title={<ComAjuda>Funil de Conversão</ComAjuda>}
              info="Do primeiro contato à receita gerada"
              action={
                <select className="select h-8 w-auto text-[13px]" aria-label="Período do funil">
                  <option>Este mês</option>
                </select>
              }
            >
              <Funil etapas={FUNIL_CONVERSAO} />
            </Section>

            <Section
              title={<ComAjuda>Tempo de Resposta por Equipe</ComAjuda>}
              action={
                <select className="select h-8 w-auto text-[13px]" aria-label="Período">
                  <option>Este mês</option>
                </select>
              }
            >
              <BarrasHorizontais
                dados={TEMPO_RESPOSTA_EQUIPE.map((t) => ({
                  rotulo: t.nome,
                  valor: t.minutos,
                  extra: <Avatar name={t.nome} size={22} />,
                }))}
                formatar={(n) => `${n} min`}
                menorEhMelhor
              />
            </Section>

            <Section
              title={<ComAjuda>Meta vs. Realizado</ComAjuda>}
              action={
                <select className="select h-8 w-auto text-[13px]" aria-label="Periodicidade">
                  <option>Mensal</option>
                </select>
              }
            >
              <BarrasAgrupadas dados={META_VS_REALIZADO} />
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section
              title={<ComAjuda>Evolução da Receita</ComAjuda>}
              action={
                <div className="segbar" role="tablist" aria-label="Período">
                  {['7D', '30D', '3M', '12M'].map((p) => (
                    <button key={p} type="button" role="tab" className="seg" aria-selected={p === '30D'}>
                      {p}
                    </button>
                  ))}
                </div>
              }
            >
              <div className="mb-4 flex flex-wrap items-baseline gap-3">
                <p className="text-[26px] font-bold tabular tracking-tight text-fg">{moeda(ANALYTICS_KPIS.receita.valor)}</p>
                <span className="delta delta-up">
                  <Icon name="arrowUp" size={12} strokeWidth={2.4} />
                  {ANALYTICS_KPIS.receita.delta}%
                </span>
                <span className="text-[13px] text-muted">vs. mês anterior</span>
              </div>
              <AreaReceita dados={RECEITA_30D} altura={170} />
            </Section>

            <Section title={<ComAjuda>Leads por Status</ComAjuda>}>
              <Rosca
                dados={LEADS_POR_STATUS}
                total={LEADS_POR_STATUS.reduce((s, l) => s + l.valor, 0)}
                rotuloTotal="Leads"
              />
            </Section>
          </div>
        </div>

        {/* Painel lateral: interpretação, separada dos números medidos */}
        <aside className="min-w-0 space-y-4">
          <PainelInsights />
          <RelatoriosRapidos />
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function PainelInsights() {
  return (
    <section className="card">
      <div className="flex items-center justify-between gap-2 px-5 pt-5">
        <h2 className="t-section">Insights da NICO</h2>
        <span className="pill pill-brand">Beta</span>
      </div>

      <div className="p-5">
        <div className="rounded-lg border border-brand-border bg-brand-softer p-4">
          <p className="flex items-start gap-2 text-[13.5px] font-semibold text-fg">
            <Icon name="ai" size={17} className="mt-0.5 shrink-0 text-brand" />
            {INSIGHTS_ANALYTICS.length} recomendações para você
          </p>
          <p className="ml-6 text-xs text-muted">Com base nos seus dados dos últimos 30 dias</p>

          <ol className="mt-4 space-y-3.5">
            {INSIGHTS_ANALYTICS.map((i, idx) => (
              <li key={i.id} className="flex gap-2.5">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-semibold text-brand">
                  {idx + 1}
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-fg">{i.titulo}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted">{i.descricao}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <Link href="/ia" className="btn btn-ai mt-4 w-full">
          <Icon name="ai" size={16} />
          Aplicar recomendações com IA
          <Icon name="arrowRight" size={15} />
        </Link>
      </div>
    </section>
  );
}

function RelatoriosRapidos() {
  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Icon name="file" size={16} className="text-muted" />
          Relatórios Rápidos
        </span>
      }
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-line">
        {RELATORIOS_RAPIDOS.map((r) => (
          <li key={r.id}>
            <button type="button" className="flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-surface2">
              <span className="icon-tile icon-tile-neutral h-8 w-8 shrink-0 rounded-sm">
                <Icon name={r.icone as IconName} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-fg">{r.titulo}</span>
                <span className="block truncate text-[11.5px] text-muted">{r.descricao}</span>
              </span>
              <Icon name="chevronRight" size={16} className="shrink-0 text-faint" />
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

/** Título com ícone de ajuda — o widget explica a própria métrica. */
function ComAjuda({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {children}
      <Icon name="info" size={14} className="text-faint" />
    </span>
  );
}

function AnalyticsVazio() {
  return (
    <div className="card">
      <EmptyState
        icon="trend"
        title="Ainda não há dados para analisar"
        description="Analytics cruza leads, conversas, negócios e campanhas. Assim que houver histórico suficiente, os indicadores e os insights aparecem aqui."
        action={
          <Link href="/leads" className="btn btn-primary btn-sm">
            <Icon name="leads" size={15} />
            Ir para Leads
          </Link>
        }
      />
    </div>
  );
}

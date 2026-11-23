'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { PageShell, PageHeader, Section, KpiGrid } from '@/components/revenue/Page';
import { KpiCard, Delta } from '@/components/revenue/Kpi';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { AreaReceita, BarrasVerticais, FaixasFunil, Rosca, Sparkline } from '@/components/revenue/charts';
import { moeda, moedaCurta, numero, percentual, primeiroNome, saudacao, hora } from '@/lib/format';
import { Quando } from '@/components/revenue/Quando';
import { modoDemo } from '@/lib/demo/flag';
import {
  ATIVIDADE_RECENTE,
  DASHBOARD_KPIS,
  FUNIL_RESUMO,
  INSIGHTS_DASHBOARD,
  PROXIMAS_TAREFAS,
  RECEITA_30D,
  VALOR_PIPELINE,
} from '@/lib/demo/dataset';
import { EmptyState, ErrorState } from '@/components/revenue/States';
import { crm, type KpiPeriodo, type Overview, type PeriodoDashboard } from '@/lib/crm';
import { nyro, type Insight as InsightNico } from '@/lib/nyro';
import { useRealtime } from '@/lib/realtime';

/**
 * DASHBOARD DE RECEITA
 *
 * Responde, em uma tela, às três perguntas que abrem o dia de um time
 * comercial: o que está acontecendo, onde estou perdendo receita e onde há
 * oportunidade.
 *
 * Fora do modo demo, nada aqui é chumbado: sem dado, a tela diz que está
 * vazia. Número inventado num painel de receita é pior que painel vazio.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  const demo = modoDemo();
  const [periodo, setPeriodo] = useState<PeriodoDashboard>('30d');

  // A saudação depende da hora LOCAL. Servidor e navegador podem estar em
  // fusos diferentes, e o React trata a divergência como erro de hidratação.
  // Primeiro render neutro; a saudação entra depois de montar.
  const [saudacaoAtual, setSaudacaoAtual] = useState<string | null>(null);
  useEffect(() => setSaudacaoAtual(saudacao()), []);

  const nome = primeiroNome(user?.name);

  return (
    <PageShell>
      {/* v2: faixa de boas-vindas é o momento Aurora da tela (máx. 1) */}
      <div className="aurora -mx-2 mb-2 rounded-card px-2 pt-2">
        <PageHeader
          title={saudacaoAtual ? `${saudacaoAtual}${nome ? `, ${nome}` : ''}.` : nome ? `Olá, ${nome}.` : 'Seu painel de receita'}
          subtitle="Aqui está o panorama completo da sua operação hoje."
          actions={
            <>
              {!demo && <SeletorDias periodo={periodo} onChange={setPeriodo} />}
              <SeloDemo />
            </>
          }
        />
      </div>

      {demo ? <DashboardComDados /> : <DashboardReal periodo={periodo} onPeriodo={setPeriodo} />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

/** Seletor de período do cabeçalho ("Últimos 30 dias ⌄"). */
function SeletorDias({ periodo, onChange, compacto = false }: { periodo: PeriodoDashboard; onChange: (p: PeriodoDashboard) => void; compacto?: boolean }) {
  return (
    <label className={cx('btn btn-sm cursor-pointer gap-2', compacto && 'px-2')}>
      <Icon name="calendar" size={14} />
      <select
        value={periodo}
        onChange={(e) => onChange(e.target.value as PeriodoDashboard)}
        className="cursor-pointer appearance-none bg-transparent text-inherit outline-none"
        aria-label="Período do dashboard"
      >
        <option value="7d">Últimos 7 dias</option>
        <option value="30d">Últimos 30 dias</option>
        <option value="90d">Últimos 90 dias</option>
      </select>
      <Icon name="chevronDown" size={13} />
    </label>
  );
}

/** Abas 7D/30D/90D dentro do card "Desempenho Geral" (mesmo estado do cabeçalho). */
function AbasPeriodo({ periodo, onChange }: { periodo: PeriodoDashboard; onChange: (p: PeriodoDashboard) => void }) {
  return (
    <div className="segbar" role="tablist" aria-label="Período">
      {(['7d', '30d', '90d'] as const).map((p) => (
        <button key={p} type="button" role="tab" className="seg" aria-selected={p === periodo} onClick={() => onChange(p)}>
          {p.replace('d', 'D')}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Dashboard com dado REAL do tenant — consulta `crm.overview(periodo)`
 * (KPIs com série diária e delta honesto, funil por etapa, fontes de lead,
 * receita por canal — tudo calculado no banco, nunca chumbado) e os
 * insights que a NICO nota sozinha (`nyro.insights()`, cache de 5 min no
 * servidor: campanhas, cobranças, automações, conversas paradas).
 *
 * Tempo real: os eventos de domínio do tenant (contato, negócio, mensagem,
 * agenda, pagamento) disparam um refetch com debounce; um polling de 60s
 * cobre o caso do socket cair (a UI nunca depende só do socket).
 */
function DashboardReal({ periodo, onPeriodo }: { periodo: PeriodoDashboard; onPeriodo: (p: PeriodoDashboard) => void }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [insightsNico, setInsightsNico] = useState<InsightNico[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(() => {
    setErro(null);
    // A NICO é independente do overview: sem módulo de IA ou com a análise
    // indisponível, a seção cai nos insights determinísticos do overview.
    nyro
      .insights()
      .then(setInsightsNico)
      .catch(() => setInsightsNico(null));
    crm
      .overview(periodo)
      .then(setOverview)
      .catch(() => setErro('Não consegui carregar os dados agora.'))
      .finally(() => setCarregando(false));
  }, [periodo]);

  useEffect(() => {
    setCarregando(true);
    carregar();
  }, [carregar]);

  // Refetch com debounce: uma rajada de mensagens vira UM recarregamento.
  const refetchAtual = useRef(carregar);
  refetchAtual.current = carregar;
  const refetchAgendado = useMemo(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    return () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => refetchAtual.current(), 800);
    };
  }, []);

  useRealtime({
    'contact.created': () => refetchAgendado(),
    'deal.created': () => refetchAgendado(),
    'deal.moved': () => refetchAgendado(),
    'deal.updated': () => refetchAgendado(),
    'deal.deleted': () => refetchAgendado(),
    'deal.status_changed': () => refetchAgendado(),
    'pipeline.updated': () => refetchAgendado(),
    'message.created': () => refetchAgendado(),
    'form.submitted': () => refetchAgendado(),
    'appointment.created': () => refetchAgendado(),
    'appointment.confirmed': () => refetchAgendado(),
    'appointment.no_show': () => refetchAgendado(),
    'appointment.cancelled': () => refetchAgendado(),
    'payment.received': () => refetchAgendado(),
  });

  // Plano B: socket fora do ar não pode deixar o painel parado.
  useEffect(() => {
    const i = setInterval(() => refetchAtual.current(), 60_000);
    return () => clearInterval(i);
  }, []);

  if (carregando && !overview) {
    return (
      <div className="card">
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando…</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-28 w-full rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (erro) {
    return (
      <div className="card">
        <ErrorState onRetry={carregar} />
      </div>
    );
  }

  if (!overview) return <DashboardVazio />;

  const semNada = overview.kpis.contatos === 0 && overview.kpis.negocios === 0 && overview.kpis.ganho === 0;
  if (semNada) return <DashboardVazio />;

  const rotuloDias = periodo === '7d' ? 7 : periodo === '90d' ? 90 : 30;

  return (
    <>
      {/* KPIs do mockup: total + delta honesto vs. período anterior + sparkline. */}
      <KpiGrid>
        <KpiSpark icon="leads" label="Total de Leads" kpi={overview.kpis.leads} formato={numero} cor="var(--brand)" href="/leads" />
        <KpiSpark icon="chat" tom="info" label="Conversas Iniciadas" kpi={overview.kpis.conversas} formato={numero} cor="var(--cat-3)" href="/conversas" />
        <KpiSpark icon="calendar" tom="success" label="Agendamentos" kpi={overview.kpis.agendamentos} formato={numero} cor="var(--cat-4)" href="/agenda" />
        <KpiSpark icon="dollar" label="Receita Gerada" kpi={overview.kpis.receita} formato={moeda} cor="var(--brand)" href="/analytics" noPeriodo />
      </KpiGrid>

      <div className="mb-6 grid items-stretch gap-4 xl:grid-cols-12">
        <Section
          className="xl:col-span-7"
          title="Pipeline de Vendas"
          info="Acompanhe o andamento dos seus negócios"
          action={
            <Link href="/pipeline" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver pipeline <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          {overview.funil.length > 0 ? (
            <div className={cx('grid gap-3', overview.funil.length <= 3 ? 'sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 2xl:grid-cols-5')}>
              {overview.funil.map((e) => (
                <CardEtapa key={e.id} etapa={e} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Este funil ainda não tem etapas. Crie as etapas no Pipeline para ver a distribuição aqui.</p>
          )}
        </Section>

        <Section
          className="xl:col-span-5"
          title="Desempenho Geral"
          info={`Crescimento de receita nos últimos ${rotuloDias} dias`}
          action={<AbasPeriodo periodo={periodo} onChange={onPeriodo} />}
        >
          <CardDesempenho overview={overview} />
        </Section>
      </div>

      <div className="mb-6 grid items-stretch gap-4 xl:grid-cols-2">
        <Section
          title="Insights da NICO"
          info="A NICO analisa sua operação continuamente"
          action={
            <Link href="/nyro" className="flex items-center gap-1 text-[13px] font-medium text-violet-300 hover:underline">
              Conversar com a NICO <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          {insightsNico && insightsNico.length > 0 ? (
            <ul className="space-y-3">
              {insightsNico.map((i) => (
                <li key={i.id}>
                  {/* v2: insight da IA = cartão violeta */}
                  <Link
                    href={`/nyro?q=${encodeURIComponent(i.pergunta)}`}
                    className="group flex items-start gap-3 rounded-card border border-violet-border bg-violet-soft p-3.5 transition-colors hover:border-violet-400"
                  >
                    <span className={cx('icon-tile h-9 w-9 shrink-0', tomDaGravidade(i.gravidade))}>
                      <Icon name={iconeDaGravidade(i.gravidade)} size={16} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13.5px] font-medium text-fg">{i.titulo}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-muted">{i.detalhe}</span>
                      <span className="mt-1.5 inline-flex items-center gap-1 text-[12.5px] font-medium text-violet-300">
                        Resolver com a NICO <Icon name="arrowRight" size={13} />
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : overview.insights && overview.insights.length > 0 ? (
            // Sem a análise da NICO (módulo de IA desligado), ficam os
            // insights determinísticos calculados dos mesmos números reais.
            <ul className="space-y-3.5">
              {overview.insights.map((i, idx) => (
                <li key={idx} className="flex items-start gap-2.5">
                  <span className="icon-tile icon-tile-neutral h-8 w-8 shrink-0">
                    <Icon name={i.icone} size={15} />
                  </span>
                  <p className="text-[13.5px] leading-snug text-fg">{i.texto}</p>
                </li>
              ))}
            </ul>
          ) : (
            <VazioCompacto
              icon="ai"
              title="Ainda sem insights"
              description="A NICO analisa pipeline, campanhas, cobranças e conversas para sugerir ações quando houver mais atividade."
              cta={{ href: '/nyro', label: 'Perguntar à NICO' }}
            />
          )}
        </Section>

        <Section
          title="Atividades Recentes"
          action={
            <Link href="/leads" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver todas <Icon name="arrowRight" size={14} />
            </Link>
          }
          bodyClassName="p-0"
        >
          {overview.atividades.length === 0 ? (
            <EmptyState icon="info" title="Sem atividade ainda" description="Ações no CRM aparecem aqui conforme acontecem." />
          ) : (
            <ul className="divide-y divide-line">
              {overview.atividades.map((a, i) => (
                <li key={i} className="flex items-center gap-3 px-5 py-3">
                  <span className={cx('icon-tile h-9 w-9', tileDoTone(a.tone))}>
                    <Icon name={iconeDaAcao(a.acao)} size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-fg">{a.acao}</p>
                    <p className="truncate text-xs text-muted">{a.actor}</p>
                  </div>
                  <Quando data={a.createdAt} className="shrink-0 text-xs text-muted" />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <div className="grid items-stretch gap-4 xl:grid-cols-3">
        <Section title="Fontes de Leads" info="Onde estão vindo seus clientes">
          {overview.fontes && overview.fontes.length > 0 ? (
            <Rosca
              dados={overview.fontes.map((f) => ({ rotulo: f.rotulo, valor: f.valor, pct: Math.round(f.pct) }))}
              total={overview.fontes.reduce((s, f) => s + f.valor, 0)}
              rotuloTotal="leads"
            />
          ) : (
            <EmptyState icon="leads" title="Sem fontes ainda" description="Quando os primeiros leads entrarem, a origem de cada um aparece aqui." />
          )}
        </Section>

        <Section
          title="Receita por Canal"
          info="Performance dos seus canais de aquisição"
          action={overview.kpis.receita?.delta != null ? <Delta value={overview.kpis.receita.delta} /> : undefined}
        >
          {overview.receitaPorCanal && overview.receitaPorCanal.length > 0 ? (
            <BarrasVerticais dados={overview.receitaPorCanal.map((c) => ({ rotulo: c.canal, valor: c.valor }))} formatar={moedaCurta} altura={170} />
          ) : (
            <EmptyState
              icon="chart"
              title="Ainda sem vendas fechadas"
              description="Marque negócios como ganhos no pipeline e a receita por canal aparece aqui."
            />
          )}
        </Section>

        <CardMeta meta={overview.meta ?? null} onMudou={carregar} />
      </div>
    </>
  );
}

/** KPI do mockup: ícone · rótulo · número grande · delta · sparkline do período. */
function KpiSpark({
  icon,
  tom = 'brand',
  label,
  kpi,
  formato,
  cor,
  href,
  noPeriodo = false,
}: {
  icon: IconName;
  tom?: 'brand' | 'info' | 'success';
  label: string;
  kpi: KpiPeriodo | undefined;
  formato: (n: number) => string;
  cor: string;
  href: string;
  /** Receita é medida no período (não acumulado histórico) — o rodapé explica. */
  noPeriodo?: boolean;
}) {
  if (!kpi) return <KpiCard label={label} value="-" icon={icon} />;
  return (
    <Link href={href} className="card-crystal group block min-w-0 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
            <span className={cx('icon-tile h-8 w-8', tom !== 'brand' && `icon-tile-${tom}`)}>
              <Icon name={icon} size={16} />
            </span>
            <span className="truncate">{label}</span>
          </p>
          <p className="t-kpi mt-2.5 text-fg">{formato(noPeriodo ? kpi.noPeriodo : kpi.total)}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted">
            {kpi.delta !== null ? (
              <Delta value={kpi.delta} />
            ) : (
              <span className="text-faint">sem comparação</span>
            )}
            <span>{noPeriodo ? 'no período' : `${numero(kpi.noPeriodo)} no período`}</span>
          </p>
        </div>
      </div>
      <div className="mt-2">
        <Sparkline dados={kpi.serie.map((p) => p.valor)} cor={cor} />
      </div>
    </Link>
  );
}

/** Cartão de etapa do funil (mockup): nome · total · % dos abertos · barra · delta de novos. */
function CardEtapa({ etapa }: { etapa: Overview['funil'][number] }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-4">
      <p className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: etapa.cor || 'var(--brand)' }} aria-hidden />
        <span className="truncate">{etapa.nome}</span>
      </p>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-[22px] font-bold tabular tracking-tight text-fg">{numero(etapa.total)}</span>
        {etapa.pct !== undefined && <span className="text-xs tabular text-faint">{etapa.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</span>}
      </p>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-[var(--fill-4)]" aria-hidden>
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.max(etapa.total > 0 ? 6 : 0, etapa.pct ?? 0)}%`, background: etapa.cor || 'var(--brand)' }}
        />
      </div>
      <p className="mt-2 text-xs">
        {etapa.deltaNovos != null ? (
          <span className="flex items-center gap-1.5">
            <Delta value={etapa.deltaNovos} />
            <span className="text-faint">{numero(etapa.novos ?? 0)} novos</span>
          </span>
        ) : (
          <span className="text-faint">{numero(etapa.novos ?? 0)} novos no período</span>
        )}
      </p>
    </div>
  );
}

/** "Desempenho Geral": delta em destaque + curva diária de receita do período. */
function CardDesempenho({ overview }: { overview: Overview }) {
  const receita = overview.kpis.receita;
  const serie = overview.receitaSerie ?? [];
  const temReceita = serie.some((p) => p.valor > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="t-display">
          {receita && receita.delta !== null ? `${receita.delta >= 0 ? '+' : '−'}${Math.abs(receita.delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—'}
        </p>
        {receita && receita.delta !== null && (
          <span className={cx('delta', receita.delta >= 0 ? 'delta-up' : 'delta-down')}>
            <Icon name={receita.delta >= 0 ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.4} />
            vs. período anterior
          </span>
        )}
        {receita && receita.delta === null && <span className="text-xs text-muted">sem período anterior para comparar</span>}
      </div>
      <p className="mt-1 text-[13px] text-muted">
        {moeda(receita?.noPeriodo ?? 0)} em negócios ganhos no período
      </p>
      <div className="mt-4 flex-1">
        {temReceita ? (
          <AreaReceita
            dados={serie.map((p) => ({ rotulo: `${p.dia.slice(8, 10)}/${p.dia.slice(5, 7)}`, valor: p.valor }))}
            altura={190}
          />
        ) : (
          <EmptyState
            icon="chart"
            title="Ainda sem vendas fechadas"
            description="Marque negócios como ganhos no pipeline e a curva de receita aparece aqui, dia a dia."
          />
        )}
      </div>
    </div>
  );
}

/** Gravidade do insight da NICO → ícone e tom do tile. */
function iconeDaGravidade(g: InsightNico['gravidade']): IconName {
  return g === 'alta' ? 'flame' : g === 'media' ? 'zap' : 'info';
}
function tomDaGravidade(g: InsightNico['gravidade']): string {
  return g === 'alta' ? 'icon-tile-danger' : g === 'media' ? 'icon-tile-warning' : 'icon-tile-neutral';
}

/**
 * "Meta em foco": meta de receita do trimestre (definida pelo tenant) +
 * realizado. O degradê é escuro de propósito e NÃO usa tokens de tema: a
 * marca do produto é clara (lima) no tema claro e texto branco sobre ela
 * não tinha contraste — o card precisa ler bem nos dois temas.
 */
function CardMeta({ meta, onMudou }: { meta: { valor: number; realizado: number } | null; onMudou: () => void }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState('');
  const [salvando, setSalvando] = useState(false);

  const salvar = () => {
    const v = Number(valor.replace(/\./g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) return;
    setSalvando(true);
    crm
      .definirMetaReceita(v)
      .then(() => {
        setEditando(false);
        setValor('');
        onMudou();
      })
      .finally(() => setSalvando(false));
  };

  const pct = meta && meta.valor > 0 ? Math.min(100, Math.round((meta.realizado / meta.valor) * 100)) : 0;

  return (
    <section
      className="card relative flex min-w-0 flex-col overflow-hidden p-5 text-white"
      style={{ background: 'linear-gradient(140deg, #3b1478 0%, #1a0533 55%, #0d0118 100%)' }}
    >
      <p className="flex items-center gap-2 text-[13px] font-medium text-white/85">
        <Icon name="bolt" size={15} />
        Meta em foco
      </p>

      {meta && !editando ? (
        <>
          <p className="mt-3 text-[30px] font-bold tabular leading-none tracking-tight">{moeda(meta.valor)}</p>
          <p className="mt-1.5 text-[13px] text-white/75">de receita no trimestre atual</p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/20" aria-hidden>
            <div className="h-full rounded-full bg-white" style={{ width: `${Math.max(pct > 0 ? 3 : 0, pct)}%` }} />
          </div>
          <p className="mt-2 text-xs text-white/80">
            {moeda(meta.realizado)} realizados · {pct}%
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/nyro" className="btn btn-sm bg-white/15 text-white hover:bg-white/25">
              Ver estratégia <Icon name="arrowRight" size={14} />
            </Link>
            <button type="button" className="btn btn-sm bg-transparent text-white/80 hover:bg-white/10" onClick={() => setEditando(true)}>
              Ajustar meta
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 text-[15px] font-semibold leading-snug">
            {editando ? 'Qual a meta de receita do trimestre?' : 'Defina a meta de receita do trimestre'}
          </p>
          <p className="mt-1.5 text-[13px] text-white/75">
            A NICO acompanha o realizado contra a meta e avisa quando o ritmo sair da rota.
          </p>
          {editando ? (
            <div className="mt-4 flex items-center gap-2">
              <input
                type="text"
                inputMode="numeric"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && salvar()}
                placeholder="500.000"
                aria-label="Meta de receita do trimestre em reais"
                className="input min-w-0 flex-1 bg-white/10 text-white placeholder:text-white/50"
                autoFocus
              />
              <button type="button" className="btn btn-sm bg-white text-[var(--brand)] hover:bg-white/90" onClick={salvar} disabled={salvando}>
                {salvando ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn-sm mt-4 w-fit bg-white text-[var(--brand)] hover:bg-white/90" onClick={() => setEditando(true)}>
              <Icon name="target" size={14} />
              Definir meta
            </button>
          )}
        </>
      )}
    </section>
  );
}

function DashboardComDados() {
  const k = DASHBOARD_KPIS;

  return (
    <>
      <KpiGrid>
        <KpiCard label="Leads do Dia" value={numero(k.leadsDoDia.valor)} icon="leads" delta={k.leadsDoDia.delta} comparacao={k.leadsDoDia.comparacao} />
        <KpiCard label="Taxa de Resposta" value={percentual(k.taxaResposta.valor, 0, true)} icon="chat" delta={k.taxaResposta.delta} comparacao={k.taxaResposta.comparacao} />
        <KpiCard
          label="Follow-ups Pendentes"
          value={numero(k.followupsPendentes.valor)}
          icon="clock"
          tom="warning"
          delta={k.followupsPendentes.delta}
          // Mais follow-up pendente é PIOR: a seta precisa ficar vermelha
          // mesmo o número tendo subido.
          deltaBom={false}
          comparacao={k.followupsPendentes.comparacao}
        />
        <KpiCard label="Receita Gerada" value={moeda(k.receitaGerada.valor)} icon="dollar" tom="success" delta={k.receitaGerada.delta} comparacao={k.receitaGerada.comparacao} />
      </KpiGrid>

      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        <Section
          title="Pipeline de Vendas"
          action={
            <Link href="/pipeline" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver pipeline <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          <p className="t-display">{moeda(VALOR_PIPELINE)}</p>
          <p className="mt-1 text-[13px] text-muted">em oportunidades</p>
          <div className="mt-5">
            <FaixasFunil etapas={FUNIL_RESUMO} />
          </div>
        </Section>

        <Section title="Crescimento de Receita" action={<SeletorPeriodo />}>
          <div className="flex flex-wrap items-baseline gap-3">
            <p className="t-display">{moeda(DASHBOARD_KPIS.receitaGerada.valor)}</p>
            <span className="delta delta-up">
              <Icon name="arrowUp" size={12} strokeWidth={2.4} />
              {DASHBOARD_KPIS.receitaGerada.delta}%
            </span>
            <span className="text-[13px] text-muted">vs. período anterior</span>
          </div>
          <div className="mt-6">
            <AreaReceita dados={RECEITA_30D} altura={180} />
          </div>
        </Section>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Section
          title="Atividade Recente"
          action={
            <Link href="/leads" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver todas <Icon name="arrowRight" size={14} />
            </Link>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-line">
            {ATIVIDADE_RECENTE.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-5 py-3">
                <span className={cx('icon-tile h-9 w-9', toneDaAtividade(a.tipo))}>
                  <Icon name={iconeDaAtividade(a.tipo)} size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium text-fg">{a.titulo}</p>
                  <p className="truncate text-xs text-muted">{a.descricao}</p>
                </div>
                <Quando data={a.quando} className="shrink-0 text-xs text-muted" />
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title="Próximas Tarefas"
          action={
            <Link href="/agenda" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver agenda <Icon name="arrowRight" size={14} />
            </Link>
          }
          bodyClassName="p-0"
        >
          <ul className="divide-y divide-line">
            {PROXIMAS_TAREFAS.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={cx(
                    'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border',
                    t.concluida ? 'border-brand bg-brand text-white' : 'border-line-strong',
                  )}
                  aria-hidden
                >
                  {t.concluida && <Icon name="check" size={11} strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cx('truncate text-[13.5px] font-medium', t.concluida ? 'text-muted line-through' : 'text-fg')}>
                    {t.titulo}
                  </p>
                  <p className="truncate text-xs text-muted">{t.contexto}</p>
                </div>
                <span className={cx('shrink-0 text-xs font-medium', t.concluida ? 'text-faint line-through' : t.urgente ? 'text-danger' : 'text-muted')}>
                  Hoje, {hora(t.quando)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <PainelInsights />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function PainelInsights() {
  return (
    <section className="card flex flex-col">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <h2 className="t-section">Insights da NICO</h2>
        <span className="pill border border-violet-border bg-violet-soft text-violet-300">IA</span>
      </div>

      {/* v2: violeta = inteligência — tudo que a IA produz nesta tela é violeta. */}
      <div className="flex-1 p-5">
        <div className="rounded-card border border-violet-border bg-violet-soft p-4">
          <div className="flex items-start gap-2.5">
            <Icon name="ai" size={18} className="mt-0.5 shrink-0 text-violet-300" />
            <div>
              <p className="text-[13.5px] font-semibold text-fg">
                {INSIGHTS_DASHBOARD.length} recomendações para você
              </p>
              <p className="text-xs text-muted">Com base nos seus dados dos últimos 30 dias</p>
            </div>
          </div>

          <ol className="mt-4 space-y-3.5">
            {INSIGHTS_DASHBOARD.map((i, idx) => (
              <li key={i.id} className="flex gap-2.5">
                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-900 text-[11px] font-semibold text-violet-300">
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

        <Link href="/nyro" className="btn btn-ai mt-4 w-full">
          <Icon name="ai" size={16} />
          Aplicar recomendações com a NICO
          <Icon name="arrowRight" size={15} />
        </Link>
      </div>
    </section>
  );
}

function SeletorPeriodo() {
  return (
    <div className="segbar" role="tablist" aria-label="Período">
      {['7D', '30D', '3M', '12M'].map((p) => (
        <button key={p} type="button" role="tab" className="seg" aria-selected={p === '30D'}>
          {p}
        </button>
      ))}
    </div>
  );
}

/**
 * Sem dado real e sem modo demo: a tela explica o que falta em vez de
 * mostrar zeros que parecem métrica.
 */
function DashboardVazio() {
  return (
    <div className="card">
      <EmptyState
        premium
        icon="chart"
        title="Seu painel de receita ainda não tem dados"
        description="Assim que entrarem leads, conversas e negócios, os indicadores aparecem aqui automaticamente."
        action={
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link href="/leads" className="btn btn-primary btn-sm">
              <Icon name="plus" size={15} />
              Cadastrar primeiro lead
            </Link>
            <Link href="/pipeline" className="btn btn-sm">
              <Icon name="chart" size={15} />
              Abrir o pipeline
            </Link>
          </div>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */

/** Estado vazio de painel secundário: uma linha, com a ação útil ao lado. */
function VazioCompacto({ icon, title, description, cta }: { icon: IconName; title: string; description: string; cta: { href: string; label: string } }) {
  return (
    <div className="flex items-start gap-3 px-5 pb-5 pt-3">
      <span className="icon-tile icon-tile-neutral h-9 w-9 rounded-md">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
        <Link href={cta.href} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
          {cta.label} <Icon name="arrowRight" size={14} />
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function iconeDaAtividade(tipo: string): IconName {
  const mapa: Record<string, IconName> = {
    mensagem: 'whatsapp',
    email: 'mail',
    lead_criado: 'leads',
    reuniao: 'calendar',
    etapa: 'dollar',
    campanha: 'send',
    visita: 'eye',
    nota: 'note',
    tarefa: 'check2',
  };
  return mapa[tipo] ?? 'info';
}

function toneDaAtividade(tipo: string): string {
  const mapa: Record<string, string> = {
    mensagem: 'icon-tile-success',
    email: 'icon-tile-info',
    lead_criado: '',
    reuniao: '',
    etapa: 'icon-tile-success',
  };
  return mapa[tipo] ?? 'icon-tile-neutral';
}

/**
 * Ícone da atividade REAL inferido do texto da ação (a tabela `activities`
 * guarda frase, não tipo). A ordem importa: "agendamento" antes de "lead".
 */
function iconeDaAcao(acao: string): IconName {
  const a = acao.toLowerCase();
  if (/mensagem|whatsapp|respondeu/.test(a)) return 'whatsapp';
  if (/agend|reuni|compromisso|confirmou|faltou/.test(a)) return 'calendar';
  if (/meta/.test(a)) return 'target';
  if (/ganho|venda|negócio|negocio|etapa|funil|pipeline|proposta/.test(a)) return 'dollar';
  if (/lead|contato/.test(a)) return 'leads';
  if (/tarefa/.test(a)) return 'check2';
  if (/campanha|disparo/.test(a)) return 'send';
  if (/nota/.test(a)) return 'note';
  return 'info';
}

/** Tom do tile a partir do `tone` gravado na atividade (green, success, brand…). */
function tileDoTone(tone: string): string {
  const mapa: Record<string, string> = {
    green: 'icon-tile-success',
    success: 'icon-tile-success',
    red: 'icon-tile-danger',
    danger: 'icon-tile-danger',
    yellow: 'icon-tile-warning',
    warning: 'icon-tile-warning',
    blue: 'icon-tile-info',
    info: 'icon-tile-info',
  };
  return mapa[tone] ?? 'icon-tile-neutral';
}

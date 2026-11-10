'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell, PageHeader, Section, KpiGrid } from '@/components/revenue/Page';
import { KpiCard } from '@/components/revenue/Kpi';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { AreaReceita, FaixasFunil } from '@/components/revenue/charts';
import { moeda, numero, percentual, primeiroNome, saudacao, hora } from '@/lib/format';
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
import { crm, type Overview, type Tarefa } from '@/lib/crm';
import { conversaoHonesta } from '@/lib/revenue/conversao';

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

  // A saudação depende da hora LOCAL. Servidor e navegador podem estar em
  // fusos diferentes, e o React trata a divergência como erro de hidratação.
  // Primeiro render neutro; a saudação entra depois de montar.
  const [saudacaoAtual, setSaudacaoAtual] = useState<string | null>(null);
  useEffect(() => setSaudacaoAtual(saudacao()), []);

  const nome = primeiroNome(user?.name);

  return (
    <PageShell>
      <PageHeader
        title={saudacaoAtual ? `${saudacaoAtual}${nome ? `, ${nome}` : ''}.` : nome ? `Olá, ${nome}.` : 'Seu painel de receita'}
        subtitle="Aqui está o que está movimentando a sua receita hoje."
        quote={'"Mais conversas. Mais oportunidades.\nMais receita."'}
        actions={<SeloDemo />}
      />

      {demo ? <DashboardComDados /> : <DashboardReal />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Dashboard com dado REAL do tenant — consulta `crm.overview()` (soma de
 * negócios, funil por etapa, contatos, atividades — tudo calculado no banco,
 * nunca chumbado) e `crm.tasks('hoje')`.
 *
 * Três KPIs do mockup (Leads do Dia, Taxa de Resposta, Follow-ups Pendentes)
 * e o gráfico de evolução de receita NÃO têm fonte real ainda — nenhuma
 * automação de resposta grava `firstResponseAt`, e não existe agregação
 * diária. Mostrar zero aqui seria tão falso quanto mostrar 247: os dois
 * afirmam algo que não foi medido. Em vez disso a tela diz honestamente que
 * ainda não é possível calcular essa métrica.
 */
function DashboardReal() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [tarefas, setTarefas] = useState<Tarefa[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = () => {
    setCarregando(true);
    setErro(null);
    Promise.all([crm.overview(), crm.tasks('hoje')])
      .then(([o, t]) => {
        setOverview(o);
        setTarefas(t);
      })
      .catch(() => setErro('Não consegui carregar os dados agora.'))
      .finally(() => setCarregando(false));
  };

  useEffect(carregar, []);

  if (carregando && !overview) {
    return (
      <div className="card">
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true" aria-live="polite">
          <span className="sr-only">Carregando…</span>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton h-24 w-full rounded-lg" />
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

  return (
    <>
      <KpiGrid>
        <KpiCard label="Contatos" value={numero(overview.kpis.contatos)} icon="leads" />
        <KpiCard label="Negócios Abertos" value={numero(overview.kpis.negocios)} icon="briefcase" />
        <KpiCard label="Valor em Pipeline" value={moeda(overview.kpis.valorFunil)} icon="dollar" tom="success" />
        <KpiCard label="Taxa de Conversão" icon="chart" {...conversaoHonesta(overview.kpis)} />
      </KpiGrid>

      <div className="mb-6 grid gap-4 xl:grid-cols-2">
        <Section
          title="Pipeline de Vendas"
          info={overview.funilNome ? `Abertos por etapa · ${overview.funilNome}` : 'Abertos por etapa'}
          action={
            <Link href="/pipeline" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver pipeline <Icon name="arrowRight" size={14} />
            </Link>
          }
        >
          {/* O valor total já está no KPI acima: aqui entra o funil por etapa (valor e contagem). */}
          {overview.funil.length > 0 ? (
            <FunilPorEtapa etapas={overview.funil} />
          ) : (
            <p className="text-sm text-muted">Este funil ainda não tem etapas. Crie as etapas no Pipeline para ver a distribuição aqui.</p>
          )}
        </Section>

        <Section title="Crescimento de Receita" info="Negócios ganhos por mês, últimos 6 meses">
          {(overview.receitaMensal ?? []).some((m) => m.valor > 0) ? (
            <AreaReceita
              dados={(overview.receitaMensal ?? []).map((m) => ({
                rotulo: new Date(`${m.mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', ''),
                valor: m.valor,
              }))}
            />
          ) : (
            <EmptyState
              icon="chart"
              title="Ainda sem vendas fechadas"
              description="Marque negócios como ganhos no pipeline e a curva de receita aparece aqui, mês a mês."
            />
          )}
        </Section>
      </div>

      {/* items-start: painel vazio fica do tamanho do conteúdo, não estica até a altura da Atividade. */}
      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Section
          title="Atividade Recente"
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
                  <span className="icon-tile h-9 w-9 icon-tile-neutral">
                    <Icon name="info" size={17} />
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

        <Section
          title="Tarefas de Hoje"
          action={
            <Link href="/tarefas" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
              Ver tarefas <Icon name="arrowRight" size={14} />
            </Link>
          }
          bodyClassName="p-0"
        >
          {!tarefas || tarefas.length === 0 ? (
            <VazioCompacto
              icon="check2"
              title="Nada vencendo hoje"
              description="Tarefas com prazo para hoje aparecem aqui."
              cta={{ href: '/tarefas', label: 'Criar tarefa' }}
            />
          ) : (
            <ul className="divide-y divide-line">
              {tarefas.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                  <span
                    className={cx(
                      'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border',
                      t.status === 'concluida' ? 'border-brand bg-brand text-white' : 'border-line-strong',
                    )}
                    aria-hidden
                  >
                    {t.status === 'concluida' && <Icon name="check" size={11} strokeWidth={3} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cx('truncate text-[13.5px] font-medium', t.status === 'concluida' ? 'text-muted line-through' : 'text-fg')}>
                      {t.titulo}
                    </p>
                    {t.descricao && <p className="truncate text-xs text-muted">{t.descricao}</p>}
                  </div>
                  {t.dueAt && (
                    <span className={cx('shrink-0 text-xs font-medium', t.atrasada ? 'text-danger' : 'text-muted')}>
                      {hora(t.dueAt)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Section>

        <section className="card flex flex-col">
          <div className="flex items-center justify-between gap-3 px-5 pt-5">
            <h2 className="t-section">Insights da NICO</h2>
            <span className="pill pill-brand">Beta</span>
          </div>
          <VazioCompacto
            icon="ai"
            title="Analise sua operação com a NICO"
            description="Solicite uma análise à NICO. Revise as fontes e aprove as ações sugeridas antes de executá-las."
            cta={{ href: '/nyro', label: 'Perguntar à NICO' }}
          />
        </section>
      </div>
    </>
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
        <span className="pill pill-brand">Beta</span>
      </div>

      <div className="flex-1 p-5">
        <div className="rounded-lg border border-brand-border bg-brand-softer p-4">
          <div className="flex items-start gap-2.5">
            <Icon name="ai" size={18} className="mt-0.5 shrink-0 text-brand" />
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

/** Funil do dashboard: uma linha por etapa, barra proporcional ao VALOR. */
function FunilPorEtapa({ etapas }: { etapas: Overview['funil'] }) {
  const maior = Math.max(...etapas.map((e) => e.valor), 0);
  return (
    <ul className="space-y-3.5">
      {etapas.map((e) => {
        const pct = maior > 0 ? Math.max(e.valor > 0 ? 3 : 0, Math.round((e.valor / maior) * 100)) : 0;
        return (
          <li key={e.id}>
            <div className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.cor }} aria-hidden />
                <span className="truncate text-sm font-medium text-fg">{e.nome}</span>
                <span className="shrink-0 text-xs tabular text-muted">
                  {numero(e.total)} {e.total === 1 ? 'negócio' : 'negócios'}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular text-fg">{moeda(e.valor)}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--fill-4)]" aria-hidden>
              <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%`, opacity: e.valor > 0 ? 1 : 0 }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Estado vazio de painel secundário: uma linha, com a ação útil ao lado. */
function VazioCompacto({ icon, title, description, cta }: { icon: Parameters<typeof Icon>[0]['name']; title: string; description: string; cta: { href: string; label: string } }) {
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

function iconeDaAtividade(tipo: string): Parameters<typeof Icon>[0]['name'] {
  const mapa: Record<string, Parameters<typeof Icon>[0]['name']> = {
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

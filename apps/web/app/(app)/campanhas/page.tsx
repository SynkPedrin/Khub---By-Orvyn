'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';
import { PageShell, PageHeader, KpiGrid, Section } from '@/components/revenue/Page';
import { KpiCard } from '@/components/revenue/Kpi';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { EmptyState } from '@/components/revenue/States';
import { CanalBadge } from '@/components/revenue/lead-ui';
import { numero, percentual } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import { CAMPANHAS, CAMPANHAS_KPIS, INSIGHTS_CAMPANHA } from '@/lib/demo/dataset';
import { ads, type AdsOverview, type Campaign as AdsCampaign } from '@/lib/ads';
import { brl } from '@/lib/crm';
import { BrandLogo } from '@/components/brand/BrandLogo';
import type { Campanha } from '@/lib/revenue/types';
import { Tabs, TabPanel } from '@/components/kit';
import { ListaDisparos } from '@/components/disparos/ListaDisparos';

/**
 * CAMPANHAS — prospecção multicanal.
 *
 * Modo real (Q4.3): aba Disparos com envio em massa de verdade, agora que
 * existem opt-out, janela de envio, limite diário por tenant, aprovação humana
 * e trilha de auditoria (DisparosService). A aba Anúncios mostra a Meta Ads.
 * O modo demo continua com o dataset ilustrativo.
 */
export default function CampanhasPage() {
  const demo = modoDemo();

  return (
    <PageShell>
      <PageHeader
        title="Campanhas"
        subtitle="Crie, gerencie e otimize suas campanhas de prospecção multicanal."
        quote={'"Mais conversas. Mais oportunidades.\nMais receita."'}
        actions={<SeloDemo />}
      />

      {demo ? <CampanhasComDados /> : <CampanhasReais />}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

const ABAS = ['Todas', 'Ativas', 'Pausadas', 'Rascunhos', 'Arquivadas'] as const;

function CampanhasComDados() {
  const [aba, setAba] = useState<(typeof ABAS)[number]>('Todas');
  const [selecionada, setSelecionada] = useState<string>(CAMPANHAS[0].id);

  const lista = useMemo(() => {
    const mapa: Record<string, Campanha['status']> = {
      Ativas: 'ativa',
      Pausadas: 'pausada',
      Rascunhos: 'rascunho',
      Arquivadas: 'arquivada',
    };
    const alvo = mapa[aba];
    return alvo ? CAMPANHAS.filter((c) => c.status === alvo) : CAMPANHAS;
  }, [aba]);

  const campanha = CAMPANHAS.find((c) => c.id === selecionada) ?? lista[0];

  return (
    <>
      <KpiGrid>
        <KpiCard label="Envios" value={numero(CAMPANHAS_KPIS.envios.valor)} icon="send" delta={CAMPANHAS_KPIS.envios.delta} comparacao="vs. mês anterior" />
        <KpiCard label="Respostas" value={numero(CAMPANHAS_KPIS.respostas.valor)} icon="chat" delta={CAMPANHAS_KPIS.respostas.delta} comparacao="vs. mês anterior" />
        <KpiCard label="Reuniões Marcadas" value={numero(CAMPANHAS_KPIS.reunioes.valor)} icon="calendar" delta={CAMPANHAS_KPIS.reunioes.delta} comparacao="vs. mês anterior" />
        <KpiCard
          label="Conversão"
          value={percentual(CAMPANHAS_KPIS.conversao.valor, 1, true)}
          icon="users"
          delta={CAMPANHAS_KPIS.conversao.delta}
          comparacao="p.p. vs. mês anterior"
        />
      </KpiGrid>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_356px]">
        <div className="min-w-0 space-y-4">
          {/* Tabela */}
          <section className="card">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-3">
              <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filtrar campanhas por status">
                {ABAS.map((a) => (
                  <button key={a} type="button" role="tab" className="seg" aria-selected={aba === a} onClick={() => setAba(a)}>
                    {a}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                  <input type="search" className="input h-9 w-[190px] pl-9" placeholder="Buscar campanhas..." aria-label="Buscar campanhas" />
                </div>
                <select className="select h-9 w-auto" aria-label="Filtrar por canal">
                  <option>Todos os canais</option>
                </select>
              </div>
            </div>

            <div className="overflow-x-auto scrollbar-thin">
              {lista.length === 0 ? (
                <EmptyState icon="send" title="Nenhuma campanha aqui" description={`Não há campanhas com status "${aba}".`} />
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th className="w-9">
                        <span className="sr-only">Selecionar</span>
                      </th>
                      <th>Campanha</th>
                      <th>Status</th>
                      <th>Canais</th>
                      <th>Público</th>
                      <th className="text-right">Envios</th>
                      <th className="text-right">Respostas</th>
                      <th className="text-right">Reuniões</th>
                      <th className="text-right">Conversão</th>
                      <th className="w-9">
                        <span className="sr-only">Ações</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.map((c) => (
                      <tr
                        key={c.id}
                        data-selected={campanha?.id === c.id}
                        onClick={() => setSelecionada(c.id)}
                        className="cursor-pointer"
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="checkbox" aria-label={`Selecionar ${c.nome}`} />
                        </td>
                        <td>
                          <p className="text-[13.5px] font-semibold text-fg">{c.nome}</p>
                          <p className="text-xs text-muted">{c.subtitulo}</p>
                        </td>
                        <td>
                          <StatusCampanha status={c.status} />
                        </td>
                        <td>
                          <span className="flex items-center gap-1.5">
                            {c.canais.map((ch) => (
                              <CanalBadge key={ch} canal={ch} comRotulo={false} />
                            ))}
                          </span>
                        </td>
                        <td>
                          <p className="text-[13px] text-fg">{c.publico.rotulo}</p>
                          {c.publico.detalhe && <p className="text-xs text-muted">{c.publico.detalhe}</p>}
                        </td>
                        <Numero valor={c.envios} />
                        <Numero valor={c.respostas} />
                        <Numero valor={c.reunioes} />
                        <td className="text-right tabular text-fg">
                          {c.conversao == null ? <span className="text-faint">-</span> : percentual(c.conversao, 1, true)}
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label={`Ações de ${c.nome}`}>
                            <Icon name="dots" size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Insights da Campanha" action={<span className="pill pill-brand">Com IA</span>} bodyClassName="p-0">
              <ul className="divide-y divide-line">
                {INSIGHTS_CAMPANHA.map((i, idx) => (
                  <li key={i.id} className="flex items-start gap-2.5 px-5 py-3">
                    <span className="icon-tile h-8 w-8 shrink-0 rounded-sm">
                      <Icon name={(['ai', 'users', 'clock', 'note'] as IconName[])[idx] ?? 'ai'} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold text-fg">{i.titulo}</p>
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted">{i.descricao}</p>
                    </div>
                    {idx === INSIGHTS_CAMPANHA.length - 1 && (
                      <button type="button" className="btn btn-soft btn-sm shrink-0">
                        Aplicar sugestão
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </Section>

            <Agendamento />
          </div>
        </div>

        <aside className="min-w-0 2xl:sticky 2xl:top-4 2xl:self-start">
          {campanha ? <PainelCampanha campanha={campanha} /> : null}
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Numero({ valor }: { valor: number | null }) {
  return <td className="text-right tabular text-fg">{valor == null ? <span className="text-faint">-</span> : numero(valor)}</td>;
}

function StatusCampanha({ status }: { status: Campanha['status'] }) {
  const mapa = {
    ativa: { rotulo: 'Ativa', classe: 'pill-success' },
    pausada: { rotulo: 'Pausada', classe: 'pill-warning' },
    rascunho: { rotulo: 'Rascunho', classe: '' },
    arquivada: { rotulo: 'Arquivada', classe: '' },
  }[status];
  return <span className={cx('pill', mapa.classe)}>{mapa.rotulo}</span>;
}

function Agendamento() {
  const [ativa, setAtiva] = useState(true);
  const dias = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  const [selecionados, setSelecionados] = useState(new Set(['Seg', 'Ter', 'Qua', 'Qui', 'Sex']));

  return (
    <Section
      title={
        <span className="flex items-center gap-2">
          <Icon name="calendar" size={16} className="text-brand" />
          Agendamento
        </span>
      }
      action={
        <Link href="/agenda" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
          Ver calendário <Icon name="arrowRight" size={14} />
        </Link>
      }
    >
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-medium text-fg">Campanha em andamento</p>
            <p className="text-xs text-muted">Pausar ou retomar os envios da sequência.</p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={ativa}
            aria-label="Campanha em andamento"
            onClick={() => setAtiva((v) => !v)}
            className={cx('relative h-6 w-11 shrink-0 rounded-full transition', ativa ? 'bg-brand' : 'bg-surface3')}
          >
            <span
              className={cx(
                'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all',
                ativa ? 'left-[22px]' : 'left-0.5',
              )}
            />
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="flex items-center gap-2.5">
            <Icon name="clock" size={15} className="text-faint" />
            <div>
              <p className="text-[13px] text-fg">Janela de envio</p>
              <p className="text-xs text-muted">09:00 - 18:00</p>
            </div>
          </div>
          <Icon name="chevronRight" size={16} className="text-faint" />
        </div>

        <div className="border-t border-line pt-3">
          <p className="mb-2 flex items-center gap-2.5 text-[13px] text-fg">
            <Icon name="calendar" size={15} className="text-faint" />
            Dias da semana
          </p>
          <div className="flex flex-wrap gap-1.5">
            {dias.map((d) => {
              const on = selecionados.has(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setSelecionados((s) => {
                      const n = new Set(s);
                      if (n.has(d)) n.delete(d);
                      else n.add(d);
                      return n;
                    })
                  }
                  className={cx(
                    'h-8 w-10 rounded-sm text-[12.5px] font-medium transition',
                    on ? 'bg-brand-soft text-brand' : 'bg-surface2 text-muted hover:text-fg',
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="flex items-center gap-2.5 text-[13px] text-fg">
            <Icon name="globe" size={15} className="text-faint" />
            Fuso horário
          </p>
          <select className="select h-8 w-auto" aria-label="Fuso horário" defaultValue="brasilia">
            <option value="brasilia">(GMT-03:00) Brasília</option>
          </select>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */

function PainelCampanha({ campanha }: { campanha: Campanha }) {
  const [aba, setAba] = useState<'sequencia' | 'desempenho' | 'publico' | 'config'>('sequencia');

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between gap-2 p-4 pb-0">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-bold text-fg">{campanha.nome}</p>
            <p className="truncate text-[12.5px] text-muted">{campanha.subtitulo}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusCampanha status={campanha.status} />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Ações da campanha">
              <Icon name="dots" size={16} />
            </button>
          </div>
        </div>

        {campanha.descricao && <p className="px-4 pt-2 text-[12.5px] leading-relaxed text-muted">{campanha.descricao}</p>}

        {/* Números da campanha */}
        <dl className="grid grid-cols-2 gap-2 border-b border-line p-4 sm:grid-cols-4">
          {[
            { rotulo: 'Envios', valor: campanha.envios },
            { rotulo: 'Respostas', valor: campanha.respostas },
            { rotulo: 'Reuniões', valor: campanha.reunioes },
          ].map((m) => (
            <div key={m.rotulo}>
              <dd className="text-[17px] font-bold tabular text-fg">{m.valor == null ? '-' : numero(m.valor)}</dd>
              <dt className="text-[11px] text-muted">{m.rotulo}</dt>
            </div>
          ))}
          <div>
            <dd className="text-[17px] font-bold tabular text-fg">
              {campanha.conversao == null ? '-' : percentual(campanha.conversao, 1, true)}
            </dd>
            <dt className="text-[11px] text-muted">Conversão</dt>
          </div>
        </dl>

        <div className="flex gap-4 border-b border-line px-4" role="tablist">
          {(['sequencia', 'desempenho', 'publico', 'config'] as const).map((a) => (
            <button key={a} type="button" role="tab" className="tab text-[13px]" aria-selected={aba === a} onClick={() => setAba(a)}>
              {{ sequencia: 'Sequência', desempenho: 'Desempenho', publico: 'Público', config: 'Configurações' }[a]}
            </button>
          ))}
        </div>

        <div className="p-4">
          {aba === 'sequencia' ? (
            campanha.sequencia.length === 0 ? (
              <EmptyState icon="send" title="Sequência vazia" description="Adicione a primeira etapa para montar a cadência." />
            ) : (
              <>
                <ol className="space-y-0">
                  {campanha.sequencia.map((e, i) => (
                    <li key={e.ordem} className="relative flex gap-3 pb-4 last:pb-0">
                      {/* Fio ligando as etapas da cadência */}
                      {i < campanha.sequencia.length - 1 && (
                        <span className="absolute left-[13px] top-7 h-full w-px bg-line" aria-hidden />
                      )}
                      <span className="relative z-sticky flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface2 text-[12px] font-semibold text-muted ring-1 ring-line">
                        {e.ordem}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold text-fg">
                            <CanalBadge canal={e.canal} comRotulo={false} />
                            <span className="truncate">{e.titulo}</span>
                          </p>
                          <span className="shrink-0 text-[11.5px] text-muted">Dia {e.dia}</span>
                        </div>
                        <p className="mt-0.5 text-[12px] leading-snug text-muted">{e.descricao}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <button type="button" className="btn btn-soft btn-sm mt-3 w-full">
                  <Icon name="plus" size={14} />
                  Adicionar etapa
                </button>
              </>
            )
          ) : (
            <EmptyState icon="info" title={`Aba ${aba}`} description="Conteúdo desta aba ainda não carregado." />
          )}
        </div>
      </div>

      {/* Otimização com IA */}
      <div className="card p-4">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold text-fg">
          <Icon name="ai" size={16} className="text-brand" />
          Otimização com IA
          <span className="pill pill-brand ml-auto h-[20px] px-2 text-2xs">Beta</span>
        </p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-muted">
          Deixe a IA analisar o desempenho e sugerir melhorias para sua campanha.
        </p>
        <Link href="/ia" className="btn btn-ai mt-3 w-full">
          <Icon name="ai" size={15} />
          Obter recomendações da IA
          <Icon name="arrowRight" size={15} />
        </Link>
      </div>

      {/* Aviso honesto sobre o estado do módulo */}
      <div className="card flex gap-2.5 border-warning-border bg-warning-soft p-3.5">
        <Icon name="info" size={16} className="mt-0.5 shrink-0" style={{ color: 'var(--warning)' }} />
        <p className="text-[12px] leading-relaxed text-fg">
          <span className="font-semibold">Disparo desativado nesta versão.</span> A interface e o modelo de dados estão
          prontos; o envio real será habilitado junto com opt-out, limite por conta e trilha de auditoria.
        </p>
      </div>
    </div>
  );
}

/**
 * Campanhas com dados reais: as campanhas de ANÚNCIOS conectadas (Meta Ads
 * hoje) aparecem aqui — antes, a tela era só o estado vazio de prospecção e
 * quem conectava a Meta não via nada. A gestão completa fica em
 * Marketing → Ads; esta seção é a vitrine do que já está rodando.
 */
/**
 * Modo real: duas abas. "Disparos" é o disparo em massa por segmento (Q4.3),
 * com aprovação, lotes, janela e opt-out; "Anúncios" mantém os dados da Meta Ads.
 */
function CampanhasReais() {
  const [aba, setAba] = useState<'disparos' | 'anuncios'>('disparos');
  return (
    <div className="space-y-4">
      <Tabs
        idBase="campanhas-abas"
        label="Tipo de campanha"
        value={aba}
        onChange={setAba}
        items={[{ value: 'disparos', label: 'Disparos' }, { value: 'anuncios', label: 'Anúncios (Meta Ads)' }]}
      />
      <TabPanel idBase="campanhas-abas" value="disparos" active={aba === 'disparos'}>
        <ListaDisparos />
      </TabPanel>
      <TabPanel idBase="campanhas-abas" value="anuncios" active={aba === 'anuncios'}>
        <AnunciosReais />
      </TabPanel>
    </div>
  );
}

function AnunciosReais() {
  const [ov, setOv] = useState<AdsOverview | null>(null);
  const [camps, setCamps] = useState<AdsCampaign[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    Promise.all([ads.overview(), ads.campaigns()])
      .then(([o, c]) => { setOv(o); setCamps(c); })
      .catch(() => { setOv(null); setCamps([]); })
      .finally(() => setCarregando(false));
  }, []);

  const temAds = camps.length > 0;
  const t = ov?.totals;

  return (
    <div className="space-y-4">
      {carregando && (
        <div className="card space-y-3 p-5" aria-busy="true">
          <div className="skeleton h-6 w-48 rounded-md" />
          <div className="skeleton h-24 w-full rounded-md" />
        </div>
      )}

      {!carregando && temAds && t && (
        <section className="card overflow-hidden p-0" aria-label="Campanhas de anúncios conectadas">
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
            <BrandLogo brand="meta_ads" size={22} />
            <div>
              <h2 className="text-[15px] font-semibold text-fg">Campanhas de anúncios</h2>
              <p className="text-xs text-muted">Meta Ads conectada · últimos 30 dias</p>
            </div>
            <Link href="/marketing/ads" className="btn btn-soft btn-sm ml-auto">
              Abrir análise completa
              <Icon name="arrowRight" size={14} />
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 px-5 py-4 lg:grid-cols-4">
            {[
              { l: 'Investido', v: brl(t.spend) },
              { l: 'Leads', v: numero(t.leads) },
              { l: 'CPL médio', v: t.leads > 0 ? brl(t.cpl) : '-' },
              { l: 'ROAS', v: `${t.roas.toFixed(2)}x` },
            ].map((k) => (
              <div key={k.l} className="card-inset p-3.5">
                <p className="text-xs text-muted">{k.l}</p>
                <p className="mt-1 text-xl font-semibold tabular text-fg">{k.v}</p>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto scrollbar-thin">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-y border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="px-5 py-2.5 font-semibold">Campanha</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Invest.</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Leads</th>
                  <th className="px-5 py-2.5 text-right font-semibold">ROAS</th>
                </tr>
              </thead>
              <tbody>
                {camps.slice(0, 8).map((c) => (
                  <tr key={c.id} className="border-b border-line last:border-0 hover:bg-surface2">
                    <td className="px-5 py-2.5">
                      <p className="font-medium text-fg">{c.nome}</p>
                      <p className="text-[11px] text-muted">{c.objetivo ?? '-'}</p>
                    </td>
                    <td className="px-3 py-2.5 text-muted">{c.status}</td>
                    <td className="px-3 py-2.5 text-right tabular text-fg">{brl(c.spend)}</td>
                    <td className="px-3 py-2.5 text-right tabular text-fg">{c.leads}</td>
                    <td className="px-5 py-2.5 text-right font-semibold tabular text-brand">{c.roas.toFixed(2)}x</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!carregando && !temAds && (
        <div className="card">
          <EmptyState
            icon="marketing"
            title="Nenhuma campanha de anúncios conectada"
            description="Conecte a Meta Ads para ver investimento, leads e ROAS das campanhas aqui. Disparos de WhatsApp e e-mail ficam na aba Disparos."
            action={
              <Link href="/configuracoes?tab=integracoes" className="btn btn-primary btn-sm">
                <Icon name="link" size={15} />
                Conectar Meta Ads
              </Link>
            }
          />
        </div>
      )}
    </div>
  );
}


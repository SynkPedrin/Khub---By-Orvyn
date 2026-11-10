'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { analytics, type AiUsage, type AutomacoesStats } from '@/lib/analytics';
import { crm, type Overview } from '@/lib/crm';
import { dolar, moeda, numero, percentual } from '@/lib/format';
import { exportarCsv } from '@/lib/export-csv';
import { Icon } from '@/components/icons';
import { KpiGrid, Section } from './Page';
import { KpiCard } from './Kpi';
import { AreaReceita, BarrasHorizontais } from './charts';

const STATUS: Record<string, string> = { concluido: 'Concluídas', falha: 'Falhas', erro: 'Erros', rodando: 'Em execução', aguardando: 'Aguardando', cancelado: 'Canceladas' };
type Painel = { crm: Overview | null; ai: AiUsage | null; auto: AutomacoesStats | null; falhas: string[]; atualizado: Date };

/** Cada fonte falha de forma independente. Período de IA não altera o estoque do CRM. */
export function AnalyticsReal() {
  const [dias, setDias] = useState(30);
  const [tentativa, setTentativa] = useState(0);
  const [dados, setDados] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setDados(null);
    Promise.allSettled([crm.overview(), analytics.aiUsage(dias), analytics.automacoes(dias)]).then(([c, a, w]) => {
      if (!vivo) return;
      setDados({
        crm: c.status === 'fulfilled' ? c.value : null,
        ai: a.status === 'fulfilled' ? a.value : null,
        auto: w.status === 'fulfilled' ? w.value : null,
        falhas: [c.status === 'rejected' ? 'CRM' : '', a.status === 'rejected' ? 'Uso de IA' : '', w.status === 'rejected' ? 'Automações' : ''].filter(Boolean),
        atualizado: new Date(),
      });
      setCarregando(false);
    });
    return () => { vivo = false; };
  }, [dias, tentativa]);

  const c = dados?.crm;
  const a = dados?.ai;
  const w = dados?.auto;
  const fechado = c?.kpis.conversaoBase === 'fechados';
  const taxaErro = a && a.execucoes > 0 ? a.erros / a.execucoes : null;
  const receita = c?.receitaMensal ?? [];
  const totalReceita = receita.reduce((t, m) => t + m.valor, 0);
  const etapaMaior = c?.funil.reduce<Overview['funil'][number] | null>((maior, e) => !maior || e.valor > maior.valor ? e : maior, null);
  const concentracao = c && c.kpis.valorFunil > 0 && etapaMaior ? etapaMaior.valor / c.kpis.valorFunil : null;
  const exportar = () => exportarCsv(`khub-indicadores-${dias}d.csv`, [
    ['Indicador', 'Valor', 'Unidade', 'Escopo', 'Consultado em'],
    ...[
      ['Contatos', c?.kpis.contatos, 'quantidade', 'CRM atual'],
      ['Negócios abertos', c?.kpis.negocios, 'quantidade', c?.funilNome ?? 'Funil principal'],
      ['Valor em aberto', c?.kpis.valorFunil, 'BRL', 'Funil principal atual'],
      ['Conversão de fechados', fechado ? c?.kpis.conversao : null, '%', 'Histórico do funil principal'],
      ['Receita fechada', c ? totalReceita : null, 'BRL', 'Últimos 6 meses'],
      ['Custo de IA', a?.custoUsd, 'USD', `Últimos ${dias} dias`],
      ['Execuções de IA', a?.execucoes, 'quantidade', `Últimos ${dias} dias`],
      ['Erros de IA', a?.erros, 'quantidade', `Últimos ${dias} dias`],
      ['Sucesso de automações', w?.taxaSucesso, '%', `Finalizadas nos últimos ${dias} dias`],
      ['Fila de falhas', w?.naDlq, 'quantidade', 'Estoque atual'],
    ].map((r) => [...r.map((v) => v ?? 'Indisponível'), dados?.atualizado.toISOString() ?? '']),
  ]);

  return (
    <div aria-busy={carregando} className="space-y-5">
      <div className="analytics-toolbar">
        <div>
          <p className="text-[13px] font-semibold text-fg">Visão da operação</p>
          <p className="text-xs text-muted" role="status">{carregando ? 'Consultando indicadores…' : `Consultado às ${dados?.atualizado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Atualize para buscar novos dados.`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-xs text-muted">IA e automações
            <select aria-label="Período de IA e automações" className="select !w-auto !min-h-9" value={dias} onChange={(e) => setDias(Number(e.target.value))}>
              <option value={7}>7 dias</option><option value={30}>30 dias</option><option value={90}>90 dias</option>
            </select>
          </label>
          <button className="btn btn-sm" disabled={carregando} onClick={() => setTentativa((n) => n + 1)}><Icon name="refresh" size={14} />Atualizar</button>
          <button className="btn btn-sm" disabled={carregando || !dados || dados.falhas.length === 3} onClick={exportar}><Icon name="download" size={14} />Exportar CSV</button>
        </div>
      </div>

      {!!dados?.falhas.length && <div role="alert" className="rounded-xl border border-warning-border bg-warning-soft p-4 text-sm text-fg">
        <strong>Dados indisponíveis: {dados.falhas.join(', ')}.</strong> Os demais indicadores continuam disponíveis. Use Atualizar para tentar novamente.
      </div>}
      {carregando ? <KpiGrid>{[0, 1, 2, 3].map((i) => <KpiCard key={i} loading label="" value="" icon="chart" />)}</KpiGrid> : <>
        <div><h2 className="t-section">Resultado comercial</h2><p className="mt-1 text-xs text-muted">Estoque atual do CRM{c?.funilNome ? ` · ${c.funilNome}` : ''}. Os totais comerciais não são filtrados pelo período de IA.</p></div>
        <KpiGrid>
          <KpiCard label="Contatos" value={numero(c?.kpis.contatos)} icon="users" comparacao="Base atual de contatos" />
          <KpiCard label="Pipeline aberto" value={moeda(c?.kpis.valorFunil)} icon="briefcase" comparacao={c ? `${numero(c.kpis.negocios)} negócios abertos` : 'Fonte indisponível'} />
          <KpiCard label="Receita fechada · 6 meses" value={c ? moeda(totalReceita) : '-'} icon="dollar" tom="success" comparacao="Negócios ganhos registrados no CRM" />
          <KpiCard label="Conversão de fechados" value={fechado ? percentual(c?.kpis.conversao, 1, true) : '-'} icon="target" comparacao={fechado ? 'Ganhos ÷ (ganhos + perdidos)' : 'Sem fechamentos para calcular'} />
        </KpiGrid>
        {c && <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Section title="Receita ao longo do tempo" info="Negócios ganhos por mês, últimos 6 meses. Não representa recebimentos em caixa." action={<Link href="/pipeline" className="btn btn-ghost btn-sm">Ver negócios<Icon name="arrowRight" size={14} /></Link>}>
            {receita.some((m) => m.valor > 0) ? <div className="pt-5"><AreaReceita dados={receita.map((m) => ({ rotulo: new Date(`${m.mes}-15T12:00:00`).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }), valor: m.valor }))} /></div> : <p className="py-12 text-center text-sm text-muted">Nenhuma receita fechada registrada nos últimos 6 meses.</p>}
          </Section>
          <Section title="Distribuição do pipeline" info="Negócios abertos por etapa. Esta distribuição não mede a conversão entre etapas.">
            <BarrasHorizontais dados={c.funil.map((f) => ({ rotulo: f.nome, valor: f.total }))} formatar={numero} />
            <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
              <div><p className="text-xs text-muted">Valor médio em aberto</p><p className="mt-1 text-lg font-semibold tabular">{c.kpis.negocios ? moeda(c.kpis.valorFunil / c.kpis.negocios) : '-'}</p></div>
              <div><p className="text-xs text-muted">Maior concentração de valor</p><p className="mt-1 text-lg font-semibold tabular">{percentual(concentracao, 1)}</p><p className="text-xs text-muted">{concentracao !== null ? etapaMaior?.nome : 'Sem valor em aberto'}</p></div>
            </div>
          </Section>
        </div>}
        <div><h2 className="t-section">Confiabilidade da operação</h2><p className="mt-1 text-xs text-muted">Últimos {dias} dias. Custos do provedor em USD, sem conversão para reais.</p></div>
        <KpiGrid>
          <KpiCard label="Custo de IA · USD" compacto value={dolar(a?.custoUsd)} icon="ai" comparacao={a ? `${numero(a.execucoes)} execuções · ${numero(a.tokens)} tokens` : 'Fonte indisponível'} />
          <KpiCard label="Taxa de erros de IA" compacto value={percentual(taxaErro, 1)} icon="alert" tom={a?.erros ? 'warning' : 'neutral'} comparacao={a ? `${numero(a.erros)} erros / ${numero(a.execucoes)} execuções` : 'Fonte indisponível'} />
          <KpiCard label="Sucesso das automações" compacto value={percentual(w?.taxaSucesso, 1, true)} icon="zap" tom={w?.falhas ? 'warning' : 'neutral'} comparacao={w ? `${numero(w.concluidos)} concluídas / ${numero(w.concluidos + w.falhas)} finalizadas` : 'Fonte indisponível'} />
          <KpiCard label="Fila de falhas atual" compacto value={numero(w?.naDlq)} icon="clock" tom={w?.naDlq ? 'warning' : 'neutral'} comparacao="Pendências atuais, independente do período" />
        </KpiGrid>
        <div className="grid gap-5 lg:grid-cols-2">
          <Section title="Custo por agente NICO" info={`Consumo registrado em USD nos últimos ${dias} dias.`}>
            {a?.porAgente.length ? <BarrasHorizontais dados={a.porAgente.map((i) => ({ rotulo: i.agente, valor: i.custo }))} formatar={dolar} /> : <p className="py-6 text-sm text-muted">{a ? 'Nenhuma execução registrada no período.' : 'Indicadores de IA indisponíveis.'}</p>}
          </Section>
          <Section title="Execuções de automação" info={`Status das execuções iniciadas nos últimos ${dias} dias.`} action={<Link className="btn btn-ghost btn-sm" href="/automacoes">Ver automações</Link>}>
            {w?.total ? <BarrasHorizontais dados={Object.entries(w.porStatus).map(([s, valor]) => ({ rotulo: STATUS[s] ?? s, valor }))} formatar={numero} /> : <p className="py-6 text-sm text-muted">{w ? 'Nenhuma execução registrada no período.' : 'Indicadores de automação indisponíveis.'}</p>}
          </Section>
        </div>
        <Section title="Pontos de atenção" info="Diagnóstico por regras verificáveis dos indicadores acima. Não é uma previsão de IA.">
          <ul className="space-y-3 text-sm">
            {!!w?.naDlq && <li><Link href="/automacoes" className="font-medium text-brand hover:underline">Revisar {numero(w.naDlq)} execuções na fila de falhas</Link><p className="text-muted">Uma execução pendente pode interromper o atendimento ou a atualização do CRM.</p></li>}
            {!!a?.erros && <li><Link href="/agentes" className="font-medium text-brand hover:underline">Investigar erros e entregas dos agentes</Link><p className="text-muted">A taxa de execução mede disponibilidade. A qualidade da resposta exige avaliação dos cenários e das fontes.</p></li>}
            {concentracao !== null && concentracao >= 0.5 && <li><Link href="/pipeline" className="font-medium text-brand hover:underline">Revisar a etapa {etapaMaior?.nome}</Link><p className="text-muted">{percentual(concentracao, 1)} do valor aberto está nesta etapa. Confira responsáveis e próximas ações; concentração por si só não comprova um gargalo.</p></li>}
            {!fechado && c && <li className="text-muted">Registre negócios ganhos e perdidos para calcular a conversão. Chegar à última etapa ainda não comprova uma venda.</li>}
            <li><Link href="/agentes" className="font-medium text-brand hover:underline">Validar a qualidade do atendimento</Link><p className="text-muted">Revise a versão publicada, os cenários de teste, as fontes e as transferências para a equipe antes de ampliar o atendimento automático.</p></li>
          </ul>
        </Section>
        <details className="card p-5 text-sm"><summary className="cursor-pointer font-semibold">Como interpretar estes dados</summary><div className="mt-3 space-y-2 text-muted"><p>Receita usa os negócios marcados como ganhos no CRM e a data disponível no registro. Edições posteriores podem alterar o mês atribuído; não substitui conciliação financeira.</p><p>Conversão usa o histórico de fechamentos do funil principal, não uma coorte de leads. Valor em aberto não é receita garantida.</p><p>O uso de NICO e o atendimento dos agentes têm registros próprios. Consulte Agentes de IA para latência, entregas e qualidade por versão. Ausência de erro técnico não comprova uma resposta correta.</p><p>CAC, retorno por canal e previsões exigem custos e atribuição validados. Não são estimados a partir do saldo do pipeline.</p></div></details>
      </>}
    </div>
  );
}

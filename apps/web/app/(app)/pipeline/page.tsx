'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import { PageShell, PageHeader, KpiGrid } from '@/components/revenue/Page';
import { KpiCard } from '@/components/revenue/Kpi';
import { SeloDemo } from '@/components/revenue/SeloDemo';
import { Quando } from '@/components/revenue/Quando';
import { EmptyState } from '@/components/revenue/States';
import { dataCurta, moeda, numero, percentual } from '@/lib/format';
import { modoDemo } from '@/lib/demo/flag';
import { crm } from '@/lib/crm';
import {
  contarFiltros, ehEtapaDePerda, faixaInvalida, filtrosDaUrl, gravarVisao, lerVisao, mensagemDeErro, paraQuery, pipelineApi,
  type FiltrosPipeline, type NegocioQuadro, type Quadro as QuadroPipeline,
} from '@/lib/pipeline';
import { PipelineFiltros, type Dono } from '@/components/crm/PipelineFiltros';
import { PipelineLista } from '@/components/crm/PipelineLista';
import { MotivoPerdaModal } from '@/components/crm/MotivoPerdaModal';
import { NEGOCIO_DETALHE, NEGOCIO_PROXIMOS_PASSOS, PIPELINE_ETAPAS, PIPELINE_KPIS } from '@/lib/demo/dataset';
import type { CardNegocio, EtapaPipeline } from '@/lib/revenue/types';
import { DealDrawer } from '@/components/app/DealDrawer';
import { NovaOportunidadeModal } from '@/components/crm/NovaOportunidadeModal';
import { Menu, Skeleton, useToast, type MenuEntry } from '@/components/kit';

/**
 * PIPELINE — Kanban de oportunidades.
 *
 * Arrastar entre colunas é a interação central. Implementado com HTML5 Drag
 * and Drop nativo (sem biblioteca): são cartões simples em colunas, e uma
 * dependência de DnD custaria mais do que resolve.
 *
 * Acessibilidade: arrastar não pode ser o ÚNICO caminho. Cada cartão tem o
 * menu "Mover para", que faz a mesma mudança de etapa pelo teclado.
 */
export default function PipelinePage() {
  const demo = modoDemo();
  // Levantado para o botão do cabeçalho; o modal vive em `PipelineReal`,
  // que conhece as etapas reais e recarrega o quadro depois de criar.
  const [novaAberta, setNovaAberta] = useState(false);

  return (
    <PageShell>
      <PageHeader
        title="Pipeline de Vendas"
        subtitle="Visualize e gerencie todas as suas oportunidades em um só lugar."
        quote={'"Mais pipeline. Mais previsibilidade.\nMais receita."'}
        actions={
          <>
            <SeloDemo />
            {!demo && (
              <button type="button" className="btn btn-primary" onClick={() => setNovaAberta(true)}>
                <Icon name="plus" size={16} />
                Nova oportunidade
              </button>
            )}
          </>
        }
      />

      {demo ? (
        <Quadro />
      ) : (
        <PipelineReal novaAberta={novaAberta} onAbrirNova={() => setNovaAberta(true)} onFecharNova={() => setNovaAberta(false)} />
      )}
    </PageShell>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Pipeline REAL. Achado na auditoria: esta tela nunca teve caminho de dado
 * real; `crm.pipeline()`/`crm.moveDeal()` existiam e não eram chamados daqui.
 *
 * Q2.1: filtros na URL (busca, dono, origem, tag do contato, valor, status,
 * criado em), totais do topo sobre o filtrado, visão Lista com ações em massa
 * e motivo de perda obrigatório (menu do card, soltar em etapa de perda, drawer).
 * Card real mostra só o que `Deal` tem: menos e honesto vale mais que dado inventado.
 */
function PipelineReal({
  novaAberta,
  onAbrirNova,
  onFecharNova,
}: {
  novaAberta: boolean;
  onAbrirNova: () => void;
  onFecharNova: () => void;
}) {
  const toast = useToast();
  const [dados, setDados] = useState<QuadroPipeline | null>(null);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  // Card que deve receber o foco depois de mover pelo teclado (ele remonta na coluna nova).
  const [focar, setFocar] = useState<string | null>(null);
  const [filtros, setFiltros] = useState<FiltrosPipeline | null>(null);
  const [visao, setVisao] = useState<'kanban' | 'lista'>('kanban');
  const [donos, setDonos] = useState<Dono[]>([]);
  // Negócio a marcar como perdido (pelo menu ou ao soltar numa etapa de perda).
  const [perda, setPerda] = useState<{ id: string; titulo: string; stageId?: string } | null>(null);

  // Funil exibido: vazio = o principal escolhido pela API (o com mais abertos).
  const [funilId, setFunilId] = useState<string | undefined>(undefined);
  const estado = useRef<{ funil?: string; filtros: FiltrosPipeline }>({ filtros: {} });
  estado.current = { funil: funilId, filtros: filtros ?? {} };

  // Estado inicial vem da URL: `?deal=<id>` abre o negócio; filtros e funil são compartilháveis.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const deal = sp.get('deal');
    if (deal) setAbertoId(deal);
    const pid = sp.get('pipelineId');
    if (pid && /^[0-9a-f-]{36}$/i.test(pid)) setFunilId(pid);
    setFiltros(filtrosDaUrl(sp));
    setVisao(lerVisao());
    crm.atendentes().then((a) => setDonos(a.map((x) => ({ identityId: x.identityId, nome: x.nome })))).catch(() => setDonos([]));
  }, []);

  // URL acompanha filtros, funil e negócio aberto (replaceState: não polui o histórico).
  useEffect(() => {
    if (!filtros) return;
    const qs = paraQuery(filtros);
    if (funilId) qs.set('pipelineId', funilId);
    if (abertoId) qs.set('deal', abertoId);
    const s = qs.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${s ? `?${s}` : ''}`);
  }, [filtros, funilId, abertoId]);

  const buscar = useCallback(() => pipelineApi.quadro(estado.current.funil, estado.current.filtros), []);

  const carregar = useCallback(() => {
    setErro(false);
    setAtualizando(true);
    buscar()
      .then(setDados)
      .catch(() => setErro(true))
      .finally(() => { setCarregando(false); setAtualizando(false); });
  }, [buscar]);

  useEffect(() => {
    if (!filtros || faixaInvalida(filtros)) return;
    carregar();
  }, [carregar, funilId, filtros]);

  /**
   * Recarga sem esqueleto: depois de editar no drawer, criar ou agir em massa,
   * para o quadro não piscar e o drawer aberto não desmontar.
   */
  const recarregar = useCallback(() => {
    buscar()
      .then((d) => { setDados(d); setErro(false); })
      .catch(() => toast.error('Não foi possível atualizar o quadro.', { description: 'Recarregue a página.' }));
  }, [buscar, toast]);

  const etapas = useMemo(() => (dados?.stages ?? []).map((s) => ({ id: s.id, nome: s.nome, cor: s.cor })), [dados]);
  const fecharDrawer = useCallback(() => setAbertoId(null), []);
  const trocarVisao = (v: 'kanban' | 'lista') => { setVisao(v); gravarVisao(v); };

  useEffect(() => {
    if (!focar) return;
    document.querySelector<HTMLElement>(`[data-deal-foco="${CSS.escape(focar)}"]`)?.focus();
    setFocar(null);
  }, [focar, dados]);

  const marcarGanho = useCallback(async (id: string) => {
    try {
      await crm.updateDeal(id, { status: 'ganho' });
      toast.success('Negócio marcado como ganho.');
      recarregar();
    } catch (e) {
      toast.error('Não foi possível marcar como ganho.', { description: mensagemDeErro(e) });
    }
  }, [recarregar, toast]);

  const mover = useCallback(
    async (dealId: string, destinoId: string, opts: { focar?: boolean } = {}) => {
      const destino = dados?.stages.find((s) => s.id === destinoId);
      const origem = dados?.stages.find((s) => s.deals.some((d) => d.id === dealId));
      const negocio = origem?.deals.find((d) => d.id === dealId);
      if (!destino || !origem || !negocio || origem.id === destinoId) return;
      // Soltar numa etapa de perda é marcar como perdido: pede o motivo antes de mover.
      if (ehEtapaDePerda(destino.nome) && negocio.status !== 'perdido') {
        setPerda({ id: dealId, titulo: negocio.titulo, stageId: destinoId });
        return;
      }
      setDados((atual) => {
        if (!atual) return atual;
        return {
          ...atual,
          stages: atual.stages.map((s) => {
            if (s.id === origem.id) return { ...s, deals: s.deals.filter((d) => d.id !== dealId) };
            if (s.id === destinoId) return { ...s, deals: [{ ...negocio, stageId: destinoId }, ...s.deals] };
            return s;
          }),
        };
      });
      if (opts.focar) setFocar(dealId);
      try {
        await crm.moveDeal(dealId, destinoId);
        toast.success(`Movido para ${destino.nome}.`);
      } catch {
        // Rollback: falhou no servidor, o card volta pra onde estava. Nunca mente sobre o estado real.
        toast.error('Não foi possível mover.', { description: 'O negócio voltou para a etapa anterior. Tente novamente.' });
        carregar();
      }
    },
    [carregar, dados, toast],
  );

  const sobreposicoes = (
    <>
      {abertoId && <DealDrawer dealId={abertoId} stages={etapas} onClose={fecharDrawer} onChanged={recarregar} />}
      {novaAberta && (
        <NovaOportunidadeModal
          stages={etapas}
          onClose={onFecharNova}
          onCreated={() => {
            onFecharNova();
            toast.success('Oportunidade criada.');
            recarregar();
          }}
        />
      )}
      <MotivoPerdaModal
        open={!!perda}
        alvo={perda ? `"${perda.titulo}"` : ''}
        onClose={() => setPerda(null)}
        onConfirm={async (d) => {
          if (!perda) return;
          await crm.updateDeal(perda.id, { status: 'perdido', ...(perda.stageId ? { stageId: perda.stageId } : {}), motivoPerdaId: d.motivoPerdaId, motivoPerdaObs: d.motivoPerdaObs });
          toast.success('Negócio marcado como perdido.');
          setPerda(null);
          recarregar();
        }}
      />
    </>
  );

  if (carregando || !filtros) return <QuadroEsqueleto />;

  if (erro && !dados) {
    return (
      <div className="card">
        <EmptyState
          icon="alert"
          title="Não foi possível carregar o pipeline"
          description="Tente novamente em instantes."
          action={
            <button type="button" className="btn btn-primary btn-sm" onClick={carregar}>
              <Icon name="refresh" size={15} />
              Tentar de novo
            </button>
          }
        />
      </div>
    );
  }

  const filtrando = contarFiltros(filtros) > 0;
  const totalDeals = dados?.totais.negocios ?? 0;
  // Sem funil/etapa, ou funil vazio sem filtro nenhum: convite para começar.
  if (!dados || dados.stages.length === 0 || (totalDeals === 0 && !filtrando)) {
    return (
      <>
        <PipelineVazio onNova={onAbrirNova} />
        {sobreposicoes}
      </>
    );
  }

  const t = dados.totais;
  const status = filtros.status ?? 'abertos';
  const rotuloValor = { abertos: 'Valor em pipeline', ganhos: 'Valor ganho', perdidos: 'Valor perdido', todos: 'Valor total' }[status];
  const ticketMedio = t.negocios > 0 ? t.valor / t.negocios : 0;
  const funis = dados.pipelines ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Mais de um funil: troca o quadro em vez de misturar etapas. */}
        {funis.length > 1 && (
          <>
            <label htmlFor="funil" className="text-sm font-medium text-muted">
              Funil
            </label>
            <select id="funil" className="select w-auto min-w-[220px]" value={dados.pipelineId ?? ''} onChange={(e) => setFunilId(e.target.value)}>
              {funis.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome} ({f.abertos} {f.abertos === 1 ? 'aberto' : 'abertos'})
                </option>
              ))}
            </select>
          </>
        )}
        <Link href="/funis" className="ml-auto inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <Icon name="settings" size={14} />
          Configurar funis e etapas
        </Link>
      </div>

      <KpiGrid>
        <KpiCard label={rotuloValor} value={moeda(t.valor)} icon="dollar" />
        <KpiCard label="Oportunidades" value={numero(t.negocios)} icon="briefcase" />
        <KpiCard label="Ticket médio" value={moeda(ticketMedio)} icon="tag" />
        {status === 'todos' ? (
          <KpiCard label="Ganhos e perdidos" value={`${numero(t.ganhos)} / ${numero(t.perdidos)}`} icon="trophy" />
        ) : (
          <KpiCard label="Etapas" value={numero(dados.stages.length)} icon="grid" />
        )}
      </KpiGrid>

      <PipelineFiltros filtros={filtros} onChange={setFiltros} origens={dados.opcoes.origens} tags={dados.opcoes.tags} donos={donos} visao={visao} onVisao={trocarVisao} />

      {dados.truncado && (
        <p role="status" className="mb-3 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-sm text-fg">
          Mostrando os {numero(totalDeals)} negócios mais recentes. Use os filtros para ver o restante.
        </p>
      )}

      <div className={cx('transition-opacity', atualizando && 'opacity-60')} aria-busy={atualizando}>
        {totalDeals === 0 ? (
          <div className="card">
            <EmptyState
              icon="filter"
              title="Nenhum negócio com esses filtros"
              description="Ajuste ou limpe os filtros para ver mais oportunidades."
              action={<button type="button" className="btn btn-sm" onClick={() => setFiltros({})}>Limpar filtros</button>}
            />
          </div>
        ) : visao === 'lista' ? (
          <PipelineLista quadro={dados} donos={donos} etapas={etapas} onAbrir={setAbertoId} onAlterado={recarregar} />
        ) : (
          <>
            <p id="dica-mover" className="sr-only">
              Enter abre o negócio. Shift com seta para a direita ou para a esquerda move para a etapa vizinha.
            </p>
            {/* Colunas dividem a largura disponível (mín. 272px); a rolagem horizontal só aparece quando falta espaço. */}
            <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin">
              {dados.stages.map((stage, si) => {
                const totalEtapa = stage.deals.reduce((a, d) => a + d.valor, 0);
                const etapaPerda = ehEtapaDePerda(stage.nome);
                return (
                  <section
                    key={stage.id}
                    aria-label={`${stage.nome}: ${stage.deals.length} ${stage.deals.length === 1 ? 'oportunidade' : 'oportunidades'}, ${moeda(totalEtapa)}`}
                    className={cx(
                      'flex min-w-[272px] flex-1 basis-0 flex-col rounded-xl border bg-surface2 p-2.5 transition-colors',
                      alvo === stage.id ? (etapaPerda ? 'border-danger bg-danger-soft' : 'border-brand bg-brand-softer') : 'border-line',
                    )}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setAlvo(stage.id);
                    }}
                    onDragLeave={() => setAlvo((a) => (a === stage.id ? null : a))}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (arrastando) void mover(arrastando, stage.id);
                      setArrastando(null);
                      setAlvo(null);
                    }}
                  >
                    <header className="mb-2.5 flex items-center justify-between gap-2 px-1.5 pt-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: stage.cor }} aria-hidden />
                        <h3 className="truncate text-sm font-semibold text-fg">{stage.nome}</h3>
                        <span className="pill h-5 shrink-0 px-1.5 text-2xs tabular" aria-hidden>
                          {stage.deals.length}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs font-medium tabular text-muted" aria-hidden>
                        {moeda(totalEtapa)}
                      </span>
                    </header>
                    <ul className="flex-1 space-y-2">
                      {stage.deals.map((deal) => (
                        <li key={deal.id}>
                          <CardNegocioReal
                            deal={deal}
                            etapaAtual={stage.id}
                            etapas={etapas}
                            onAbrir={() => setAbertoId(deal.id)}
                            onMover={(destino, viaTeclado) => void mover(deal.id, destino, { focar: viaTeclado })}
                            onGanho={() => void marcarGanho(deal.id)}
                            onPerdido={() => setPerda({ id: deal.id, titulo: deal.titulo })}
                            anterior={dados.stages[si - 1]?.id}
                            proxima={dados.stages[si + 1]?.id}
                            onArrastarInicio={() => setArrastando(deal.id)}
                            onArrastarFim={() => {
                              setArrastando(null);
                              setAlvo(null);
                            }}
                          />
                        </li>
                      ))}
                      {stage.deals.length === 0 && (
                        <li className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
                          {etapaPerda ? 'Solte aqui para marcar como perdido' : 'Arraste um negócio para cá'}
                        </li>
                      )}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      {sobreposicoes}
    </>
  );
}

/**
 * Card do Kanban real. O título é o botão (foco, Enter abre, Shift+setas
 * movem); o menu tem "Mover para" (equivalente ao arrastar) e ganho/perdido.
 */
function CardNegocioReal({
  deal,
  etapaAtual,
  etapas,
  anterior,
  proxima,
  onAbrir,
  onMover,
  onGanho,
  onPerdido,
  onArrastarInicio,
  onArrastarFim,
}: {
  deal: NegocioQuadro;
  etapaAtual: string;
  etapas: { id: string; nome: string; cor: string }[];
  anterior?: string;
  proxima?: string;
  onAbrir: () => void;
  onMover: (destinoId: string, viaTeclado: boolean) => void;
  onGanho: () => void;
  onPerdido: () => void;
  onArrastarInicio: () => void;
  onArrastarFim: () => void;
}) {
  const itens: MenuEntry[] = [
    { type: 'label', id: 'rotulo', label: 'Mover para' },
    ...etapas
      .filter((e) => e.id !== etapaAtual)
      .map((e) => ({ id: e.id, label: e.nome, color: e.cor, onSelect: () => onMover(e.id, true) })),
    { type: 'separator', id: 'sep' },
    ...(deal.status !== 'ganho' ? [{ id: 'ganho', label: 'Marcar como ganho', icon: 'trophy' as const, onSelect: onGanho }] : []),
    ...(deal.status !== 'perdido' ? [{ id: 'perdido', label: 'Marcar como perdido', icon: 'minus' as const, danger: true, onSelect: onPerdido }] : []),
  ];
  return (
    <article
      draggable
      onDragStart={onArrastarInicio}
      onDragEnd={onArrastarFim}
      // Arrastar (HTML5 DnD) não dispara click: o clique simples abre o detalhe.
      onClick={onAbrir}
      className="group cursor-pointer rounded-lg border border-line bg-surface p-3 shadow-xs transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-sm focus-within:border-brand active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          data-deal-foco={deal.id}
          aria-describedby="dica-mover"
          aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight"
          className="min-w-0 flex-1 rounded-sm text-left outline-none focus-visible:underline"
          onClick={(e) => {
            e.stopPropagation();
            onAbrir();
          }}
          onKeyDown={(e) => {
            if (!e.shiftKey) return;
            if (e.key === 'ArrowRight' && proxima) {
              e.preventDefault();
              onMover(proxima, true);
            } else if (e.key === 'ArrowLeft' && anterior) {
              e.preventDefault();
              onMover(anterior, true);
            }
          }}
        >
          <span className="block truncate text-sm font-semibold text-fg">{deal.titulo}</span>
          {deal.contato && deal.contato !== '-' && <span className="mt-0.5 block truncate text-xs text-muted">{deal.contato}</span>}
        </button>
        <Menu
          label={`Ações de ${deal.titulo}`}
          trigger={<Icon name="dots" size={15} />}
          items={itens}
          triggerClassName="-mr-1 -mt-1 h-7 w-7 opacity-70 group-hover:opacity-100"
        />
      </div>
      <div className="mt-2.5 flex min-w-0 items-center justify-between gap-2">
        <span className="shrink-0 text-sm font-semibold tabular text-fg">{moeda(deal.valor)}</span>
        {deal.status === 'ganho' ? (
          <span className="pill pill-success h-5 px-2 text-2xs">Ganho</span>
        ) : deal.status === 'perdido' ? (
          <span className="pill pill-danger h-5 min-w-0 max-w-[60%] px-2 text-2xs" title={deal.motivoPerda ?? undefined}>
            <span className="truncate">{deal.motivoPerda ? `Perdido: ${deal.motivoPerda}` : 'Perdido'}</span>
          </span>
        ) : (
          deal.origem && (
            <span className="pill h-5 min-w-0 max-w-[60%] px-2 text-2xs" title={deal.origem}>
              <span className="truncate">{deal.origem}</span>
            </span>
          )
        )}
      </div>
    </article>
  );
}

function QuadroEsqueleto() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Carregando pipeline
      </span>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[86px] rounded-xl" />
        ))}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-thin">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="min-w-[240px] flex-1 basis-0 rounded-xl border border-line bg-surface2 p-2.5 sm:min-w-[272px]">
            <Skeleton className="mx-1.5 mt-1 h-4 w-28 rounded-sm" />
            <div className="mt-3 space-y-2">
              <Skeleton className="h-[76px] rounded-lg" />
              {i % 2 === 0 && <Skeleton className="h-[76px] rounded-lg" />}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Quadro() {
  const [etapas, setEtapas] = useState<EtapaPipeline[]>(PIPELINE_ETAPAS);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [alvo, setAlvo] = useState<string | null>(null);
  const [selecionado, setSelecionado] = useState<string | null>('d8');
  const [visao, setVisao] = useState<'kanban' | 'lista'>('kanban');
  const [historico, setHistorico] = useState<string[]>([]);

  const negocioSelecionado = useMemo(() => {
    for (const e of etapas) {
      const n = e.negocios.find((x) => x.id === selecionado);
      if (n) return { negocio: n, etapa: e };
    }
    return null;
  }, [etapas, selecionado]);

  /**
   * Move um negócio de etapa.
   *
   * Registra a mudança no histórico — toda alteração relevante de pipeline
   * precisa virar evento auditável. Aqui o histórico é local; com backend,
   * este é o ponto que dispara `activity` + `audit_log`.
   */
  const mover = useCallback((negocioId: string, destinoId: string) => {
    setEtapas((atual) => {
      const origem = atual.find((e) => e.negocios.some((n) => n.id === negocioId));
      if (!origem || origem.id === destinoId) return atual;

      const negocio = origem.negocios.find((n) => n.id === negocioId)!;
      const destino = atual.find((e) => e.id === destinoId);
      if (!destino) return atual;

      setHistorico((h) => [`${negocio.empresa}: ${origem.nome} → ${destino.nome}`, ...h].slice(0, 5));

      return atual.map((e) => {
        if (e.id === origem.id) {
          return { ...e, negocios: e.negocios.filter((n) => n.id !== negocioId), valor: e.valor - negocio.valor };
        }
        if (e.id === destinoId) {
          return { ...e, negocios: [negocio, ...e.negocios], valor: e.valor + negocio.valor };
        }
        return e;
      });
    });
  }, []);

  return (
    <>
      <KpiGrid>
        <KpiCard label="Valor em Pipeline" value={moeda(PIPELINE_KPIS.valorPipeline.valor)} icon="dollar" delta={PIPELINE_KPIS.valorPipeline.delta} comparacao="vs. mês passado" />
        <KpiCard label="Taxa de Conversão" value={percentual(PIPELINE_KPIS.taxaConversao.valor, 0, true)} icon="chart" delta={PIPELINE_KPIS.taxaConversao.delta} comparacao="vs. mês passado" />
        <KpiCard label="Ticket Médio" value={moeda(PIPELINE_KPIS.ticketMedio.valor)} icon="tag" delta={PIPELINE_KPIS.ticketMedio.delta} comparacao="vs. mês passado" />
        <KpiCard
          label="Ciclo Médio de Vendas"
          value={`${PIPELINE_KPIS.cicloMedio.valor} dias`}
          icon="clock"
          delta={PIPELINE_KPIS.cicloMedio.delta}
          // Ciclo mais curto é melhor: queda vira seta verde.
          deltaBom={false}
          comparacao="vs. mês passado"
        />
      </KpiGrid>

      {/* Barra de controles */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" className="input pl-9" placeholder="Buscar oportunidades..." aria-label="Buscar oportunidades" />
        </div>
        <select className="select w-auto" aria-label="Filtrar por responsável">
          <option>Todos os owners</option>
        </select>
        <select className="select w-auto" aria-label="Filtrar por valor">
          <option>Todos os valores</option>
        </select>

        <div className="segbar" role="group" aria-label="Formato do pipeline">
          <button type="button" className="seg" aria-pressed={visao === 'kanban'} onClick={() => setVisao('kanban')}>
            <Icon name="grid" size={14} />
            Kanban
          </button>
          <button type="button" className="seg" aria-pressed={visao === 'lista'} onClick={() => setVisao('lista')}>
            <Icon name="list" size={14} />
            Lista
          </button>
        </div>

        <button type="button" className="btn btn-primary">
          <Icon name="plus" size={16} />
          Nova oportunidade
        </button>
      </div>

      {/* Aviso de mudança — feedback de que o movimento foi registrado */}
      {historico.length > 0 && (
        <p className="mb-3 flex items-center gap-2 text-[13px] text-muted" role="status" aria-live="polite">
          <Icon name="check2" size={15} className="text-success" />
          Etapa atualizada · {historico[0]}
        </p>
      )}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {visao === 'kanban' ? (
            <div className="scroll-fade-x flex gap-3 overflow-x-auto scrollbar-thin pb-3 pr-8">
              {etapas.map((etapa) => (
                <Coluna
                  key={etapa.id}
                  etapa={etapa}
                  ativa={alvo === etapa.id}
                  selecionado={selecionado}
                  onSelecionar={setSelecionado}
                  onArrastarInicio={setArrastando}
                  onArrastarFim={() => {
                    setArrastando(null);
                    setAlvo(null);
                  }}
                  onSobre={() => setAlvo(etapa.id)}
                  onSoltar={() => {
                    if (arrastando) mover(arrastando, etapa.id);
                    setArrastando(null);
                    setAlvo(null);
                  }}
                  etapasDisponiveis={etapas}
                  onMover={mover}
                />
              ))}
            </div>
          ) : (
            <ListaNegocios etapas={etapas} onSelecionar={setSelecionado} />
          )}
        </div>

        <aside className="min-w-0 2xl:sticky 2xl:top-4 2xl:self-start">
          {negocioSelecionado ? (
            <PainelNegocio onFechar={() => setSelecionado(null)} />
          ) : (
            <div className="card">
              <EmptyState icon="briefcase" title="Nenhuma oportunidade selecionada" description="Clique em um cartão para ver os detalhes." />
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

function Coluna({
  etapa,
  ativa,
  selecionado,
  onSelecionar,
  onArrastarInicio,
  onArrastarFim,
  onSobre,
  onSoltar,
  etapasDisponiveis,
  onMover,
}: {
  etapa: EtapaPipeline;
  ativa: boolean;
  selecionado: string | null;
  onSelecionar: (id: string) => void;
  onArrastarInicio: (id: string) => void;
  onArrastarFim: () => void;
  onSobre: () => void;
  onSoltar: () => void;
  etapasDisponiveis: EtapaPipeline[];
  onMover: (negocioId: string, destinoId: string) => void;
}) {
  return (
    <section
      className={cx(
        'flex w-[216px] shrink-0 flex-col rounded-xl border transition-colors',
        ativa ? 'border-brand bg-brand-softer' : 'border-line bg-surface2',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        onSobre();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onSoltar();
      }}
      aria-label={`Etapa ${etapa.nome}, ${etapa.negocios.length} oportunidades`}
    >
      {/* Faixa de cor identifica a etapa sem depender de leitura */}
      <div className="h-1 rounded-t-xl" style={{ background: etapa.cor }} aria-hidden />

      <header className="px-3.5 pb-3 pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="truncate text-[14px] font-bold text-fg">{etapa.nome}</h2>
          <span className="shrink-0 text-[11.5px] text-muted">{numero(etapa.totalLeads)} leads</span>
        </div>
        <p className="mt-1 text-[16px] font-bold tabular text-fg">{moeda(etapa.valor)}</p>
      </header>

      <div className="flex-1 space-y-2 px-2.5 pb-2.5">
        {etapa.negocios.map((n) => (
          <Cartao
            key={n.id}
            negocio={n}
            selecionado={selecionado === n.id}
            onSelecionar={() => onSelecionar(n.id)}
            onArrastarInicio={() => onArrastarInicio(n.id)}
            onArrastarFim={onArrastarFim}
            etapaAtual={etapa.id}
            etapas={etapasDisponiveis}
            onMover={onMover}
          />
        ))}

        <button
          type="button"
          className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-line-strong py-2.5 text-[13px] text-muted transition hover:border-brand hover:text-brand"
        >
          <Icon name="plus" size={14} />
          Adicionar oportunidade
        </button>
      </div>
    </section>
  );
}

function Cartao({
  negocio,
  selecionado,
  onSelecionar,
  onArrastarInicio,
  onArrastarFim,
  etapaAtual,
  etapas,
  onMover,
}: {
  negocio: CardNegocio;
  selecionado: boolean;
  onSelecionar: () => void;
  onArrastarInicio: () => void;
  onArrastarFim: () => void;
  etapaAtual: string;
  etapas: EtapaPipeline[];
  onMover: (negocioId: string, destinoId: string) => void;
}) {
  const [menu, setMenu] = useState(false);

  return (
    <article
      draggable
      onDragStart={onArrastarInicio}
      onDragEnd={onArrastarFim}
      onClick={onSelecionar}
      className={cx(
        'cursor-grab rounded-md border bg-surface p-3 transition active:cursor-grabbing',
        selecionado ? 'border-brand ring-1 ring-brand' : 'border-line hover:border-line-strong',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="icon-tile h-6 w-6 rounded-sm">
            <Icon name="building" size={12} />
          </span>
          <p className="truncate text-[13px] font-semibold text-fg">{negocio.empresa}</p>
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm h-6 w-6"
            aria-label={`Ações de ${negocio.empresa}`}
            aria-haspopup="menu"
            aria-expanded={menu}
            onClick={(e) => {
              e.stopPropagation();
              setMenu((v) => !v);
            }}
          >
            <Icon name="dots" size={14} />
          </button>

          {/* Caminho acessível equivalente ao arrastar */}
          {menu && (
            <div
              role="menu"
              className="lg-popover absolute right-0 top-7 z-dropdown w-48 animate-scale-in p-1"
              onClick={(e) => e.stopPropagation()}
            >
              <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-faint">Mover para</p>
              {etapas
                .filter((e) => e.id !== etapaAtual)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg transition hover:bg-[var(--fill-3)]"
                    onClick={() => {
                      onMover(negocio.id, e.id);
                      setMenu(false);
                    }}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: e.cor }} aria-hidden />
                    {e.nome}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      <p className="mt-2 truncate text-[12.5px] text-muted">{negocio.titulo}</p>
      <p className="mt-1 text-[15px] font-bold tabular text-fg">{moeda(negocio.valor)}</p>

      <div className="mt-2 flex flex-wrap gap-1">
        {negocio.tags.map((t) => (
          <span key={t} className="pill h-[20px] px-2 text-[11px]">
            {t}
          </span>
        ))}
      </div>

      <div className="mt-2.5 flex items-center gap-1.5 border-t border-line pt-2.5">
        <Avatar name={negocio.responsavel?.nome ?? '?'} size={20} />
        <span className="truncate text-[11.5px] text-muted">{negocio.responsavel?.nome.split(' ')[0]}</span>
        <span className="text-faint" aria-hidden>
          ·
        </span>
        <Quando data={negocio.atualizadoEm} className="shrink-0 text-[11.5px] text-muted" />
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */

function ListaNegocios({ etapas, onSelecionar }: { etapas: EtapaPipeline[]; onSelecionar: (id: string) => void }) {
  const linhas = etapas.flatMap((e) => e.negocios.map((n) => ({ ...n, etapa: e.nome, cor: e.cor })));

  return (
    <div className="card overflow-x-auto scrollbar-thin">
      <table className="tbl">
        <thead>
          <tr>
            <th>Empresa</th>
            <th>Oportunidade</th>
            <th>Etapa</th>
            <th className="text-right">Valor</th>
            <th>Responsável</th>
            <th>Atualizado</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={l.id} onClick={() => onSelecionar(l.id)} className="cursor-pointer">
              <td className="font-medium text-fg">{l.empresa}</td>
              <td className="text-muted">{l.titulo}</td>
              <td>
                <span className="pill">
                  <span className="h-2 w-2 rounded-full" style={{ background: l.cor }} aria-hidden />
                  {l.etapa}
                </span>
              </td>
              <td className="text-right font-semibold tabular text-fg">{moeda(l.valor)}</td>
              <td>
                <span className="flex items-center gap-2">
                  <Avatar name={l.responsavel?.nome ?? '?'} size={22} />
                  <span className="text-[13px]">{l.responsavel?.nome.split(' ')[0]}</span>
                </span>
              </td>
              <td>
                <Quando data={l.atualizadoEm} className="text-[13px] text-muted" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function PainelNegocio({ onFechar }: { onFechar: () => void }) {
  const n = NEGOCIO_DETALHE;
  const [aba, setAba] = useState<'visao' | 'atividades' | 'contatos' | 'arquivos'>('visao');

  return (
    <div className="card">
      <div className="flex items-start gap-3 p-4">
        <span className="icon-tile icon-tile-success h-10 w-10">
          <Icon name="building" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-bold text-fg">{n.empresa?.split(' ')[0]}</p>
          <p className="truncate text-[12.5px] text-muted">{n.titulo}</p>
          <span className="pill pill-brand mt-2">
            {n.etapa}
            <Icon name="chevronDown" size={12} />
          </span>
        </div>
        <button type="button" onClick={onFechar} className="btn btn-ghost btn-icon btn-sm" aria-label="Fechar painel">
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="flex gap-4 border-b border-line px-4" role="tablist">
        {(['visao', 'atividades', 'contatos', 'arquivos'] as const).map((a) => (
          <button key={a} type="button" role="tab" className="tab text-[13px]" aria-selected={aba === a} onClick={() => setAba(a)}>
            {{ visao: 'Visão Geral', atividades: 'Atividades', contatos: 'Contatos', arquivos: 'Arquivos' }[a]}
          </button>
        ))}
      </div>

      {aba === 'visao' ? (
        <div className="p-4">
          <dl className="space-y-3">
            <Detalhe icone="dollar" rotulo="Valor da oportunidade">
              <span className="font-semibold tabular">{moeda(n.valor)}</span>
            </Detalhe>
            <Detalhe icone="building" rotulo="Empresa">
              {n.empresa}
            </Detalhe>
            <Detalhe icone="user" rotulo="Contato principal">
              {n.contatoPrincipal?.nome}
              <span className="block text-[11.5px] text-muted">{n.contatoPrincipal?.cargo}</span>
            </Detalhe>
            <Detalhe icone="users" rotulo="Owner">
              {n.responsavel?.nome}
            </Detalhe>
            <Detalhe icone="calendar" rotulo="Previsão de fechamento">
              {dataCurta(n.previsaoFechamento)}
            </Detalhe>
            <Detalhe icone="target" rotulo="Origem">
              {n.origem}
            </Detalhe>
            <Detalhe icone="tag" rotulo="Tags">
              <span className="flex flex-wrap gap-1">
                {n.tags?.map((t) => (
                  <span key={t} className="tag h-[22px] text-[11px]">
                    {t}
                  </span>
                ))}
              </span>
            </Detalhe>
          </dl>

          {n.observacoes && (
            <div className="mt-4 flex gap-2.5 rounded-md bg-brand-softer p-3">
              <Icon name="note" size={15} className="mt-0.5 shrink-0 text-brand" />
              <div>
                <p className="text-[12.5px] font-semibold text-fg">Observações</p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted">{n.observacoes}</p>
              </div>
            </div>
          )}

          <h3 className="mb-2 mt-5 flex items-center justify-between text-[13px] font-semibold text-fg">
            Próximos Passos
            <Link href="/agenda" className="flex items-center gap-1 text-[12.5px] font-normal text-brand hover:underline">
              Ver todos <Icon name="arrowRight" size={13} />
            </Link>
          </h3>
          <ul className="space-y-2.5">
            {NEGOCIO_PROXIMOS_PASSOS.map((p) => (
              <li key={p.id} className="flex items-center gap-2.5">
                <input type="checkbox" className="checkbox shrink-0" aria-label={p.titulo} />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{p.titulo}</span>
                <Quando data={p.quando} formato="data" className="shrink-0 text-[11.5px] text-muted" />
              </li>
            ))}
          </ul>

          <div className="mt-4 flex gap-2">
            <button type="button" className="btn btn-sm flex-1">
              Mais ações
              <Icon name="dots" size={14} />
            </button>
            <button type="button" className="btn btn-primary btn-sm flex-1">
              <Icon name="plus" size={14} />
              Registrar atividade
            </button>
          </div>
        </div>
      ) : (
        <div className="p-4">
          <EmptyState icon="info" title={`Sem ${aba} registradas`} description="O conteúdo aparece aqui assim que houver registros." />
        </div>
      )}
    </div>
  );
}

function Detalhe({
  icone,
  rotulo,
  children,
}: {
  icone: Parameters<typeof Icon>[0]['name'];
  rotulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon name={icone} size={15} className="mt-0.5 shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <dt className="text-[11.5px] text-muted">{rotulo}</dt>
        <dd className="text-[13px] text-fg">{children}</dd>
      </div>
    </div>
  );
}

function PipelineVazio({ onNova }: { onNova: () => void }) {
  return (
    <div className="card">
      <EmptyState
        icon="chart"
        title="Seu pipeline ainda está vazio"
        description="Crie um funil com suas etapas de venda e comece a mover oportunidades. As métricas de conversão e ciclo aparecem automaticamente."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" className="btn btn-primary btn-sm" onClick={onNova}>
              <Icon name="plus" size={15} />
              Nova oportunidade
            </button>
            <Link href="/funis" className="btn btn-sm">
              <Icon name="settings" size={15} />
              Configurar etapas
            </Link>
          </div>
        }
      />
    </div>
  );
}

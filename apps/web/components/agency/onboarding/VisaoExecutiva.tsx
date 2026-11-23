'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Button, SkeletonRows, useToast } from '@/components/kit';
import { EmptyState } from '@/components/revenue/States';
import { FiltroSelect } from '@/components/agency/daily/pecas';
import { useAgency } from '@/components/agency/AgencyProvider';
import { agency, type MembroAgencia } from '@/lib/agency';
import { PRIORIDADE, PRIORIDADE_ORDEM } from '@/lib/agency-daily';
import {
  FILTROS_VAZIOS,
  STATUS_OB,
  contadoresPorStatus,
  contarFiltros,
  mensagemErro,
  onboardingApi,
  type FiltrosVisao,
  type ResumoOnboarding,
  type VisaoExecutiva,
} from '@/lib/onboarding';
import { Progresso, StatusObPill, nomeMembro } from './pecas';
import { IniciarOnboardingModal } from './IniciarOnboardingModal';
import { Quando } from '@/components/revenue/Quando';

/**
 * Visão executiva do Onboarding KROMA: todos os onboardings da agência com
 * contadores por status, filtros e atalho para iniciar um novo.
 */
export function VisaoExecutivaView() {
  const router = useRouter();
  const toast = useToast();
  const { contexto, clientes } = useAgency();
  const [visao, setVisao] = useState<VisaoExecutiva | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [membros, setMembros] = useState<MembroAgencia[]>([]);
  const [filtros, setFiltros] = useState<FiltrosVisao>(FILTROS_VAZIOS);
  const [iniciando, setIniciando] = useState(false);
  const podeEditar = !!contexto && contexto.role !== 'viewer';

  const carregar = useCallback(() => {
    setErro(null);
    onboardingApi
      .visao(filtros)
      .then(setVisao)
      .catch((e) => setErro(mensagemErro(e, 'Não foi possível carregar os onboardings.')));
  }, [filtros]);

  useEffect(() => carregar(), [carregar]);
  useEffect(() => {
    agency.listarMembros().then(setMembros).catch(() => undefined);
  }, []);

  const contadores = useMemo(() => contadoresPorStatus(visao?.contadores ?? {}), [visao]);
  const atrasadas = useMemo(() => (visao?.itens ?? []).reduce((n, o) => n + o.tarefas.atrasadas, 0), [visao]);
  const filtrando = contarFiltros(filtros) > 0;
  const set = <K extends keyof FiltrosVisao>(k: K, v: FiltrosVisao[K]) => setFiltros((f) => ({ ...f, [k]: v }));

  const aoIniciar = (id: string) => {
    setIniciando(false);
    toast.success('Onboarding iniciado');
    router.push(`/agency/onboarding/${id}`);
  };

  return (
    <div className="space-y-4">
      {/* Contadores por status + tarefas atrasadas (clique num status filtra a lista). */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {contadores.map((c) => (
          <button
            key={c.status}
            type="button"
            onClick={() => set('status', filtros.status === c.status ? '' : c.status)}
            aria-pressed={filtros.status === c.status}
            className={cx('card flex items-center gap-3 px-4 py-3 text-left transition hover:border-line-strong', filtros.status === c.status && 'border-brand-border bg-brand-softer')}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs text-muted">{STATUS_OB[c.status].label}</span>
              <span className="t-kpi block text-2xl tabular">{visao ? c.total : '…'}</span>
            </span>
          </button>
        ))}
        <div className="card flex items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs text-muted">Tarefas atrasadas</span>
            <span className={cx('t-kpi block text-2xl tabular', atrasadas > 0 && 'text-danger')}>{visao ? atrasadas : '…'}</span>
          </span>
          {atrasadas > 0 && <Icon name="flame" size={16} className="shrink-0 text-danger" />}
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <FiltroSelect rotulo="Cliente" icone="building" valor={filtros.cliente} onChange={(v) => set('cliente', v)} opcoes={clientes.map((c) => ({ value: c.id, label: c.nome }))} />
        <FiltroSelect rotulo="Responsável" icone="user" valor={filtros.responsavel} onChange={(v) => set('responsavel', v)} opcoes={membros.map((m) => ({ value: m.id, label: m.email }))} />
        <FiltroSelect
          rotulo="Status"
          icone="filter"
          valor={filtros.status}
          onChange={(v) => set('status', v as FiltrosVisao['status'])}
          opcoes={contadores.map((c) => ({ value: c.status, label: STATUS_OB[c.status].label }))}
        />
        <FiltroSelect
          rotulo="Prioridade"
          icone="flame"
          valor={filtros.prioridade}
          onChange={(v) => set('prioridade', v as FiltrosVisao['prioridade'])}
          opcoes={PRIORIDADE_ORDEM.map((p) => ({ value: p, label: PRIORIDADE[p].label }))}
        />
        <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-muted">
          <Icon name="layout" size={13} /> Etapa
          <input className="w-28 bg-transparent font-medium text-fg outline-none placeholder:text-faint" placeholder="ex.: imersão" value={filtros.etapa} onChange={(e) => set('etapa', e.target.value)} />
        </label>
        <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-muted">
          <Icon name="calendar" size={13} /> De
          <input type="date" className="bg-transparent font-medium text-fg outline-none" value={filtros.de} onChange={(e) => set('de', e.target.value)} />
        </label>
        <label className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[12.5px] text-muted">
          Até
          <input type="date" className="bg-transparent font-medium text-fg outline-none" value={filtros.ate} onChange={(e) => set('ate', e.target.value)} />
        </label>
        {filtrando && (
          <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => setFiltros(FILTROS_VAZIOS)}>
            Limpar filtros
          </button>
        )}
        {podeEditar && (
          <div className="ml-auto">
            <Button size="sm" variant="primary" icon="plus" onClick={() => setIniciando(true)}>
              Iniciar onboarding
            </Button>
          </div>
        )}
      </div>

      {/* Lista */}
      {erro ? (
        <EmptyState icon="alert" title="Não foi possível carregar" description={erro} action={<Button size="sm" onClick={carregar}>Tentar de novo</Button>} />
      ) : !visao ? (
        <div className="card p-4">
          <SkeletonRows rows={5} />
        </div>
      ) : visao.itens.length === 0 ? (
        <EmptyState
          icon={filtrando ? 'filter' : 'target'}
          title={filtrando ? 'Nenhum onboarding com esses filtros' : 'Nenhum onboarding ainda'}
          description={filtrando ? 'Ajuste ou limpe os filtros para ver mais.' : 'Inicie o onboarding de uma subconta para conduzir a entrada do cliente com processo rastreável.'}
          action={podeEditar && !filtrando ? <Button size="sm" variant="primary" icon="plus" onClick={() => setIniciando(true)}>Iniciar onboarding</Button> : undefined}
        />
      ) : (
        <ul className="card divide-y divide-line p-0">
          {visao.itens.map((o) => (
            <LinhaOnboarding key={o.id} o={o} membros={membros} />
          ))}
        </ul>
      )}

      <IniciarOnboardingModal open={iniciando} onClose={() => setIniciando(false)} onIniciado={aoIniciar} membros={membros} />
    </div>
  );
}

function LinhaOnboarding({ o, membros }: { o: ResumoOnboarding; membros: MembroAgencia[] }) {
  const router = useRouter();
  return (
    <li>
      <div
        role="link"
        tabIndex={0}
        onClick={() => router.push(`/agency/onboarding/${o.id}`)}
        onKeyDown={(e) => e.key === 'Enter' && router.push(`/agency/onboarding/${o.id}`)}
        className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-surface2 has-[:focus-visible]:bg-surface2 md:grid-cols-[minmax(0,1.4fr)_130px_minmax(0,1fr)_140px_130px]"
      >
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-fg">{o.cliente.nome}</span>
            <StatusObPill status={o.status} />
          </p>
          <p className="mt-0.5 truncate text-[11.5px] text-faint">
            Iniciado <Quando data={o.startedAt} formato="data" />
            {o.etapaAtual ? ` · Etapa: ${o.etapaAtual}` : ''}
            {o.tarefas.atrasadas > 0 && <span className="font-medium text-danger"> · {o.tarefas.atrasadas} {o.tarefas.atrasadas === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}</span>}
          </p>
        </div>
        <span className="hidden text-xs text-muted md:block">{nomeMembro(membros, o.responsavelId) || <span className="text-faint">Sem responsável</span>}</span>
        <span className="hidden md:block">
          <Progresso verificadas={o.verificacoes.verificadas} total={o.verificacoes.total} />
        </span>
        <span className="hidden text-xs text-faint md:block">
          {o.verificacoes.bloqueadas > 0 ? <span className="text-danger">{o.verificacoes.bloqueadas} bloqueada(s)</span> : `${o.verificacoes.pendentes} pendente(s)`}
        </span>
        <span className="flex items-center justify-end gap-1 text-faint">
          <Icon name="chevronRight" size={14} />
        </span>
      </div>
    </li>
  );
}

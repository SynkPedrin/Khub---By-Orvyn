'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import type { ProfissionalAgenda } from '@/lib/agenda';
import { mesmoDia } from './calendario-layout';
import type { CorEquipe } from './cores-equipe';

const SEM_FUNCAO = 'Sem função';
const DIAS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

/**
 * Painel lateral da agenda (salão/clínica), no molde do Avec: mini calendário
 * para pular de dia e o filtro de profissionais agrupado por função, com busca.
 * Quem está desmarcado some de todas as visões.
 */
export function PainelAgenda({
  dia,
  agora,
  onDia,
  profissionais,
  selecionados,
  onSelecionados,
  corDe,
}: {
  dia: Date;
  agora: Date;
  onDia: (d: Date) => void;
  profissionais: ProfissionalAgenda[];
  selecionados: Set<string>;
  onSelecionados: (s: Set<string>) => void;
  corDe: ((id: string | null | undefined) => CorEquipe) | null;
}) {
  return (
    <div className="space-y-3">
      <MiniCalendario dia={dia} agora={agora} onDia={onDia} />
      <FiltroProfissionais profissionais={profissionais} selecionados={selecionados} onSelecionados={onSelecionados} corDe={corDe} />
    </div>
  );
}

/* ---------------------------------------------------------------- calendário */

function MiniCalendario({ dia, agora, onDia }: { dia: Date; agora: Date; onDia: (d: Date) => void }) {
  const [mes, setMes] = useState(() => new Date(dia.getFullYear(), dia.getMonth(), 1));
  // Mudou o dia por fora (setas, "Hoje"): o mini calendário acompanha o mês.
  useEffect(() => {
    setMes((m) => (m.getFullYear() === dia.getFullYear() && m.getMonth() === dia.getMonth() ? m : new Date(dia.getFullYear(), dia.getMonth(), 1)));
  }, [dia]);

  // 6 semanas fixas, começando no domingo (como o calendário de parede).
  const celulas = useMemo(() => {
    const ini = new Date(mes);
    ini.setDate(1 - mes.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + i));
  }, [mes]);

  const trocarMes = (delta: number) => setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));
  const rotulo = mes.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }).replace(/^./, (l) => l.toUpperCase());

  return (
    <section className="card p-3" aria-label="Escolher dia">
      <header className="mb-2 flex items-center justify-between">
        <button type="button" className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label="Mês anterior" onClick={() => trocarMes(-1)}>
          <Icon name="arrowLeft" size={14} />
        </button>
        <h2 className="text-[13px] font-semibold text-fg">{rotulo}</h2>
        <button type="button" className="btn btn-ghost btn-icon btn-sm h-7 w-7" aria-label="Próximo mês" onClick={() => trocarMes(1)}>
          <Icon name="arrowRight" size={14} />
        </button>
      </header>
      <div className="grid grid-cols-7 gap-y-0.5 text-center" role="grid">
        {DIAS.map((d, i) => (
          <span key={i} className="pb-1 text-2xs font-bold text-fg" role="columnheader">
            {d}
          </span>
        ))}
        {celulas.map((d) => {
          const fora = d.getMonth() !== mes.getMonth();
          const sel = mesmoDia(d, dia);
          const hoje = mesmoDia(d, agora);
          return (
            <button
              key={d.toISOString()}
              type="button"
              onClick={() => onDia(d)}
              aria-current={hoje ? 'date' : undefined}
              aria-pressed={sel}
              aria-label={d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
              className={cx(
                'mx-auto flex h-7 w-7 items-center justify-center rounded-md text-xs tabular-nums transition-colors',
                sel ? 'bg-brand font-bold text-white dark:text-[#0e1a04]' : hoje ? 'font-bold text-brand ring-1 ring-brand' : fora ? 'text-faint hover:bg-surface2' : 'text-fg hover:bg-surface2',
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- profissionais */

function Caixa({ marcado, parcial, onChange, rotulo }: { marcado: boolean; parcial?: boolean; onChange: () => void; rotulo: string }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!parcial && !marcado;
  }, [parcial, marcado]);
  return <input ref={ref} type="checkbox" className="checkbox shrink-0" checked={marcado} onChange={onChange} aria-label={rotulo} />;
}

function FiltroProfissionais({
  profissionais,
  selecionados,
  onSelecionados,
  corDe,
}: {
  profissionais: ProfissionalAgenda[];
  selecionados: Set<string>;
  onSelecionados: (s: Set<string>) => void;
  corDe: ((id: string | null | undefined) => CorEquipe) | null;
}) {
  const [busca, setBusca] = useState('');
  const [recolhidos, setRecolhidos] = useState<Set<string>>(new Set());

  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const m = new Map<string, ProfissionalAgenda[]>();
    for (const p of profissionais) {
      if (termo && !p.nome.toLowerCase().includes(termo)) continue;
      const g = p.especialidade?.trim() || SEM_FUNCAO;
      m.set(g, [...(m.get(g) ?? []), p]);
    }
    return [...m.entries()].sort(([a], [b]) => (a === SEM_FUNCAO ? 1 : b === SEM_FUNCAO ? -1 : a.localeCompare(b, 'pt-BR')));
  }, [profissionais, busca]);

  const todos = selecionados.size === profissionais.length && profissionais.length > 0;
  const algum = selecionados.size > 0;
  const comGrupos = grupos.length > 1 || (grupos[0]?.[0] ?? SEM_FUNCAO) !== SEM_FUNCAO;
  const tudoRecolhido = comGrupos && grupos.every(([g]) => recolhidos.has(g));

  const alternar = (ids: string[], ligar: boolean) => {
    const prox = new Set(selecionados);
    ids.forEach((id) => (ligar ? prox.add(id) : prox.delete(id)));
    onSelecionados(prox);
  };

  return (
    <section className="card p-3" aria-label="Filtrar profissionais">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-fg">Profissionais</h2>
        <span className="text-2xs tabular-nums text-muted">
          {selecionados.size} de {profissionais.length}
        </span>
      </header>

      <label className="relative mb-2 block">
        <span className="sr-only">Buscar profissional</span>
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar profissional" className="input h-8 w-full pr-8 text-xs" />
        {busca ? (
          <button type="button" onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-fg" aria-label="Limpar busca">
            <Icon name="close" size={13} />
          </button>
        ) : (
          <Icon name="search" size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-faint" />
        )}
      </label>

      <div className="mb-1 flex items-center gap-2 px-1 py-1">
        <Caixa marcado={todos} parcial={algum} rotulo="Todas as profissionais" onChange={() => onSelecionados(todos ? new Set() : new Set(profissionais.map((p) => p.id)))} />
        <span className="text-[13px] font-semibold text-fg">Todos</span>
        {comGrupos && (
          <button
            type="button"
            className="ml-auto text-2xs font-semibold text-brand hover:underline"
            onClick={() => setRecolhidos(tudoRecolhido ? new Set() : new Set(grupos.map(([g]) => g)))}
          >
            {tudoRecolhido ? 'Expandir tudo' : 'Reduzir tudo'}
          </button>
        )}
      </div>

      <div className="max-h-[52vh] space-y-1 overflow-y-auto scrollbar-thin pr-1">
        {grupos.map(([grupo, lista]) => {
          const ids = lista.map((p) => p.id);
          const marcados = ids.filter((id) => selecionados.has(id)).length;
          const fechado = recolhidos.has(grupo) && !busca;
          return (
            <div key={grupo}>
              {comGrupos && (
                <div className="flex items-center gap-1.5 px-1 py-1">
                  <button
                    type="button"
                    onClick={() => setRecolhidos((r) => { const n = new Set(r); if (n.has(grupo)) n.delete(grupo); else n.add(grupo); return n; })}
                    className="text-faint hover:text-fg"
                    aria-label={fechado ? `Mostrar ${grupo}` : `Esconder ${grupo}`}
                    aria-expanded={!fechado}
                  >
                    <Icon name={fechado ? 'chevronRight' : 'chevronDown'} size={12} />
                  </button>
                  <Caixa marcado={marcados === ids.length} parcial={marcados > 0} rotulo={`Função ${grupo}`} onChange={() => alternar(ids, marcados !== ids.length)} />
                  <span className="truncate text-[13px] font-semibold text-fg">{grupo}</span>
                </div>
              )}
              {!fechado && (
                <ul className={cx(comGrupos && 'ml-[11px] border-l border-line pl-3')}>
                  {lista.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-surface2">
                        <Caixa marcado={selecionados.has(p.id)} rotulo={p.nome} onChange={() => alternar([p.id], !selecionados.has(p.id))} />
                        {corDe && <span className={cx('h-2 w-2 shrink-0 rounded-full', corDe(p.id).faixa)} aria-hidden />}
                        <span className="truncate text-[13px] text-fg">{p.nome}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {!grupos.length && <p className="px-1 py-2 text-xs text-muted">Nenhuma profissional com esse nome.</p>}
      </div>
    </section>
  );
}

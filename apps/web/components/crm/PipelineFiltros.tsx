'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import { Select } from '@/components/kit';
import { contarFiltros, faixaInvalida, type FiltrosPipeline, type StatusFiltro } from '@/lib/pipeline';

export interface Dono { identityId: string; nome: string }

interface Props {
  filtros: FiltrosPipeline;
  onChange: (f: FiltrosPipeline) => void;
  origens: string[];
  tags: string[];
  donos: Dono[];
  visao: 'kanban' | 'lista';
  onVisao: (v: 'kanban' | 'lista') => void;
}

const STATUS: { value: StatusFiltro; label: string }[] = [
  { value: 'abertos', label: 'Abertos' },
  { value: 'ganhos', label: 'Ganhos' },
  { value: 'perdidos', label: 'Perdidos' },
  { value: 'todos', label: 'Todos' },
];

/**
 * Barra de filtros do Pipeline real (Q2.1). Os filtros vivem na URL (a página
 * sincroniza), então um link filtrado é compartilhável. A busca espera a
 * pessoa parar de digitar para não disparar uma requisição por tecla.
 */
export function PipelineFiltros({ filtros, onChange, origens, tags, donos, visao, onVisao }: Props) {
  const [busca, setBusca] = useState(filtros.q ?? '');
  const [mais, setMais] = useState(() => !!(filtros.valorMin || filtros.valorMax || filtros.criadoDe || filtros.criadoAte));
  const set = (k: keyof FiltrosPipeline, v: string) => onChange({ ...filtros, [k]: v || undefined });

  useEffect(() => setBusca(filtros.q ?? ''), [filtros.q]);
  useEffect(() => {
    if ((filtros.q ?? '') === busca.trim()) return;
    const t = setTimeout(() => onChange({ ...filtros, q: busca.trim() || undefined }), 350);
    return () => clearTimeout(t);
  }, [busca]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = contarFiltros(filtros);
  const invertida = faixaInvalida(filtros);
  // valor que veio da URL e não está mais nas opções do funil continua selecionável
  const comAtual = (lista: string[], atual?: string) => (atual && !lista.includes(atual) ? [atual, ...lista] : lista);

  return (
    <div className="mb-4 space-y-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input type="search" className="input pl-9" placeholder="Buscar por título ou contato" aria-label="Buscar negócios por título ou contato" value={busca} maxLength={120} onChange={(e) => setBusca(e.target.value)} />
        </div>
        <Select size="sm" className="w-auto" aria-label="Filtrar por status" value={filtros.status ?? 'abertos'} onChange={(v) => set('status', v === 'abertos' ? '' : v)} options={STATUS} />
        <Select
          size="sm"
          className="w-auto"
          aria-label="Filtrar por dono"
          value={filtros.ownerId ?? ''}
          onChange={(v) => set('ownerId', v)}
          placeholder="Todos os donos"
          options={[{ value: 'nenhum', label: 'Sem dono' }, ...donos.map((d) => ({ value: d.identityId, label: d.nome }))]}
        />
        <Select size="sm" className="w-auto" aria-label="Filtrar por origem" value={filtros.origem ?? ''} onChange={(v) => set('origem', v)} placeholder="Todas as origens" options={comAtual(origens, filtros.origem).map((o) => ({ value: o, label: o }))} />
        <Select size="sm" className="w-auto" aria-label="Filtrar por tag do contato" value={filtros.tag ?? ''} onChange={(v) => set('tag', v)} placeholder="Todas as tags" options={comAtual(tags, filtros.tag).map((t) => ({ value: t, label: t }))} />
        <button type="button" className={cx('btn btn-sm', mais && 'btn-soft')} aria-expanded={mais} aria-controls="filtros-extra" onClick={() => setMais((v) => !v)}>
          <Icon name="filter" size={14} />
          Valor e data
        </button>
        {n > 0 && (
          <button type="button" className="pill h-8 gap-1.5 px-3 text-xs hover:border-line-strong" onClick={() => { setBusca(''); onChange({}); }}>
            <Icon name="close" size={12} />
            Limpar filtros <span className="tabular">({n})</span>
          </button>
        )}
        <div className="segbar ml-auto" role="group" aria-label="Formato do pipeline">
          <button type="button" className="seg" aria-pressed={visao === 'kanban'} onClick={() => onVisao('kanban')}>
            <Icon name="grid" size={14} />
            Kanban
          </button>
          <button type="button" className="seg" aria-pressed={visao === 'lista'} onClick={() => onVisao('lista')}>
            <Icon name="list" size={14} />
            Lista
          </button>
        </div>
      </div>

      {mais && (
        <div id="filtros-extra" className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface2 p-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Valor mínimo (R$)
            <input type="number" inputMode="decimal" min={0} step="0.01" className="input w-36 tabular" value={filtros.valorMin ?? ''} onChange={(e) => set('valorMin', e.target.value)} aria-invalid={invertida} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Valor máximo (R$)
            <input type="number" inputMode="decimal" min={0} step="0.01" className="input w-36 tabular" value={filtros.valorMax ?? ''} onChange={(e) => set('valorMax', e.target.value)} aria-invalid={invertida} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Criado de
            <input type="date" className="input w-40" value={filtros.criadoDe ?? ''} max={filtros.criadoAte} onChange={(e) => set('criadoDe', e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-muted">
            Criado até
            <input type="date" className="input w-40" value={filtros.criadoAte ?? ''} min={filtros.criadoDe} onChange={(e) => set('criadoAte', e.target.value)} />
          </label>
          {invertida && <p role="alert" className="text-xs text-danger">O valor mínimo está maior que o máximo.</p>}
        </div>
      )}
    </div>
  );
}

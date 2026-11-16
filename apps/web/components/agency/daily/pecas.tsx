'use client';

import type { ReactNode } from 'react';
import { Icon } from '@/components/icons';
import { Avatar, cx } from '@/components/ui';
import {
  APROVACAO,
  PRIORIDADE,
  STATUS,
  TIPO,
  TOM,
  faixaPrazo,
  rotuloDia,
  type Aprovacao,
  type Prioridade,
  type Ref,
  type Status,
  type Tarefa,
  type Tom,
} from '@/lib/agency-daily';

export function Pill({ tom, children, className }: { tom: Tom; children: ReactNode; className?: string }) {
  return <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold', TOM[tom].pill, className)}>{children}</span>;
}

export function Ponto({ tom, className }: { tom: Tom; className?: string }) {
  return <span aria-hidden className={cx('inline-block h-2 w-2 shrink-0 rounded-full', TOM[tom].dot, className)} />;
}

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <Pill tom={s.tom}>
      <Ponto tom={s.tom} /> {s.label}
    </Pill>
  );
}

export function AprovacaoPill({ aprovacao }: { aprovacao: Aprovacao }) {
  const a = APROVACAO[aprovacao];
  return <Pill tom={a.tom}>{a.label}</Pill>;
}

/** Bandeira de prioridade: Normal e Baixa ficam discretas para não poluir a lista. */
export function PrioridadeFlag({ prioridade, mostrarNormal }: { prioridade: Prioridade; mostrarNormal?: boolean }) {
  const p = PRIORIDADE[prioridade];
  if (!mostrarNormal && (prioridade === 'normal' || prioridade === 'baixa')) return null;
  return (
    <span className={cx('inline-flex items-center gap-1 text-[11.5px] font-semibold', prioridade === 'urgente' ? 'text-danger' : prioridade === 'alta' ? 'text-warning' : 'text-muted')}>
      <Icon name="flame" size={12} /> {p.label}
    </span>
  );
}

export function Pessoa({ pessoa, tamanho = 22, comNome }: { pessoa: Ref | null; tamanho?: number; comNome?: boolean }) {
  if (!pessoa) {
    return (
      <span title="Sem responsável" className="inline-flex items-center gap-1.5 text-xs text-faint">
        <span className="grid shrink-0 place-items-center rounded-full border border-dashed border-line-strong" style={{ width: tamanho, height: tamanho }}>
          <Icon name="user" size={Math.round(tamanho * 0.55)} />
        </span>
        {comNome && 'Ninguém'}
      </span>
    );
  }
  return (
    <span title={pessoa.nome} className="inline-flex min-w-0 items-center gap-1.5">
      <Avatar name={pessoa.nome} size={tamanho} />
      {comNome && <span className="truncate text-xs text-fg">{pessoa.nome}</span>}
    </span>
  );
}

/** Prazo com cor pela urgência (atrasada em vermelho, hoje em âmbar). */
export function Prazo({ tarefa, compacto }: { tarefa: Pick<Tarefa, 'prazoEm' | 'status'>; compacto?: boolean }) {
  const faixa = faixaPrazo(tarefa.prazoEm, tarefa.status === 'concluida');
  if (!tarefa.prazoEm) return compacto ? null : <span className="text-xs text-faint">Sem prazo</span>;
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 whitespace-nowrap text-xs font-medium',
        tarefa.status === 'concluida' ? 'text-faint line-through' : faixa === 'atrasada' ? 'text-danger' : faixa === 'hoje' ? 'text-warning' : 'text-muted',
      )}
    >
      <Icon name="calendar" size={12} /> {rotuloDia(tarefa.prazoEm)}
    </span>
  );
}

export function Tipo({ tarefa }: { tarefa: Pick<Tarefa, 'tipo'> }) {
  return <span className="rounded-md bg-surface3 px-1.5 py-px text-[11px] font-medium text-muted">{TIPO[tarefa.tipo].label}</span>;
}

/** Contadores pequenos de subtarefas, checklist e comentários. */
export function Contadores({ tarefa }: { tarefa: Tarefa }) {
  const itens: ReactNode[] = [];
  if (tarefa.subtarefas) itens.push(<span key="s" className="inline-flex items-center gap-0.5"><Icon name="layout" size={12} />{tarefa.subtarefas}</span>);
  if (tarefa.checklist.total)
    itens.push(
      <span key="c" className={cx('inline-flex items-center gap-0.5', tarefa.checklist.feitos === tarefa.checklist.total && 'text-success')}>
        <Icon name="check2" size={12} />
        {tarefa.checklist.feitos}/{tarefa.checklist.total}
      </span>,
    );
  if (tarefa.comentarios) itens.push(<span key="m" className="inline-flex items-center gap-0.5"><Icon name="chat" size={12} />{tarefa.comentarios}</span>);
  if (!itens.length) return null;
  return <span className="inline-flex items-center gap-2 text-[11.5px] text-faint">{itens}</span>;
}

/** Botão de concluir em forma de círculo (como no ClickUp/KROMA). */
export function Concluir({ feita, onClick, disabled }: { feita: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={feita ? 'Reabrir tarefa' : 'Concluir tarefa'}
      className={cx(
        'grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50',
        feita ? 'border-success bg-success text-white' : 'border-line-strong text-transparent hover:border-success hover:text-success',
      )}
    >
      <Icon name="check" size={11} />
    </button>
  );
}

/** Chip de filtro com menu nativo (leve e acessível). */
export function FiltroSelect<T extends string>({
  rotulo,
  valor,
  opcoes,
  onChange,
  icone,
}: {
  rotulo: string;
  valor: T | '';
  opcoes: { value: T; label: string }[];
  onChange: (v: T | '') => void;
  icone?: Parameters<typeof Icon>[0]['name'];
}) {
  const ativo = valor !== '';
  return (
    <label
      className={cx(
        'relative inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full border pl-3 pr-7 text-[12.5px] font-medium transition',
        ativo ? 'border-brand-border bg-brand-softer text-brand' : 'border-line text-muted hover:bg-surface2',
      )}
    >
      {icone && <Icon name={icone} size={13} />}
      <span className="max-w-[160px] truncate">{ativo ? opcoes.find((o) => o.value === valor)?.label ?? rotulo : rotulo}</span>
      <Icon name="chevronDown" size={12} className="pointer-events-none absolute right-2.5" />
      <select className="absolute inset-0 cursor-pointer opacity-0" aria-label={rotulo} value={valor} onChange={(e) => onChange(e.target.value as T | '')}>
        <option value="">{rotulo}: todos</option>
        {opcoes.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Vazio({ icone, titulo, texto, acao }: { icone: Parameters<typeof Icon>[0]['name']; titulo: string; texto: string; acao?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center px-6 py-14 text-center">
      <span className="icon-tile mb-3">
        <Icon name={icone} size={20} />
      </span>
      <p className="t-title">{titulo}</p>
      <p className="mt-1 max-w-sm text-sm text-muted">{texto}</p>
      {acao && <div className="mt-4">{acao}</div>}
    </div>
  );
}

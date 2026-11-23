'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { cx } from '@/components/ui';
import type { MembroAgencia } from '@/lib/agency';
import { TOM } from '@/lib/agency-daily';
import { STATUS_OB, VERIFICACAO, progressoPct, type StatusOnboarding, type StatusVerificacao } from '@/lib/onboarding';

/**
 * Peças visuais do Onboarding KROMA. Reaproveita os tons do design system
 * (TOM de lib/agency-daily) — nada de cor literal.
 */

export function StatusObPill({ status }: { status: StatusOnboarding }) {
  const s = STATUS_OB[status] ?? { label: status, tom: 'neutro' as const };
  return (
    <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold', TOM[s.tom].pill)}>
      <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', TOM[s.tom].dot)} /> {s.label}
    </span>
  );
}

export function VerificacaoPill({ status }: { status: StatusVerificacao }) {
  const s = VERIFICACAO[status] ?? { label: status, tom: 'neutro' as const };
  return (
    <span className={cx('inline-flex h-[22px] shrink-0 items-center gap-1.5 rounded-full px-2 text-[11.5px] font-semibold', TOM[s.tom].pill)}>
      <span aria-hidden className={cx('inline-block h-2 w-2 rounded-full', TOM[s.tom].dot)} /> {s.label}
    </span>
  );
}

/** Barra de progresso das verificações (verificadas/total). */
export function Progresso({ verificadas, total, className }: { verificadas: number; total: number; className?: string }) {
  const pct = progressoPct(verificadas, total);
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-2', className)}>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${verificadas} de ${total} verificações`}>
        <span className={cx('block h-full rounded-full', pct === 100 ? 'bg-success' : 'bg-brand')} style={{ width: `${pct}%` }} />
      </span>
      <span className="whitespace-nowrap text-xs tabular text-muted">
        {verificadas}/{total}
      </span>
    </span>
  );
}

/** Nome de exibição de um membro da agência (a API expõe e-mail). */
export function nomeMembro(membros: MembroAgencia[], id: string | null | undefined): string {
  if (!id) return '';
  return membros.find((m) => m.id === id)?.email ?? 'Membro da equipe';
}

/** Link "Voltar para o onboarding" (detalhes abertos fora do fluxo principal). */
export function VoltarOnboarding({ href }: { href: string }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-brand hover:underline">
      <Icon name="arrowLeft" size={13} /> Voltar para o onboarding
    </Link>
  );
}

/** Deep-link para a tarefa no Daily da agência (a gaveta abre por `?tarefa=`). */
export function LinkTarefaDaily({ taskId, numero, children }: { taskId: string; numero?: number; children?: ReactNode }) {
  return (
    <Link href={`/agency/tarefas?tarefa=${taskId}`} className="inline-flex items-center gap-1 text-[12.5px] font-medium text-brand hover:underline">
      {children ?? (numero ? `#${numero}` : 'Abrir no Daily')} <Icon name="external" size={12} />
    </Link>
  );
}

/** Estado vazio local de aba/seção (dentro de um card já existente). */
export function VazioLocal({ icone, titulo, texto, acao }: { icone: Parameters<typeof Icon>[0]['name']; titulo: string; texto?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <span className="icon-tile icon-tile-neutral mb-3 h-10 w-10 rounded-lg">
        <Icon name={icone} size={18} />
      </span>
      <p className="text-sm font-semibold text-fg">{titulo}</p>
      {texto && <p className="mt-1 max-w-sm text-[13px] text-muted">{texto}</p>}
      {acao && <div className="mt-3">{acao}</div>}
    </div>
  );
}

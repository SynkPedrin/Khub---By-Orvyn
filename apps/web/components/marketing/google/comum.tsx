'use client';

import type { ReactNode } from 'react';
import { Card, cx } from '@/components/ui';
import { Icon, type IconName } from '@/components/icons';

/** Peças comuns às três abas da Presença Google. */

export function AvisoErro({ mensagem, onTentar }: { mensagem: string; onTentar?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl bg-danger/5 px-4 py-3 text-sm text-danger">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
      <p className="min-w-0 flex-1 leading-relaxed">{mensagem}</p>
      {onTentar && <button onClick={onTentar} className="shrink-0 font-semibold underline">Tentar de novo</button>}
    </div>
  );
}

export function AvisoInfo({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
      <Icon name="info" size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
    </div>
  );
}

export function Kpi({ rotulo, valor, icone, detalhe, tom }: { rotulo: string; valor: string; icone: IconName; detalhe?: ReactNode; tom?: 'bom' | 'ruim' | null }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted">{rotulo}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand/12 text-brand"><Icon name={icone} size={17} /></span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular text-fg">{valor}</p>
      {detalhe !== undefined && (
        <p className={cx('mt-0.5 text-[11px]', tom === 'bom' ? 'text-emerald-600 dark:text-emerald-400' : tom === 'ruim' ? 'text-danger' : 'text-muted')}>{detalhe}</p>
      )}
    </Card>
  );
}

export function Secao({ titulo, acao, children, className }: { titulo: string; acao?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <Card className={cx('overflow-hidden p-0', className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="font-bold text-fg">{titulo}</h2>
        {acao && <div className="ml-auto flex flex-wrap gap-2">{acao}</div>}
      </div>
      {children}
    </Card>
  );
}

export const numero = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 0 });
export const pct = (n: number) => `${(n * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
export const posicao = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
export const dataBr = (iso: string | null) => (iso ? new Date(iso.length === 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : 'sem data');

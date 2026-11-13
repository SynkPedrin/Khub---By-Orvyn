import { cx } from '@/components/ui';

/**
 * Esqueletos de carregamento sobre `.skeleton` (brilho neutro; "Reduzir
 * movimento" para o brilho). Cada bloco composto marca `aria-busy` e diz
 * "Carregando" só para leitor de tela: nada de "Carregando…" solto na tela.
 */

/** Bloco único; dimensione por `className` (ex.: `h-4 w-32`). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton', className)} />;
}

function Ocupado({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div aria-busy="true" className={className}>
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </div>
  );
}

/** Linhas de texto (a última mais curta, como um parágrafo). */
export function SkeletonLines({ lines = 3, className, label = 'Carregando' }: { lines?: number; className?: string; label?: string }) {
  return (
    <Ocupado label={label} className={cx('space-y-2.5', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cx('h-3.5 rounded-sm', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </Ocupado>
  );
}

/** Linhas de lista/tabela (avatar + duas linhas). */
export function SkeletonRows({ rows = 5, className, label = 'Carregando' }: { rows?: number; className?: string; label?: string }) {
  return (
    <Ocupado label={label} className={cx('divide-y divide-line', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5 rounded-sm" />
            <Skeleton className="h-3 w-3/5 rounded-sm" />
          </div>
        </div>
      ))}
    </Ocupado>
  );
}

/** Grade de cards (KPIs, painéis). */
export function SkeletonCards({ count = 4, className, cardClassName = 'h-24', label = 'Carregando' }: { count?: number; className?: string; cardClassName?: string; label?: string }) {
  return (
    <Ocupado label={label} className={cx('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} className={cx('w-full rounded-lg', cardClassName)} />
      ))}
    </Ocupado>
  );
}

/** Página de detalhe: cabeçalho + duas colunas de painéis. */
export function SkeletonDetail({ label = 'Carregando' }: { label?: string }) {
  return (
    <Ocupado label={label} className="space-y-5">
      <div className="card flex items-center gap-4 p-5">
        <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-5 w-48 rounded-sm" />
          <Skeleton className="h-3.5 w-72 max-w-full rounded-sm" />
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card space-y-3 p-5 lg:col-span-2">
          <Skeleton className="h-4 w-32 rounded-sm" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
        </div>
        <div className="card space-y-3 p-5">
          <Skeleton className="h-4 w-24 rounded-sm" />
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
      </div>
    </Ocupado>
  );
}

import type { ReactNode } from 'react';
import { cx } from '../ui';

/**
 * Moldura padrão de página do KHUB.
 *
 * Toda tela do produto usa este container: mesma gutter lateral, mesmo
 * ritmo vertical. Sem ele, cada página inventa o próprio espaçamento e o
 * produto perde a densidade uniforme que os mockups pedem.
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('page-shell mx-auto min-w-0 w-full max-w-[1680px] px-4 py-6 lg:px-8 lg:py-8', className)}>{children}</div>;
}

/**
 * Cabeçalho de página: título + subtítulo à esquerda; mote da marca e/ou
 * ação primária à direita.
 *
 * O mote (`quote`) é assinatura visual da KHUB, não conteúdo — some em
 * telas estreitas para não competir com a ação.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  icon,
  className,
}: {
  title: string;
  subtitle?: string;
  quote?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('relative mb-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4', className)}>
      <div className="relative flex min-w-0 items-center gap-3.5">
        {icon}
        <div className="min-w-0">
          <h1 className="t-display">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
        </div>
      </div>

      {/* Frase de efeito (`quote`) não é mais exibida (ADR-0039): decoração de
          site de marketing dentro do sistema; o prop fica por compatibilidade. */}
      {actions && <div className="relative flex max-w-full flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Card de seção com cabeçalho — o bloco que compõe dashboards e painéis.
 */
export function Section({
  title,
  action,
  children,
  className,
  bodyClassName,
  info,
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Texto de apoio sob o título (ex.: "Distribuição da receita em cada canal"). */
  info?: string;
}) {
  return (
    <section className={cx('card min-w-0 flex flex-col', className)}>
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <h2 className="t-section">{title}</h2>
          {info && <p className="mt-0.5 text-xs text-muted">{info}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className={cx('flex-1 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

/**
 * Grade de KPIs: 1 coluna no telefone, 2 no tablet, N no desktop.
 */
export function KpiGrid({ children, cols = 4 }: { children: ReactNode; cols?: 4 | 6 }) {
  return (
    <div
      className={cx(
        // Celular: 2 colunas (ADR-0036) — 4 KPIs empilhados ocupavam a tela inteira.
        'mb-6 grid grid-cols-2 gap-3 sm:gap-4',
        cols === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3 2xl:grid-cols-6',
      )}
    >
      {children}
    </div>
  );
}

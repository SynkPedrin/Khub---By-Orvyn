import type { ReactNode } from 'react';
import { cx } from '../ui';
import { OrvynBrandMotion } from '../brand/OrvynBrandMotion';

/**
 * Moldura padrão de página do Revenue OS.
 *
 * Toda tela do produto usa este container: mesma gutter lateral, mesmo
 * ritmo vertical. Sem ele, cada página inventa o próprio espaçamento e o
 * produto perde a densidade uniforme que os mockups pedem.
 */
export function PageShell({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-[1680px] px-4 py-6 lg:px-8 lg:py-8', className)}>{children}</div>;
}

/**
 * Cabeçalho de página: título + subtítulo à esquerda; mote da marca e/ou
 * ação primária à direita.
 *
 * O mote (`quote`) é assinatura visual da ORVYN, não conteúdo — some em
 * telas estreitas para não competir com a ação.
 */
export function PageHeader({
  title,
  subtitle,
  quote,
  actions,
  icon,
  className,
  motionAccent,
}: {
  title: string;
  subtitle?: string;
  quote?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
  /**
   * Assinatura em vídeo da ORVYN, como uma faixa estreita à direita do
   * cabeçalho — "Revenue Pulse". Fica atrás do texto (`quote`/`actions`
   * continuam por cima) e se dissolve num degradê pro fundo da página, então
   * nunca compete com o conteúdo real. `false` por padrão: só o Dashboard
   * liga isso — as outras páginas usam `PageHeader` sem qualquer mudança de
   * comportamento ou risco de regressão.
   */
  motionAccent?: boolean;
}) {
  return (
    <div className={cx('relative mb-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4', className)}>
      {motionAccent && (
        <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[34%] max-w-[460px] xl:block">
          <OrvynBrandMotion
            className="rounded-2xl"
            overlay={
              // `quote`/`actions` (o mote e o selo demo) ficam alinhados à
              // direita, DENTRO desta mesma faixa — o cristal só pode
              // aparecer puro na pontinha extrema (depois de 78%); onde o
              // texto vive (os primeiros ~78%), o véu fica quase opaco.
              <div
                className="pointer-events-none absolute inset-0 rounded-2xl"
                aria-hidden
                style={{
                  background:
                    'linear-gradient(90deg, var(--base-2) 0%, color-mix(in srgb, var(--base-2) 88%, transparent) 55%, color-mix(in srgb, var(--base-2) 45%, transparent) 78%, transparent 96%),' +
                    'linear-gradient(0deg, var(--base-2) 0%, transparent 30%, transparent 70%, var(--base-2) 100%)',
                }}
              />
            }
          />
        </div>
      )}

      <div className="relative flex min-w-0 items-center gap-3.5">
        {icon}
        <div className="min-w-0">
          <h1 className="t-display">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[15px] text-muted">{subtitle}</p>}
        </div>
      </div>

      {(quote || actions) && (
        <div className="relative flex shrink-0 items-center gap-5">
          {quote && (
            <div className="hidden text-right xl:block">
              <p className="whitespace-pre-line text-[13.5px] italic leading-relaxed text-muted">{quote}</p>
              <div className="mt-1.5 flex items-center justify-end gap-3">
                <span className="h-px w-8 bg-line" aria-hidden />
                <span className="text-[10px] font-medium tracking-[0.28em] text-faint">ORVYN</span>
              </div>
            </div>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
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
    <section className={cx('card flex flex-col', className)}>
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
        'mb-6 grid gap-4 sm:grid-cols-2',
        cols === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3 2xl:grid-cols-6',
      )}
    >
      {children}
    </div>
  );
}

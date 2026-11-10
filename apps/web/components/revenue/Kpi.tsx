import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Icon, type IconName } from '../icons';
import { cx } from '../ui';
import { ContaNumero } from './ContaNumero';

export type Tom = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/**
 * Cartão de KPI — o componente mais repetido do produto.
 *
 * Anatomia (dos mockups): quadrado de ícone tintado · rótulo pequeno ·
 * número grande · delta colorido + termo de comparação.
 *
 * Sobre o delta: `delta` é o número (ex.: 12 para +12%) e `deltaBom` diz se
 * subir é bom. Tempo de resposta cai e isso é ótimo — sem esse flag, a seta
 * verde/vermelha mentiria. `undefined` = sem dado, e aí nada é desenhado
 * (não inventamos comparação).
 */
export function KpiCard({
  label,
  value,
  icon,
  tom = 'brand',
  delta,
  deltaBom = true,
  comparacao,
  loading,
  compacto = false,
  className,
}: {
  label: string;
  value: ReactNode;
  icon: IconName;
  tom?: Tom;
  delta?: number;
  deltaBom?: boolean;
  comparacao?: string;
  loading?: boolean;
  /** Grades de 6 colunas: reduz o número e deixa o rótulo quebrar em duas
      linhas. Sem isto, "R$ 284.500" é cortado no meio. */
  compacto?: boolean;
  className?: string;
}) {
  if (loading) {
    return (
      <div className={cx('card min-w-0 overflow-hidden p-5', className)}>
        <div className="flex items-start gap-3.5">
          <div className="skeleton h-[38px] w-[38px] rounded-md" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-7 w-20" />
            <div className="skeleton h-3 w-32" />
          </div>
        </div>
      </div>
    );
  }

  const subiu = typeof delta === 'number' ? delta >= 0 : null;
  // Verde = movimento bom, não movimento para cima.
  const positivo = subiu === null ? null : subiu === deltaBom;

  return (
    <motion.div  className={cx('card-crystal min-w-0 p-5', className)}>
      <div className={cx('flex items-start max-sm:flex-col max-sm:gap-2.5', compacto ? 'gap-2.5' : 'gap-3.5')}>
        <span className={cx('icon-tile', compacto && 'h-8 w-8', tom !== 'brand' && `icon-tile-${tom}`)}>
          <Icon name={icon} size={compacto ? 16 : 19} />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cx('font-medium text-muted', compacto ? 'text-[12px] leading-snug' : 'truncate text-[13px]')}>
            {label}
          </p>
          <p className={cx('mt-1 text-fg', compacto ? 'text-[22px] font-bold tabular tracking-tight' : 't-kpi')}>
            <ContaNumero value={value} />
          </p>
          {(typeof delta === 'number' || comparacao) && (
            <p className={cx('flex flex-wrap items-center gap-x-1.5 gap-y-0.5', compacto ? 'mt-1.5' : 'mt-2')}>
              {typeof delta === 'number' && (
                <span className={cx('delta', positivo ? 'delta-up' : 'delta-down')}>
                  <Icon name={subiu ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.4} />
                  {Math.abs(delta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
                </span>
              )}
              {comparacao && <span className="text-xs text-muted">{comparacao}</span>}
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/**
 * Pílula de status com tom semântico.
 */
export function StatusPill({
  children,
  tom = 'neutral',
  icon,
  className,
}: {
  children: ReactNode;
  tom?: Tom;
  icon?: IconName;
  className?: string;
}) {
  return (
    <span className={cx('pill', tom !== 'neutral' && `pill-${tom}`, className)}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/**
 * Delta isolado (↑12%) para usar dentro de tabelas e listas.
 */
export function Delta({ value, bom = true }: { value: number; bom?: boolean }) {
  const subiu = value >= 0;
  const positivo = subiu === bom;
  return (
    <span className={cx('delta', positivo ? 'delta-up' : 'delta-down')}>
      <Icon name={subiu ? 'arrowUp' : 'arrowDown'} size={12} strokeWidth={2.4} />
      {Math.abs(value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%
    </span>
  );
}

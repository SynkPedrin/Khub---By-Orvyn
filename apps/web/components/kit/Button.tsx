'use client';

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { cx } from '@/components/ui';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'ai';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `primary` = a ação principal da tela (uma só); `secondary` = botão de vidro neutro. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Mostra o indicador, trava o botão e marca `aria-busy`. O rótulo continua visível. */
  loading?: boolean;
  /** Ícone à esquerda do rótulo. */
  icon?: IconName;
  /** Ícone à direita (ex.: `arrowRight`). */
  iconRight?: IconName;
  /** Botão só com ícone: exige `aria-label`. */
  iconOnly?: boolean;
  children?: ReactNode;
}

const CLASSE: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: '',
  soft: 'btn-soft',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  ai: 'btn-ai',
};

/** Indicador de carregamento do tamanho do texto (herda a cor do botão). */
export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

/**
 * Botão do kit sobre as classes `.btn*` do design system (ADR-0036).
 * `type="button"` por padrão: dentro de `<form>` só envia quem pedir `type="submit"`.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, iconRight, iconOnly = false, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const tamIcone = size === 'sm' ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={cx('btn', CLASSE[variant], size === 'sm' && 'btn-sm', iconOnly && 'btn-icon', className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} size={tamIcone} /> : null}
      {children}
      {iconRight && !loading && <Icon name={iconRight} size={tamIcone} />}
    </button>
  );
});

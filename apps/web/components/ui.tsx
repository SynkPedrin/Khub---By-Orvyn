import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'ghost' | 'soft';
export function Button({
  variant = 'primary',
  className,
  children,
  ...rest
}: { variant?: Variant } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cx('btn', `btn-${variant}`, className)} {...rest}>
      {children}
    </button>
  );
}

export const Card = forwardRef<HTMLDivElement, { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>>(function Card({ className, children, ...rest }, ref) {
  return <div ref={ref} className={cx('card', className)} {...rest}>{children}</div>;
});

export function Badge({ children, tone = 'brand', className }: { children: ReactNode; tone?: 'brand' | 'green' | 'amber' | 'neutral'; className?: string }) {
  // Tokens de status (Q1.9): claro e escuro vêm de globals.css, sem cor literal.
  const tones: Record<string, string> = {
    brand: 'text-brand',
    green: 'text-success',
    amber: 'text-warning',
    neutral: 'text-muted',
  };
  const bg: Record<string, string> = {
    brand: 'bg-brand-soft',
    green: 'bg-success-soft',
    amber: 'bg-warning-soft',
    neutral: 'bg-surface3',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', tones[tone], bg[tone], className)}>
      {children}
    </span>
  );
}

/**
 * Cores de avatar. Mesma família da paleta de gráficos (passos escuros o
 * bastante para texto branco em cima manter contraste AA). Determinístico
 * pelo nome: a mesma pessoa tem sempre a mesma cor, em qualquer tela.
 */
const AV_COLORS = ['#6c2bff', '#b45309', '#0284c7', '#047857', '#7c3aed', '#be123c', '#0f766e', '#a16207'];
export function Avatar({ name, size = 36, src, onError }: { name: string; size?: number; src?: string; onError?: () => void }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('');
  const color = AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={size} height={size} onError={onError} className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />;
  }
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.4 }}
    >
      {initials || '?'}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('input', className)} {...props} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

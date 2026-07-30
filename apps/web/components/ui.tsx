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

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return <div className={cx('card', className)} {...rest}>{children}</div>;
}

export function Badge({ children, tone = 'brand', className }: { children: ReactNode; tone?: 'brand' | 'green' | 'amber' | 'neutral'; className?: string }) {
  const tones: Record<string, string> = {
    brand: 'text-brand',
    green: 'text-emerald-600 dark:text-emerald-400',
    amber: 'text-amber-600 dark:text-amber-400',
    neutral: 'text-muted',
  };
  const bg: Record<string, string> = {
    brand: 'bg-brand/10',
    green: 'bg-emerald-500/12',
    amber: 'bg-amber-500/14',
    neutral: 'bg-surface3',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold', tones[tone], bg[tone], className)}>
      {children}
    </span>
  );
}

const AV_COLORS = ['#7B2EFF', '#A66BFF', '#6A1FE6', '#C0392B', '#2E86C1', '#1E8449', '#B7791F', '#8E44AD'];
export function Avatar({ name, size = 36, src }: { name: string; size?: number; src?: string }) {
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map((n) => n[0]?.toUpperCase()).join('');
  const color = AV_COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % AV_COLORS.length];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />;
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

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {action}
    </div>
  );
}

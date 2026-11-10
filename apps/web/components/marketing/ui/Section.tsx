import type { ReactNode } from 'react';

/**
 * Casca de seção — controla o ritmo vertical da página inteira num só
 * lugar. `tone="dark"` marca a seção com `data-lp-dark`, que a Revenue
 * Spine observa para inverter a cor da linha ao atravessar a ruptura
 * cromática do Pipeline.
 */
export function Section({
  id,
  children,
  className = '',
  tone = 'light',
  space = 'lg',
}: {
  id?: string;
  children: ReactNode;
  className?: string;
  tone?: 'light' | 'warm' | 'dark';
  space?: 'sm' | 'md' | 'lg' | 'xl' | 'none';
}) {
  const pad = {
    none: '',
    sm: 'py-[clamp(44px,5vw,68px)]',
    md: 'py-[clamp(60px,6.6vw,92px)]',
    lg: 'py-[clamp(76px,8.6vw,124px)]',
    xl: 'py-[clamp(96px,11vw,160px)]',
  }[space];

  const tones = {
    light: '',
    warm: 'bg-[var(--lp-bg-warm)]',
    dark: 'bg-[var(--lp-graphite)] text-[var(--lp-on-dark)]',
  }[tone];

  return (
    <section
      id={id}
      data-lp-dark={tone === 'dark' ? '' : undefined}
      className={`relative ${pad} ${tones} ${className}`}
    >
      {children}
    </section>
  );
}

/** Régua fina de 1px — a mesma hairline do produto, usada como divisor
 *  editorial em vez de borda de card. */
export function Rule({ className = '', tone = 'light' }: { className?: string; tone?: 'light' | 'dark' }) {
  return (
    <div
      aria-hidden
      className={`h-px w-full ${tone === 'dark' ? 'bg-[var(--lp-rule-dark)]' : 'bg-[var(--lp-rule)]'} ${className}`}
    />
  );
}

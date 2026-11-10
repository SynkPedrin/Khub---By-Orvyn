'use client';

import { motion, type Variants } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { useMemo, type ReactNode } from 'react';
import { clipReveal, fadeUp, fadeUpSm, fadeIn, shotReveal, viewportOnce } from '@/lib/marketing/motion';

const VARIANTS = {
  up: fadeUp,
  upSm: fadeUpSm,
  fade: fadeIn,
  clip: clipReveal,
  shot: shotReveal,
} as const;

/**
 * Entrada em scroll.
 *
 * O `delay` é injetado dentro do próprio variant: em Framer Motion o
 * `transition` declarado no variant vence o `transition` passado como
 * prop, então `transition={{ delay }}` ao lado de um variant que já traz
 * `transition` simplesmente não faz nada (era o bug silencioso da V1 —
 * todos os stagger "existiam" mas entravam juntos).
 *
 * Com `prefers-reduced-motion` renderiza o estado final direto, sem
 * `whileInView` e sem `clip-path` residual.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  variant = 'up',
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: keyof typeof VARIANTS;
  as?: 'div' | 'span' | 'li' | 'p' | 'section';
}) {
  const reduced = useReducedMotionSafe();

  const variants = useMemo<Variants>(() => {
    const base = VARIANTS[variant];
    if (!delay) return base;
    const show = base.show as Record<string, unknown>;
    return {
      ...base,
      show: { ...show, transition: { ...(show.transition as object), delay } },
    };
  }, [variant, delay]);

  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  const MotionTag = motion[as];
  return (
    <MotionTag className={className} variants={variants} initial="hidden" whileInView="show" viewport={viewportOnce}>
      {children}
    </MotionTag>
  );
}

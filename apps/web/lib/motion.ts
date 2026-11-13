import type { Transition, Variants } from 'framer-motion';

/**
 * Presets centralizados de motion — nenhum componente inventa duração/easing
 * próprios. Calibrado pra ficar sutil (150–400ms, sem bounce), não pra imitar
 * literalmente o vídeo de referência.
 */
export const motionTokens = {
  duration: {
    instant: 0.12,
    fast: 0.18,
    normal: 0.28,
    slow: 0.42,
  },
  easing: {
    standard: [0.22, 1, 0.36, 1] as const,
  },
  spring: {
    soft: { type: 'spring', stiffness: 280, damping: 28 } satisfies Transition,
    responsive: { type: 'spring', stiffness: 360, damping: 32 } satisfies Transition,
  },
};

/**
 * Transição de página: fade + leve deslocamento vertical (6px, ADR-0036).
 *
 * Sem blur (Q1.7): `filter` na página inteira custava repintura em telas
 * densas e, enquanto durava, fazia do wrapper um containing block para
 * `position: fixed` e um backdrop root (o vidro dos sheets não desfocava).
 * `transitionEnd` remove o transform ao terminar pelo mesmo motivo.
 * Com "Reduzir movimento" o `MotionConfig reducedMotion="user"` do layout
 * logado desliga o deslocamento.
 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 6 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.normal, ease: motionTokens.easing.standard },
    transitionEnd: { transform: 'none' },
  },
};

/** Elevação sutil em hover de card (2px — ADR-0036) — usar com `whileHover`, nunca scale. */
export const cardHover = {
  y: -2,
  transition: motionTokens.spring.soft,
};

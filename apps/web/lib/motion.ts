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
 * Transição de página: fade + leve deslocamento vertical + blur sutil.
 *
 * `transitionEnd` remove filtro e transform ao terminar. Deixar
 * `filter: blur(0px)` inline (como antes) fazia do wrapper da página um
 * containing block para `position: fixed` — o overlay dos modais cobria só
 * o `<main>`, não a sidebar/topbar — e um backdrop root, que impedia o
 * vidro dos sheets de desfocar o que está atrás (ADR-0029).
 */
export const pageVariants: Variants = {
  initial: { opacity: 0, y: 10, filter: 'blur(4px)' },
  animate: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: motionTokens.duration.normal, ease: motionTokens.easing.standard },
    transitionEnd: { filter: 'none', transform: 'none' },
  },
};

/** Elevação sutil em hover de card (2px — ADR-0036) — usar com `whileHover`, nunca scale. */
export const cardHover = {
  y: -2,
  transition: motionTokens.spring.soft,
};

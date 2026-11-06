import type { Transition, Variants } from 'framer-motion';

/**
 * Sistema de motion da landing page.
 *
 * DECISÃO — Remotion (vídeo pré-renderizado) vs. Framer Motion ao vivo:
 * os "momentos de filme" desta página (o Revenue Flow de seis estágios e
 * a sequência tipográfica final) são dirigidos pela POSIÇÃO DO SCROLL, e
 * um MP4 não faz isso sem scrubbing de vídeo — que custa alguns MB por
 * filme, engasga em seek no mobile e, pior, re-encoda as capturas do
 * produto (justamente o que não pode: a tela real é o assunto e precisa
 * ficar pixel-perfeita). O caminho escolhido é Framer Motion + `useScroll`
 * sobre os PNGs reais: as telas continuam nítidas, a coreografia responde
 * ao usuário e o custo é ~0 além da lib que o projeto já tem. GSAP também
 * foi descartado: nada aqui precisa de timeline própria, `useScroll` +
 * `useTransform` cobrem a coreografia sticky inteira.
 *
 * Regras (as mesmas do produto): entrada é opacity + translateY curto
 * (≤ 24px) e/ou revelação por `clip-path`. Nada de spring elástico,
 * bounce, rotação de entrada ou "parque de diversões" — a página tem que
 * parecer editorial, não animada.
 *
 * `prefers-reduced-motion` é respeitado em duas camadas: o CSS global
 * (`app/globals.css`) zera durações de animação/transição, e os
 * componentes que dependem de scroll (`Reveal`, sequências sticky)
 * checam `useReducedMotion` para renderizar o estado final direto.
 */

/** Easing padrão — desacelera longo, sem overshoot. */
export const LP_EASE = [0.22, 0.61, 0.24, 1] as const;
/** Easing de saída rápida usado em cross-fade de screenshot. */
export const LP_EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const lpTransition = (duration = 0.62, delay = 0): Transition => ({
  duration,
  delay,
  ease: LP_EASE,
});

/** Entrada base: sobe 20px e aparece. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: lpTransition(0.66) },
};

/** Entrada curta, para itens dentro de uma lista com stagger. */
export const fadeUpSm: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: lpTransition(0.5) },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: lpTransition(0.7) },
};

/**
 * Revelação por máscara — a linha de texto emerge de baixo para cima em
 * vez de simplesmente aparecer. Usada nas headlines monumentais, onde um
 * fade puro fica sem peso.
 */
export const clipReveal: Variants = {
  hidden: { opacity: 0, y: 24, clipPath: 'inset(100% 0% 0% 0%)' },
  show: {
    opacity: 1,
    y: 0,
    clipPath: 'inset(-12% 0% 0% 0%)',
    transition: { duration: 0.9, ease: LP_EASE },
  },
};

/** Screenshot entrando: escala quase imperceptível + subida curta. */
export const shotReveal: Variants = {
  hidden: { opacity: 0, y: 24, scale: 0.985 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.85, ease: LP_EASE } },
};

/** Linha (a Revenue Spine) sendo desenhada de cima para baixo. */
export const drawLine: Variants = {
  hidden: { scaleY: 0 },
  show: { scaleY: 1, transition: { duration: 1, ease: LP_EASE } },
};

export const stagger = (children = 0.075, delayChildren = 0): Variants => ({
  hidden: {},
  show: { transition: { staggerChildren: children, delayChildren } },
});

export const viewportOnce = { once: true, margin: '-12% 0px -12% 0px' } as const;
export const viewportOnceEarly = { once: true, margin: '0px 0px -5% 0px' } as const;

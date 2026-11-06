'use client';

import { motion, useScroll, useSpring, useTransform } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { useEffect, useState } from 'react';

/**
 * A Revenue Spine — a linha contínua que atravessa a página inteira.
 *
 * Não é ornamento: é o progresso real do scroll, e o mesmo fio que
 * reaparece dentro das seções (a coluna vertical das Automações, o trilho
 * horizontal do Revenue Flow, o traço que liga a sequência final ao
 * logo). Aqui ela é o trilho de borda: 1px, ametista, travando na
 * margem esquerda da página.
 *
 * Ao entrar numa seção graphite (`data-lp-dark`), o trilho inverte para
 * não sumir no fundo escuro — por isso o IntersectionObserver.
 */
export function RevenueSpine() {
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 40, mass: 0.4 });
  const headTop = useTransform(progress, (v) => `${v * 100}%`);
  const [onDark, setOnDark] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const alvos = Array.from(document.querySelectorAll('[data-lp-dark]'));
    if (alvos.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        // A linha vive no meio da viewport: uma seção só "manda" na cor
        // quando de fato cobre esse ponto.
        setOnDark(entries.some((e) => e.isIntersecting));
      },
      { rootMargin: '-50% 0px -50% 0px', threshold: 0 },
    );
    alvos.forEach((a) => io.observe(a));
    return () => io.disconnect();
  }, []);

  if (reduced) return null;

  return (
    <div className="pointer-events-none" aria-hidden>
      <div
        className="lp-spine-rail hidden sm:block"
        style={{ background: onDark ? 'rgba(248,246,242,0.16)' : 'var(--lp-spine-track)' }}
      >
        <motion.span
          className="absolute left-0 top-0 block w-px origin-top"
          style={{
            height: '100%',
            scaleY: progress,
            background: 'linear-gradient(180deg, rgba(123,46,255,0.18), var(--lp-accent))',
          }}
        />
        <motion.span
          className="absolute left-[-2px] block h-10 w-[5px] rounded-full"
          style={{
            top: headTop,
            background: 'var(--lp-accent)',
            boxShadow: '0 0 0 1px rgba(123,46,255,0.18)',
            marginTop: -20,
          }}
        />
      </div>
    </div>
  );
}

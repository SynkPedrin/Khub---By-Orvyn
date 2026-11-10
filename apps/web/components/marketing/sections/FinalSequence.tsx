'use client';

import { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { Wordmark } from '@/components/marketing/ui/Wordmark';
import { LP_EASE } from '@/lib/marketing/motion';

const FRASES = ['Gerar demanda.', 'Fazer o lead andar.', 'Transformar em receita.'] as const;
const PASSOS = FRASES.length + 1;

/**
 * Sequência final tipográfica.
 *
 * Uma frase por trecho de scroll, no mesmo eixo da tela, terminando no
 * wordmark — é onde a Revenue Spine fecha: a linha vertical desce
 * acompanhando o progresso e, no último passo, vira na horizontal para
 * encostar na marca.
 *
 * Com `prefers-reduced-motion` a seção vira uma lista estática, sem
 * sticky e sem troca: o conteúdo continua legível e completo.
 */
export function FinalSequence() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [passo, setPasso] = useState(0);
  // A linha tem que CHEGAR na marca quando a marca aparece (último passo),
  // não no último pixel absoluto da seção — senão a conexão nunca é vista.
  const spine = useTransform(scrollYProgress, [0, (PASSOS - 1) / PASSOS], [0, 1], { clamp: true });

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    setPasso(Math.min(PASSOS - 1, Math.max(0, Math.floor(v * PASSOS * 0.999))));
  });

  if (reduced) {
    return (
      <section className="py-[clamp(80px,9vw,128px)]">
        <Container>
          <ul className="flex flex-col gap-3">
            {FRASES.map((f) => (
              <li key={f} className="lp-h2 text-[var(--lp-ink)]">
                {f}
              </li>
            ))}
          </ul>
          <div className="mt-12">
            <Wordmark height={34} />
          </div>
        </Container>
      </section>
    );
  }

  const naMarca = passo === FRASES.length;

  return (
    <div ref={ref} style={{ height: `calc(100svh + ${PASSOS * 42}svh)` }} className="relative">
      <div className="sticky top-0 flex h-svh items-center overflow-hidden">
        <Container className="w-full">
          <div className="relative pl-[clamp(22px,3.4vw,64px)]">
            <div className="relative flex h-[clamp(140px,26vh,280px)] items-center">
              {/* A Revenue Spine chegando ao fim: desce de fora da tela e
                  para exatamente na altura da marca, onde vira na
                  horizontal e encosta nela. */}
              <motion.span
                aria-hidden
                className="absolute block w-px origin-top bg-[var(--lp-accent)]"
                style={{
                  left: 'calc(-1 * clamp(22px, 3.4vw, 64px))',
                  bottom: '50%',
                  height: '120vh',
                  scaleY: spine,
                }}
              />
              <motion.span
                aria-hidden
                className="absolute block h-px origin-left bg-[var(--lp-accent)]"
                style={{
                  left: 'calc(-1 * clamp(22px, 3.4vw, 64px))',
                  top: 'calc(50% - 0.5px)',
                  width: 'clamp(22px, 3.4vw, 64px)',
                }}
                initial={false}
                animate={{ scaleX: naMarca ? 1 : 0 }}
                transition={{ duration: 0.5, ease: LP_EASE }}
              />
              {FRASES.map((f, i) => (
                <motion.p
                  key={f}
                  className="absolute inset-x-0 text-[clamp(40px,7.4vw,108px)] font-semibold leading-[0.94] tracking-[-0.048em] text-[var(--lp-ink)]"
                  initial={false}
                  animate={{
                    opacity: passo === i ? 1 : 0,
                    y: passo === i ? 0 : passo > i ? -26 : 26,
                  }}
                  transition={{ duration: 0.6, ease: LP_EASE }}
                  aria-hidden={passo !== i}
                >
                  {f}
                </motion.p>
              ))}

              {/* O wrapper carrega o posicionamento; o `motion.div` só
                  anima. Transform do Tailwind e do Framer no mesmo
                  elemento se anulam. A marca fica centrada na altura em
                  que a spine vira, para a linha encostar nela. */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-[31px]">
                <motion.div
                  initial={false}
                  animate={{ opacity: naMarca ? 1 : 0, y: naMarca ? 0 : 26 }}
                  transition={{ duration: 0.7, ease: LP_EASE }}
                  aria-hidden={!naMarca}
                >
                  <Wordmark height={62} label="" />
                  <span className="mt-6 block text-[14px] tracking-[-0.01em] text-[var(--lp-ink-3)]">
                    Sistema para um crescimento real.
                  </span>
                </motion.div>
              </div>
            </div>

            {/* A sequência inteira existe no DOM para leitores de tela,
                mesmo quando só uma frase está visível. */}
            <p className="sr-only">Gerar demanda. Fazer o lead andar. Transformar em receita. KHUB.</p>

            <div className="mt-[clamp(28px,4vh,56px)] flex gap-2" aria-hidden>
              {Array.from({ length: PASSOS }).map((_, i) => (
                <span
                  key={i}
                  className="block h-px w-10 transition-colors duration-500"
                  style={{ background: i <= passo ? 'var(--lp-accent)' : 'var(--lp-rule)' }}
                />
              ))}
            </div>
          </div>
        </Container>
      </div>
    </div>
  );
}

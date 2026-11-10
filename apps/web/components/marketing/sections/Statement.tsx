'use client';

import { motion } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { LP_EASE } from '@/lib/marketing/motion';

/**
 * Respiro editorial entre o hero e o Revenue Flow. Quase sem interface:
 * só tipografia grande, um traço e uma nota curta. É aqui que a Revenue
 * Spine aparece pela primeira vez dentro do conteúdo — desenhada de cima
 * para baixo conforme a seção entra.
 */
export function Statement() {
  const reduced = useReducedMotionSafe();

  return (
    <Section space="xl" className="overflow-hidden">
      <Container>
        <div className="grid gap-[clamp(40px,6vw,88px)] lg:grid-cols-[1fr_minmax(240px,300px)] lg:items-end">
          <div className="relative">
            <motion.span
              aria-hidden
              className="absolute -left-[clamp(18px,2.6vw,40px)] top-1 hidden w-px origin-top bg-[var(--lp-accent)] sm:block"
              style={{ height: 'clamp(90px, 12vw, 190px)' }}
              {...(reduced
                ? {}
                : {
                    initial: { scaleY: 0, opacity: 0.4 },
                    whileInView: { scaleY: 1, opacity: 1 },
                    viewport: { once: true, margin: '-20% 0px' },
                    transition: { duration: 1.05, ease: LP_EASE },
                  })}
            />

            <h2 className="lp-h2 max-w-[16ch] text-[var(--lp-ink)]">
              <Reveal variant="clip" as="span" className="block">
                O clique termina.
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.12} className="block text-[var(--lp-ink-3)]">
                A operação começa.
              </Reveal>
            </h2>
          </div>

          <Reveal delay={0.24}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              Mídia paga, formulário, indicação, direct. Tudo isso entrega a mesma coisa: um nome e um
              horário. O que vem depois, responder, qualificar, marcar, cobrar, fechar e medir, é onde a
              receita é ganha ou perdida. É exatamente esse trecho que o KHUB opera.
            </p>
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

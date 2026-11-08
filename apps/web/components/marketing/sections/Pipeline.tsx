'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { SCREENS } from '@/lib/marketing/screens';

/**
 * Pipeline — a única ruptura cromática da página.
 *
 * Fundo graphite (#151219), tipografia off-white, régua ametista. A tela
 * clara do produto vira a fonte de luz da seção: o contraste faz o
 * Kanban real saltar sem precisar de glow nenhum.
 *
 * Motion: camera push discreto (0.965 → 1) enquanto a seção sobe, e um
 * varrimento horizontal de luz que cruza a tela uma vez — sem loop,
 * sem piscar.
 */
export function Pipeline() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'center center'] });
  const scale = useTransform(scrollYProgress, [0, 1], [0.965, 1]);
  const opacity = useTransform(scrollYProgress, [0, 0.35], [0.4, 1]);

  return (
    <Section id="pipeline" tone="dark" space="xl" className="overflow-hidden">
      <Container>
        <div className="grid gap-[clamp(32px,4vw,72px)] lg:grid-cols-[1fr_minmax(240px,400px)] lg:items-end">
          <h2 className="lp-h2 max-w-[13ch] text-[var(--lp-on-dark)]">
            <Reveal variant="clip" as="span" className="block">
              Onde o
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.1} className="block">
              atendimento
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.2} className="block">
              vira previsão.
            </Reveal>
          </h2>
          <Reveal delay={0.2}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-on-dark-2)]">
              Cada oportunidade carrega valor, etapa, dono e a conversa que a originou. Valor em pipeline,
              ticket médio e ciclo de vendas saem disso, não de um fechamento manual no fim do mês.
            </p>
          </Reveal>
        </div>
      </Container>

      <div ref={ref} className="relative mt-[clamp(48px,6vw,96px)]">
        <div className="relative mx-auto w-[min(90vw,1560px)]">
          <motion.div style={reduced ? undefined : { scale, opacity }} className="relative">
            <ProductShot
              screen={SCREENS.pipeline}
              dark
              sizes="90vw"
              quality={94}
              focusMobile={{ x: 0.38, y: 0.5, scale: 2.4 }}
            />

            {/* Varrimento de luz — uma passada só, quando a seção entra. */}
            {!reduced && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-0 z-[3] block w-[38%] rounded-[12px]"
                style={{
                  background:
                    'linear-gradient(105deg, transparent, rgba(255,255,255,0.28) 45%, rgba(123,46,255,0.16) 62%, transparent)',
                  mixBlendMode: 'screen',
                }}
                initial={{ x: '-120%', opacity: 0 }}
                whileInView={{ x: '320%', opacity: [0, 1, 1, 0] }}
                viewport={{ once: true, margin: '-25% 0px' }}
                transition={{ duration: 1.5, ease: [0.4, 0, 0.2, 1], delay: 0.25 }}
              />
            )}
          </motion.div>
        </div>

        <Container className="mt-[clamp(40px,5vw,72px)]">
          <ul className="grid gap-px overflow-hidden border-y border-[var(--lp-rule-dark)] sm:grid-cols-3">
            {[
              ['Etapas configuráveis', 'Entrada, qualificação, reunião, proposta, negociação, fechamento, do jeito que a sua operação já fala.'],
              ['Valor por etapa', 'O funil mostra quanto está parado em cada estágio, não só quantos cartões existem.'],
              ['Contexto junto', 'Abrir um cartão abre a conversa, as tarefas e a campanha que trouxe aquele lead.'],
            ].map(([titulo, texto], i) => (
              <Reveal
                key={titulo}
                delay={i * 0.08}
                as="li"
                className="py-7 sm:px-7 sm:first:pl-0 sm:last:pr-0 sm:[&:not(:first-child)]:border-l sm:[&:not(:first-child)]:border-[var(--lp-rule-dark)]"
              >
                <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--lp-on-dark)]">{titulo}</h3>
                <p className="mt-2 text-[13.5px] leading-[1.6] text-[var(--lp-on-dark-2)]">{texto}</p>
              </Reveal>
            ))}
          </ul>
        </Container>
      </div>
    </Section>
  );
}

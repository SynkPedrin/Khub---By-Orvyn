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
 * O momento em que o produto ocupa a tela.
 *
 * O Dashboard real toma ~90vw e a página quase desaparece em volta. Os
 * callouts ficam numa régua logo abaixo, cada um alinhado com a coluna da
 * interface que descreve e ligado a ela por um traço de 1px — em vez de
 * flutuarem POR CIMA da captura, que foi como a primeira versão desta
 * seção acabou cobrindo justamente o que queria mostrar.
 *
 * Nenhum número inventado: tudo o que o texto cita está visível na tela.
 */
const CALLOUTS = [
  {
    texto: 'Leads do dia, taxa de resposta, follow-ups pendentes e receita gerada na mesma régua.',
    alinha: 'items-start text-left',
  },
  {
    texto: 'Pipeline por etapa e crescimento de receita lado a lado, mesma base, mesma leitura.',
    alinha: 'items-start text-left',
  },
  {
    texto: 'Recomendações da NICO sobre a operação real, com a ação a um clique de distância.',
    alinha: 'items-start text-left',
  },
] as const;

export function ProductMoment() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], [34, -34]);

  return (
    <Section id="produto" space="lg" className="overflow-hidden">
      <Container className="pb-[clamp(36px,4.5vw,64px)]">
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(240px,380px)] lg:items-end">
          <h2 className="lp-h2 max-w-[14ch] text-[var(--lp-ink)]">
            <Reveal variant="clip" as="span" className="block">
              Uma tela para
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.1} className="block">
              decidir o dia.
            </Reveal>
          </h2>
          <Reveal delay={0.16}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              Não é painel de vaidade. É a fila do dia: quem respondeu, quem travou, o que fecha esta semana e
              o que a NICO já marcou como risco.
            </p>
          </Reveal>
        </div>
      </Container>

      <div ref={ref} className="relative mx-auto w-[min(90vw,1680px)]">
        <motion.div style={reduced ? undefined : { y }}>
          <Reveal variant="shot">
            <ProductShot
              screen={SCREENS.dashboard}
              sizes="90vw"
              quality={94}
              focusMobile={{ x: 0.55, y: 0.45, scale: 2.3 }}
            />
          </Reveal>
        </motion.div>

        {/* Régua de leitura — alinhada às colunas da interface acima. */}
        <ul className="mt-7 grid gap-6 sm:grid-cols-3 sm:gap-[clamp(20px,3vw,56px)]">
          {CALLOUTS.map((c, i) => (
            <Reveal key={c.texto} as="li" delay={i * 0.08} className={`flex flex-col ${c.alinha}`}>
              <span aria-hidden className="mb-3 block h-4 w-px bg-[var(--lp-accent-line)]" />
              <span className="block max-w-[38ch] text-[13.5px] leading-[1.55] text-[var(--lp-ink-2)]">
                {c.texto}
              </span>
            </Reveal>
          ))}
        </ul>
      </div>
    </Section>
  );
}

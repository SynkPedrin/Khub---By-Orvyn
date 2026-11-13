'use client';

import Image from 'next/image';
import { motion } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { Wordmark } from '@/components/marketing/ui/Wordmark';
import { LP_EASE } from '@/lib/marketing/motion';

/** Entradas: canais que a KHUB conecta. Logo real onde existe arquivo de
 *  marca no repositório; nome tipográfico onde não existe — nenhuma marca
 *  é redesenhada nem aproximada. */
const ENTRADAS = [
  { nome: 'WhatsApp', logo: '/lp-revenue/providers/whatsapp.png', x: '7%' },
  { nome: 'Instagram', logo: '/lp-revenue/providers/instagram.png', x: '26%' },
  { nome: 'Meta Ads', logo: null, x: '74%' },
  { nome: 'Google Ads', logo: null, x: '93%' },
] as const;

/** Saídas: o que a KHUB devolve para a operação. Deslocadas em relação
 *  às entradas para que as descidas nunca caiam no mesmo x (dois pontos
 *  colados na linha viram ruído, não diagrama). */
const SAIDAS = [
  { nome: 'Lead', x: '16.5%' },
  { nome: 'Conversa', x: '35.5%' },
  { nome: 'Pipeline', x: '64.5%' },
  { nome: 'Receita', x: '83.5%' },
] as const;

/**
 * Integrações como canvas horizontal, não como grade de cards.
 *
 * A própria Revenue Spine é o eixo: a linha atravessa a seção de ponta a
 * ponta, os canais descem até ela e o que a operação recebe sai dela. A
 * KHUB fica no centro, sobre a linha.
 */
export function Integrations() {
  const reduced = useReducedMotionSafe();

  return (
    <Section id="integracoes" space="lg" className="overflow-hidden">
      <Container>
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(240px,400px)] lg:items-end">
          <h2 className="lp-h3 max-w-[16ch] text-[var(--lp-ink)]">
            <Reveal variant="clip" as="span" className="block">
              A operação não muda
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.1} className="block">
              de lugar.
            </Reveal>
          </h2>
          <Reveal delay={0.16}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              Os canais onde o cliente já fala continuam sendo os mesmos. O que muda é onde essa conversa é
              registrada, priorizada e cobrada.
            </p>
          </Reveal>
        </div>

        {/* ---------- Canvas horizontal (md+) ---------- */}
        <div className="relative mt-[clamp(56px,7vw,104px)] hidden h-[248px] md:block">
          <motion.div
            className="absolute left-0 top-1/2 h-px w-full origin-left bg-[var(--lp-accent-line)]"
            aria-hidden
            {...(reduced
              ? {}
              : {
                  initial: { scaleX: 0 },
                  whileInView: { scaleX: 1 },
                  viewport: { once: true, margin: '-20% 0px' },
                  transition: { duration: 1.2, ease: LP_EASE },
                })}
          />

          {/* `bottom-1/2` ancora a BASE do grupo exatamente na linha: é o
              que garante que o ponto caia em cima do trilho em qualquer
              largura, em vez de depender da soma das alturas. */}
          {ENTRADAS.map((e, i) => (
            <div key={e.nome} className="absolute bottom-1/2 -translate-x-1/2" style={{ left: e.x }}>
              <Reveal delay={0.25 + i * 0.07} className="flex flex-col items-center">
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {e.logo ? (
                    <Image src={e.logo} alt="" width={36} height={36} className="h-[18px] w-[18px] object-contain" />
                  ) : null}
                  <span className="text-[13.5px] font-medium text-[var(--lp-ink)]">{e.nome}</span>
                </span>
                <span className="mt-3 block h-[92px] w-px bg-[var(--lp-rule)]" aria-hidden />
                <span className="-mb-[3px] block h-[6px] w-[6px] rounded-full bg-[var(--lp-accent)]" aria-hidden />
              </Reveal>
            </div>
          ))}

          {/* Centro — a marca sobre a linha.
              O posicionamento fica no wrapper, nunca no `Reveal`: o
              Framer Motion escreve `transform` inline e apagaria um
              `-translate-*` do Tailwind aplicado no mesmo elemento. */}
          <div className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2">
            <Reveal delay={0.2} className="bg-[var(--lp-bg)] px-8 py-3">
              <Wordmark height={20} label="" />
            </Reveal>
          </div>

          {SAIDAS.map((s, i) => (
            <div key={s.nome} className="absolute top-1/2 -translate-x-1/2" style={{ left: s.x }}>
              <Reveal delay={0.45 + i * 0.07} className="flex flex-col items-center">
                <span className="-mt-[3px] block h-[6px] w-[6px] rounded-full bg-[var(--lp-accent)]" aria-hidden />
                <span className="block h-[92px] w-px bg-[var(--lp-rule)]" aria-hidden />
                <span className="mt-3 whitespace-nowrap text-[13.5px] font-medium text-[var(--lp-ink-2)]">
                  {s.nome}
                </span>
              </Reveal>
            </div>
          ))}
        </div>

        {/* ---------- Mobile: a mesma linha, na vertical ---------- */}
        <div className="relative mt-14 md:hidden">
          <div className="absolute bottom-3 left-[5px] top-3 w-px bg-[var(--lp-accent-line)]" aria-hidden />
          <div className="flex flex-col gap-7 pl-8">
            <p className="lp-label">Entra</p>
            {ENTRADAS.map((e) => (
              <div key={e.nome} className="relative flex items-center gap-2.5">
                <span
                  aria-hidden
                  className="absolute -left-8 block h-[5px] w-[5px] translate-x-[3px] rounded-full bg-[var(--lp-accent)]"
                />
                {e.logo ? (
                  <Image src={e.logo} alt="" width={36} height={36} className="h-[18px] w-[18px] object-contain" />
                ) : null}
                <span className="text-[15px] font-medium text-[var(--lp-ink)]">{e.nome}</span>
              </div>
            ))}

            <div className="relative py-2">
              <span
                aria-hidden
                className="absolute -left-8 top-1/2 block h-[9px] w-[9px] -translate-y-1/2 translate-x-[1px] rounded-full bg-[var(--lp-accent)]"
              />
              <Wordmark height={18} label="" />
            </div>

            <p className="lp-label">Sai</p>
            {SAIDAS.map((s) => (
              <div key={s.nome} className="relative">
                <span
                  aria-hidden
                  className="absolute -left-8 top-[7px] block h-[5px] w-[5px] translate-x-[3px] rounded-full bg-[var(--lp-accent)]"
                />
                <span className="text-[15px] font-medium text-[var(--lp-ink-2)]">{s.nome}</span>
              </div>
            ))}
          </div>
        </div>
      </Container>
    </Section>
  );
}

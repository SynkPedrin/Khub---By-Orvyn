'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { FrequencyField } from '@/components/landing/FrequencyField';
import { LP_EASE } from '@/lib/marketing/motion';
import { LOGIN_URL, SIGNUP_URL } from '@/lib/marketing/env';

/**
 * Hero do KHUB com a identidade visual da Kroma (ADR-0043): headline
 * monumental em três pesos (bold com degradê, fino, serifa itálica), o K
 * de vidro violeta e lima à direita sobre o campo de frequência, rótulos
 * com ponto lima e botões em pílula. O conteúdo é do KHUB; as telas reais
 * do produto aparecem nas seções seguintes.
 */

/** Capacidades reais do sistema. Nenhuma métrica de cliente, nenhum número inventado. */
const PROVA = ['WhatsApp conectado ao CRM', 'Motor de automação próprio', 'Pipeline e receita nativos'];

export function Hero() {
  const reduced = useReducedMotionSafe();
  const anim = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.9, delay, ease: LP_EASE },
        };

  return (
    <section id="top" className="relative isolate flex min-h-[100svh] flex-col overflow-hidden pb-[clamp(32px,4vw,56px)] pt-[clamp(96px,9vw,128px)]">
      <span className="lp-hero-glow" aria-hidden />
      <FrequencyField className="lp-hero-waves" />
      <motion.div
        aria-hidden
        {...(reduced
          ? {}
          : { initial: { opacity: 0, scale: 0.92 }, animate: { opacity: 1, scale: 1 }, transition: { duration: 1.6, ease: LP_EASE } })}
      >
        <Image src="/landing/k-3d.png" alt="" width={720} height={741} priority className="lp-hero-k" sizes="(min-width: 1024px) 44rem, 80vw" />
      </motion.div>

      <Container className="relative z-10 flex flex-1 flex-col">
        <div className="flex items-center justify-between gap-6">
          <motion.p {...anim(0)} className="lp-label lp-eyebrow">
            CRM, atendimento, automação e IA
          </motion.p>
          <motion.p {...anim(0.06)} className="lp-label hidden sm:block">
            Sistemas para um crescimento
          </motion.p>
        </div>

        <h1 className="lp-display mt-auto pt-[clamp(32px,6vw,80px)] text-[var(--lp-ink)]">
          <motion.span {...anim(0.08)} className="lp-grad-lime block">
            Gerar lead
          </motion.span>
          <motion.span {...anim(0.16)} className="lp-thin block pl-[clamp(0px,9vw,150px)]">
            é apenas
          </motion.span>
          <motion.span {...anim(0.24)} className="block">
            <span className="lp-serif lp-grad-violet">o começo</span>
            <span className="text-[var(--lp-accent)]">.</span>
          </motion.span>
        </h1>

        <div className="mt-[clamp(28px,3.4vw,48px)] border-t border-[var(--lp-rule)] pt-[clamp(22px,2.6vw,34px)]">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <motion.p {...anim(0.32)} className="lp-body max-w-[40ch]">
                O clique você já sabe comprar. O que decide a receita é o que acontece depois: a conversa, o pipeline, o
                follow-up e a leitura do que funcionou.
              </motion.p>
              <motion.ul {...anim(0.38)} className="mt-6 flex flex-col gap-[10px]">
                {PROVA.map((p) => (
                  <li key={p} className="flex items-center gap-3 text-[13px] text-[var(--lp-ink-3)]">
                    <span className="h-px w-5 shrink-0 bg-[var(--lp-accent-line)]" aria-hidden />
                    {p}
                  </li>
                ))}
              </motion.ul>
            </div>
            <motion.div {...anim(0.42)} className="flex flex-wrap items-center gap-3">
              <Link href={SIGNUP_URL} className="lp-cta">
                Criar conta
              </Link>
              <a href="#fluxo" className="lp-cta-quiet">
                Ver o fluxo completo
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M7 1.5v11M2.5 8.5 7 13l4.5-4.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </a>
              <Link href={LOGIN_URL} className="lp-cta-quiet">
                Entrar
              </Link>
            </motion.div>
          </div>
        </div>
      </Container>
    </section>
  );
}

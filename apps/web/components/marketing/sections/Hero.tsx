'use client';

import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { SCREENS } from '@/lib/marketing/screens';
import { LP_EASE } from '@/lib/marketing/motion';
import { LOGIN_URL, SIGNUP_URL } from '@/lib/marketing/env';

/**
 * Hero assimétrico.
 *
 * A headline ocupa a faixa superior esquerda em corpo monumental; a
 * composição de produto entra pela direita, subindo por cima da linha de
 * base da headline (margem negativa) e sangrando para fora do container.
 * Nada de coluna 50/50 centralizada, nada de ilustração: a tela real é o
 * assunto.
 *
 * A Revenue Spine nasce aqui — um traço vertical que desce até encostar
 * na quina superior esquerda do Dashboard.
 */

/** Prova de produto — capacidades reais do sistema. Nenhuma métrica de
 *  cliente, nenhum número inventado: a única prova é o produto. */
const PROVA = ['WhatsApp e Instagram conectados', 'Motor de automação próprio', 'Pipeline e receita nativos'];

export function Hero() {
  const reduced = useReducedMotionSafe();
  const anim = (delay: number) =>
    reduced
      ? {}
      : {
          initial: { opacity: 0, y: 22 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.78, delay, ease: LP_EASE },
        };

  return (
    <section id="top" className="relative overflow-hidden pb-[clamp(48px,5vw,80px)] pt-[clamp(104px,11vw,148px)]">
      <Container>
        {/* ---------- Headline ---------- */}
        <div className="relative z-10">
          <motion.p {...anim(0)} className="lp-label">
            Revenue OS
          </motion.p>

          <h1 className="lp-display mt-[clamp(20px,2.6vw,38px)] text-[var(--lp-ink)]">
            <motion.span {...anim(0.04)} className="block">
              Gerar lead
            </motion.span>
            <motion.span {...anim(0.1)} className="block">
              é apenas
            </motion.span>
            <motion.span {...anim(0.16)} className="block text-[var(--lp-accent)]">
              o começo.
            </motion.span>
          </h1>
        </div>

        {/* ---------- Coluna de apoio + produto ---------- */}
        <div className="mt-[clamp(28px,3vw,44px)] grid gap-[clamp(36px,4vw,60px)] lg:grid-cols-[minmax(300px,40%)_1fr] lg:items-start">
          <div className="relative z-10">
            <motion.p {...anim(0.24)} className="lp-body max-w-[34ch]">
              O clique você já sabe comprar. O que decide a receita é o que acontece depois: a conversa, o
              pipeline, o follow-up e a leitura do que funcionou.
            </motion.p>

            <motion.div {...anim(0.3)} className="mt-[clamp(26px,3vw,38px)] flex flex-wrap items-center gap-5">
              <Link href={SIGNUP_URL} className="lp-cta">
                Criar conta
              </Link>
              <a href="#fluxo" className="lp-cta-quiet">
                Ver o fluxo completo
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
                  <path d="M7 1.5v11M2.5 8.5 7 13l4.5-4.5" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </a>
            </motion.div>

            <motion.ul {...anim(0.38)} className="mt-[clamp(30px,3.4vw,44px)] flex flex-col gap-[10px]">
              {PROVA.map((p) => (
                <li key={p} className="flex items-center gap-3 text-[13px] text-[var(--lp-ink-3)]">
                  <span className="h-px w-5 shrink-0 bg-[var(--lp-accent-line)]" aria-hidden />
                  {p}
                </li>
              ))}
            </motion.ul>
          </div>

          {/* A composição sobe por cima da linha de base da headline. */}
          <motion.div
            {...(reduced
              ? {}
              : {
                  initial: { opacity: 0, y: 34 },
                  animate: { opacity: 1, y: 0 },
                  transition: { duration: 1.05, delay: 0.14, ease: LP_EASE },
                })}
            className="lp-bleed-r relative ml-[calc(var(--lp-gutter)*-1)] lg:ml-0 lg:-mt-[clamp(150px,19vw,290px)]"
          >
            {/* A spine entrando no produto */}
            <div
              className="pointer-events-none absolute left-0 hidden w-px bg-gradient-to-b from-transparent to-[var(--lp-accent-line)] lg:block"
              style={{ height: 'clamp(60px, 8vw, 120px)', top: 'calc(-1 * clamp(60px, 8vw, 120px))' }}
              aria-hidden
            />

            <div className="relative" style={{ perspective: 2600 }}>
              {/* Uma tela de trás só — lâmina fina, legível como "outra
                  tela do mesmo sistema", nunca como card decorativo. */}
              <div
                className="absolute inset-0 hidden lg:block"
                style={{ transform: 'translate3d(3.4%, -4.2%, 0) scale(0.968)' }}
                aria-hidden
              >
                <div className="lp-shot opacity-[0.62]">
                  <div className="absolute inset-0 overflow-hidden">
                    <Image
                      src={SCREENS.pipeline.src}
                      alt=""
                      width={1448}
                      height={1086}
                      sizes="60vw"
                      quality={62}
                      className="lp-shot-img"
                    />
                  </div>
                </div>
              </div>

              <div className="relative" style={{ transform: 'rotateY(-2.6deg) rotateX(0.9deg)' }}>
                <ProductShot
                  screen={SCREENS.dashboard}
                  priority
                  quality={94}
                  sizes="(max-width: 1023px) 100vw, 60vw"
                  focusMobile={{ x: 0.46, y: 0.21, scale: 2.15 }}
                />
                {/* Reflexo do próprio produto na superfície — material, não
                    glow: é a tela espelhada, esmaecida por máscara. */}
                <div
                  className="pointer-events-none absolute inset-x-0 top-full hidden h-[20%] overflow-hidden opacity-[0.14] lg:block"
                  aria-hidden
                  style={{
                    WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,0.9), transparent 76%)',
                    maskImage: 'linear-gradient(180deg, rgba(0,0,0,0.9), transparent 76%)',
                    transform: 'scaleY(-1)',
                    transformOrigin: 'top',
                  }}
                >
                  <Image
                    src={SCREENS.dashboard.src}
                    alt=""
                    width={1448}
                    height={1086}
                    sizes="60vw"
                    quality={35}
                    className="lp-shot-img"
                  />
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </Container>

      <Container className="mt-[clamp(40px,5vw,72px)]">
        <div className="flex flex-col gap-4 border-t border-[var(--lp-rule-soft)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="lp-label">Mais conversas · Mais oportunidades · Mais receita</p>
          <Link
            href={LOGIN_URL}
            className="text-[13px] font-medium text-[var(--lp-ink-3)] transition-colors hover:text-[var(--lp-ink)]"
          >
            Já uso o KHUB, entrar
          </Link>
        </div>
      </Container>
    </section>
  );
}

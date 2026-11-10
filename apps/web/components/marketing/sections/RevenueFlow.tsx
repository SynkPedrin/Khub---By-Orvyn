'use client';

import { useRef, useState } from 'react';
import { motion, useMotionValueEvent, useScroll, useTransform } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { ProductShot, ProductShotLayer } from '@/components/marketing/ui/ProductShot';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { SCREENS, type ProductScreen } from '@/lib/marketing/screens';
import { LP_EASE } from '@/lib/marketing/motion';

type Estagio = {
  id: string;
  titulo: string;
  resumo: string;
  tela: ProductScreen;
  /** Enquadramento no mobile: sem aproximar, a captura de 1397px vira
   *  textura ilegível numa tela de 390px. */
  focoMobile: { x: number; y: number; scale: number };
};

const ESTAGIOS: readonly Estagio[] = [
  {
    id: 'aquisicao',
    titulo: 'Aquisição',
    resumo:
      'Campanha, anúncio, indicação, direct. A origem entra marcada, e continua marcada até o fechamento.',
    tela: SCREENS.campaigns,
    focoMobile: { x: 0.45, y: 0.45, scale: 2.4 },
  },
  {
    id: 'lead',
    titulo: 'Lead',
    resumo: 'Chega com canal, responsável, score e a próxima ação já definida. Ninguém abre uma fila sem contexto.',
    tela: SCREENS.leads,
    focoMobile: { x: 0.5, y: 0.45, scale: 2.4 },
  },
  {
    id: 'conversa',
    titulo: 'Conversa',
    resumo: 'WhatsApp, Instagram, e-mail e site na mesma fila, com o histórico do lead ao lado da mensagem.',
    tela: SCREENS.conversations,
    focoMobile: { x: 0.62, y: 0.42, scale: 2.4 },
  },
  {
    id: 'pipeline',
    titulo: 'Pipeline',
    resumo: 'A conversa vira oportunidade com valor e etapa. O funil deixa de ser uma planilha paralela.',
    tela: SCREENS.pipeline,
    focoMobile: { x: 0.38, y: 0.5, scale: 2.4 },
  },
  {
    id: 'follow-up',
    titulo: 'Follow-up',
    resumo: 'O que depende de alguém lembrar vira gatilho: espera, condição, mensagem, tarefa.',
    tela: SCREENS.automations,
    focoMobile: { x: 0.55, y: 0.5, scale: 2.2 },
  },
  {
    id: 'receita',
    titulo: 'Receita',
    resumo: 'Canal, campanha e etapa amarrados ao valor fechado. A leitura sai da operação, não de exportação.',
    tela: SCREENS.analytics,
    focoMobile: { x: 0.45, y: 0.42, scale: 2.3 },
  },
];

/**
 * Revenue Flow — a experiência sticky do meio da página.
 *
 * Uma composição só: a mesma moldura de produto permanece fixa e as telas
 * reais trocam conforme o scroll percorre os seis estágios. A Revenue
 * Spine aparece aqui em duas formas — o trilho vertical que liga os nomes
 * dos estágios e o trilho horizontal de progresso sob a tela.
 *
 * No mobile a coreografia sticky é substituída por uma sequência vertical
 * simples (nada de grudar uma composição de 70vh numa tela de 844px).
 */
export function RevenueFlow() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const [ativo, setAtivo] = useState(0);

  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const i = Math.min(ESTAGIOS.length - 1, Math.max(0, Math.floor(v * ESTAGIOS.length * 0.999)));
    setAtivo(i);
  });

  const trilho = useTransform(scrollYProgress, [0, 1], ['0%', '100%']);

  return (
    <section id="fluxo" className="relative">
      {/* ---------- Cabeçalho ---------- */}
      <Container className="pb-[clamp(40px,5vw,72px)] pt-[clamp(16px,2vw,32px)]">
        <div className="grid gap-[clamp(24px,4vw,64px)] lg:grid-cols-[1fr_minmax(260px,420px)] lg:items-end">
          <h2 className="lp-h2 max-w-[13ch] text-[var(--lp-ink)]">
            <Reveal variant="clip" as="span" className="block">
              Do canal ao
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.1} className="block">
              caixa, em um
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.2} className="block">
              sistema só.
            </Reveal>
          </h2>
          <Reveal delay={0.2}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              Seis estágios, o mesmo registro. Nada é re-digitado, nada é reconciliado depois: o que acontece
              na conversa já é o que aparece no pipeline e no relatório.
            </p>
          </Reveal>
        </div>
      </Container>

      {/* ---------- Desktop: coreografia sticky ----------
           Com `prefers-reduced-motion` a coreografia inteira sai de cena e
           a página cai na sequência vertical abaixo: cinco dos seis
           estágios ficariam invisíveis num sticky sem scroll-jacking. */}
      <div
        ref={ref}
        className={reduced ? 'hidden' : 'relative hidden lg:block'}
        style={{ height: `calc(100svh + ${ESTAGIOS.length * 40}svh)` }}
      >
        <div className="sticky top-0 flex h-svh items-center">
          <Container className="w-full">
            <div className="grid grid-cols-[minmax(240px,26%)_1fr] items-center gap-[clamp(32px,4vw,72px)]">
              {/* Índice de estágios ligado pela spine */}
              <div className="relative pl-7">
                <div className="absolute bottom-2 left-[3px] top-2 w-px bg-[var(--lp-rule)]" aria-hidden />
                <motion.div
                  className="absolute left-[3px] top-2 w-px origin-top bg-[var(--lp-accent)]"
                  style={{ bottom: 8, scaleY: scrollYProgress }}
                  aria-hidden
                />

                <ol className="flex flex-col gap-[clamp(14px,1.6vw,22px)]">
                  {ESTAGIOS.map((e, i) => {
                    const on = i <= ativo;
                    const atual = i === ativo;
                    return (
                      <li key={e.id} className="relative">
                        <span
                          aria-hidden
                          className="absolute -left-7 top-[0.55em] block h-[7px] w-[7px] -translate-x-[2px] rounded-full transition-colors duration-500"
                          style={{
                            background: atual ? 'var(--lp-accent)' : on ? 'var(--lp-accent-line)' : 'var(--lp-rule)',
                            boxShadow: atual ? '0 0 0 4px rgba(123,46,255,0.12)' : 'none',
                          }}
                        />
                        <span
                          className="block text-[clamp(17px,1.5vw,22px)] font-semibold tracking-[-0.025em] transition-colors duration-500"
                          style={{ color: atual ? 'var(--lp-ink)' : on ? 'var(--lp-ink-3)' : 'var(--lp-ink-4)' }}
                        >
                          {e.titulo}
                        </span>
                      </li>
                    );
                  })}
                </ol>

                <div className="relative mt-[clamp(26px,3vw,40px)] h-[112px]">
                  {ESTAGIOS.map((e, i) => (
                    <motion.p
                      key={e.id}
                      className="absolute inset-x-0 top-0 text-[14.5px] leading-[1.6] text-[var(--lp-ink-2)]"
                      animate={{ opacity: i === ativo ? 1 : 0, y: i === ativo ? 0 : 8 }}
                      transition={{ duration: 0.45, ease: LP_EASE }}
                      aria-hidden={i !== ativo}
                    >
                      {e.resumo}
                    </motion.p>
                  ))}
                </div>
              </div>

              {/* Uma moldura só — as telas reais trocam dentro dela */}
              <div>
                <div className="relative" style={{ perspective: 2400 }}>
                  <div className="lp-shot">
                    {ESTAGIOS.map((e, i) => (
                      <motion.div
                        key={e.id}
                        className="absolute inset-0 overflow-hidden"
                        initial={false}
                        animate={{ opacity: i === ativo ? 1 : 0, scale: i === ativo ? 1 : 1.012 }}
                        transition={{ duration: 0.55, ease: LP_EASE }}
                      >
                        <ProductShotLayer screen={e.tela} sizes="72vw" quality={84} priority={i === 0} />
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Trilho horizontal — a spine atravessando o produto */}
                <div className="relative mt-7 h-px w-full bg-[var(--lp-rule)]">
                  <motion.span
                    className="absolute inset-y-0 left-0 block bg-[var(--lp-accent)]"
                    style={{ width: trilho }}
                    aria-hidden
                  />
                  <div className="absolute inset-x-0 -top-[3px] flex justify-between">
                    {ESTAGIOS.map((e, i) => (
                      <span
                        key={e.id}
                        aria-hidden
                        className="block h-[7px] w-px transition-colors duration-500"
                        style={{ background: i <= ativo ? 'var(--lp-accent)' : 'var(--lp-rule)' }}
                      />
                    ))}
                  </div>
                  <div className="mt-5 flex justify-between">
                    {ESTAGIOS.map((e, i) => (
                      <span
                        key={e.id}
                        className="lp-num text-[11px] font-semibold tracking-[0.12em] transition-colors duration-500"
                        style={{ color: i <= ativo ? 'var(--lp-ink-3)' : 'var(--lp-ink-4)' }}
                      >
                        {String(i + 1).padStart(2, '0')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </div>
      </div>

      {/* ---------- Mobile / tablet (e reduced-motion): sequência vertical ---------- */}
      <Container className={reduced ? '' : 'lg:hidden'}>
        <ol className="relative flex flex-col gap-[clamp(48px,8vw,72px)] pl-7">
          <div className="absolute bottom-6 left-[3px] top-3 w-px bg-[var(--lp-rule)]" aria-hidden />
          {ESTAGIOS.map((e, i) => (
            <li key={e.id} className="relative">
              <span
                aria-hidden
                className="absolute -left-7 top-[7px] block h-[7px] w-[7px] -translate-x-[2px] rounded-full bg-[var(--lp-accent)]"
              />
              <Reveal>
                <p className="lp-num lp-label mb-2">{String(i + 1).padStart(2, '0')}</p>
                <h3 className="lp-h4 text-[var(--lp-ink)]">{e.titulo}</h3>
                <p className="mt-2 max-w-[46ch] text-[15px] leading-[1.6] text-[var(--lp-ink-2)]">{e.resumo}</p>
              </Reveal>
              <Reveal variant="shot" delay={0.08} className="mt-6">
                <ProductShot screen={e.tela} sizes="100vw" quality={80} focusMobile={e.focoMobile} />
              </Reveal>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}

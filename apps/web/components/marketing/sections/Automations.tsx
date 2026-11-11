'use client';

import { useRef } from 'react';
import { motion, useScroll, useSpring } from 'framer-motion';
import { useReducedMotionSafe } from '@/lib/marketing/useReducedMotionSafe';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { SCREENS } from '@/lib/marketing/screens';

/** Os blocos abaixo são os mesmos do fluxo publicado na captura ao lado
 *  (`automations-dark.png`): gatilho, IA de qualificação, espera,
 *  condição e as duas saídas. Nada aqui é inventado para a LP. */
const PASSOS = [
  { tipo: 'Gatilho', titulo: 'Entrada de lead', texto: 'Novo lead via WhatsApp, o fluxo começa sozinho, sem ninguém abrir o sistema.' },
  { tipo: 'IA', titulo: 'Qualificação', texto: 'A NICO lê perfil, interesse e urgência e devolve variáveis tipadas para o resto do fluxo.' },
  { tipo: 'Controle', titulo: 'Espera', texto: 'Dois minutos. Tempo humano, não disparo instantâneo que denuncia robô.' },
  { tipo: 'Condição', titulo: 'Lead qualificado?', texto: 'Sim segue para mensagem e agendamento. Não entra em nutrição, e volta depois.', ramifica: true },
  { tipo: 'Ação', titulo: 'Follow-up e agenda', texto: 'Mensagem personalizada, reunião marcada, CRM atualizado. Tudo registrado no lead.' },
] as const;

/**
 * Automações — storytelling vertical.
 *
 * A Revenue Spine atravessa a coluna de passos de ponta a ponta e é
 * desenhada conforme o scroll avança. A captura real do construtor fica
 * sticky ao lado: o texto explica o que a tela está mostrando, em vez de
 * descrever um diagrama desenhado só para a landing page.
 */
export function Automations() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 72%', 'end 62%'] });
  const spine = useSpring(scrollYProgress, { stiffness: 140, damping: 40, mass: 0.4 });

  // Sem `overflow-hidden` na Section de propósito: um ancestral com
  // overflow hidden vira o scrollport do `position: sticky` da captura ao
  // lado, e o sticky simplesmente para de funcionar.
  return (
    <Section id="automacoes" space="lg">
      <Container>
        <div className="grid gap-6 lg:grid-cols-[1fr_minmax(240px,400px)] lg:items-end">
          <h2 className="lp-h2 max-w-[15ch] text-[var(--lp-ink)]">
            <Reveal variant="clip" as="span" className="block">
              Follow-up não
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.1} className="block">
              pode depender
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.2} className="block">
              de memória.
            </Reveal>
          </h2>
          <Reveal delay={0.2}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              O motor de automação é parte do sistema, não um plugin: ele lê e escreve no mesmo lead, na mesma
              conversa e no mesmo pipeline que o time está olhando.
            </p>
          </Reveal>
        </div>

        <div
          ref={ref}
          className="mt-[clamp(56px,7vw,104px)] grid gap-[clamp(48px,6vw,88px)] lg:grid-cols-[minmax(320px,40%)_1fr] lg:items-start"
        >
          {/* Sequência vertical costurada pela spine */}
          <ol className="relative pl-9">
            <div className="absolute bottom-6 left-[5px] top-3 w-px bg-[var(--lp-rule)]" aria-hidden />
            <motion.div
              className="absolute left-[5px] top-3 w-px origin-top bg-[var(--lp-accent)]"
              style={{ bottom: 24, scaleY: reduced ? 1 : spine }}
              aria-hidden
            />

            {PASSOS.map((p, i) => (
              <li key={p.titulo} className="relative pb-[clamp(30px,3.4vw,46px)] last:pb-0">
                <span
                  aria-hidden
                  className="absolute -left-[34px] top-[6px] block h-[9px] w-[9px] rounded-full border border-[var(--lp-accent)] bg-[var(--lp-bg)]"
                />
                <Reveal delay={i * 0.05}>
                  <p className="lp-label lp-eyebrow mb-2 text-[var(--lp-accent)]">{p.tipo}</p>
                  <h3 className="lp-h4 text-[var(--lp-ink)]">{p.titulo}</h3>
                  <p className="mt-2 max-w-[44ch] text-[14.5px] leading-[1.6] text-[var(--lp-ink-2)]">{p.texto}</p>
                  {'ramifica' in p && p.ramifica ? (
                    <span className="mt-4 flex items-center gap-4" aria-hidden>
                      <span className="flex items-center gap-2">
                        <span className="h-px w-8 bg-[var(--lp-accent-line)]" />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lp-ink-3)]">
                          Sim
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="h-px w-8 bg-[var(--lp-rule)]" />
                        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--lp-ink-4)]">
                          Não
                        </span>
                      </span>
                    </span>
                  ) : null}
                </Reveal>
              </li>
            ))}
          </ol>

          <div className="lg:sticky lg:top-[14vh]">
            <Reveal variant="shot">
              <ProductShot
                screen={SCREENS.automations}
                sizes="(max-width: 1023px) 100vw, 58vw"
                quality={92}
                focusMobile={{ x: 0.55, y: 0.5, scale: 2.2 }}
              />
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-5 max-w-[52ch] text-[13px] leading-[1.55] text-[var(--lp-ink-3)]">
                Fluxo real publicado no construtor do KHUB. Cada bloco roda com estado próprio, repetição
                controlada e registro de execução.
              </p>
            </Reveal>
          </div>
        </div>
      </Container>
    </Section>
  );
}

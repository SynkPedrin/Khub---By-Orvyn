import Link from 'next/link';
import { Container } from '@/components/marketing/ui/Container';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { CrystalMotion } from '@/components/marketing/ui/CrystalMotion';
import { LOGIN_URL, SIGNUP_URL } from '@/lib/marketing/env';

/**
 * CTA final — off-white, sem card, sem caixa.
 *
 * O único momento em que a ametista aparece como matéria: uma coluna de
 * macro de cristal real encostada na borda esquerda, cortada em retângulo
 * seco (nada de blob, nada de blur radial). A headline fica ao lado, no
 * mesmo eixo tipográfico do hero, fechando a página onde ela começou.
 */
export function FinalCTA() {
  return (
    <section className="relative overflow-hidden py-[clamp(88px,10vw,148px)]">
      <Container>
        <div className="grid items-center gap-[clamp(40px,5vw,80px)] lg:grid-cols-[minmax(220px,31%)_1fr]">
          <Reveal variant="shot" className="order-2 lg:order-1">
            <div className="relative h-[clamp(240px,42vw,580px)] w-full overflow-hidden rounded-[4px]">
              <CrystalMotion
                overlay={
                  <>
                    <div
                      className="pointer-events-none absolute inset-0"
                      style={{ background: 'linear-gradient(180deg, rgba(21,18,25,0.14), rgba(21,18,25,0.02))' }}
                    />
                    <div className="pointer-events-none absolute inset-0 ring-1 ring-inset ring-[rgba(21,18,25,0.1)]" />
                  </>
                }
              />
            </div>
          </Reveal>

          <div className="order-1 lg:order-2">
            <h2 className="lp-h2 max-w-[13ch] text-[var(--lp-ink)]">
              <Reveal variant="clip" as="span" className="block">
                Veja o que
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.1} className="block">
                acontece depois
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.2} className="lp-serif block text-[var(--lp-accent)]">
                do lead.
              </Reveal>
            </h2>

            <Reveal delay={0.26}>
              <p className="lp-body mt-8 max-w-[46ch]">
                Crie a conta, conecte o canal onde seus leads já chegam e acompanhe a conversa virar pipeline
                no mesmo sistema.
              </p>
            </Reveal>

            <Reveal delay={0.32}>
              <div className="mt-10 flex flex-wrap items-center gap-6">
                <Link href={SIGNUP_URL} className="lp-cta">
                  Criar conta
                </Link>
                <Link href={LOGIN_URL} className="lp-cta-quiet">
                  Entrar
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </Container>
    </section>
  );
}

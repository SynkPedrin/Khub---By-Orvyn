import Image from 'next/image';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';

/**
 * Fundador — seção editorial, não card de depoimento.
 *
 * Retrato real em retrato alto, dois parágrafos e uma assinatura. Sem
 * aspas gigantes, sem cartão branco com sombra, sem estrela de avaliação:
 * é uma nota do autor, não um testimonial de terceiro.
 */
export function Founder() {
  return (
    <Section space="lg">
      <Container>
        <div className="grid items-end gap-[clamp(36px,5vw,80px)] lg:grid-cols-[minmax(240px,32%)_1fr]">
          <Reveal variant="shot">
            <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[4px] bg-[var(--lp-bg-warm)]">
              <Image
                src="/lp-revenue/founder/pedro.jpeg"
                alt="Retrato de Pedro, fundador da KHUB"
                width={1122}
                height={1402}
                sizes="(max-width: 1023px) 92vw, 32vw"
                quality={88}
                className="h-full w-full object-cover"
              />
            </div>
          </Reveal>

          <div>
            <Reveal>
              <p className="lp-label mb-8">Por que a KHUB existe</p>
            </Reveal>
            <div className="flex max-w-[58ch] flex-col gap-6">
              <Reveal delay={0.06}>
                <p className="text-[clamp(18px,1.7vw,26px)] font-medium leading-[1.4] tracking-[-0.022em] text-[var(--lp-ink)]">
                  A mesma cena se repetia em toda operação que crescia por canal digital: o lead entrava em um
                  lugar, a conversa acontecia em outro e o pipeline era reconstruído numa planilha no fim do
                  mês. Ninguém estava errado, as ferramentas é que não se falavam.
                </p>
              </Reveal>
              <Reveal delay={0.12}>
                <p className="text-[16px] leading-[1.62] text-[var(--lp-ink-2)]">
                  A KHUB foi construída para fechar essa distância: um sistema só, onde a conversa, o negócio,
                  a automação e a leitura de receita compartilham o mesmo registro. É menos software novo e
                  mais operação inteira em um lugar.
                </p>
              </Reveal>
              <Reveal delay={0.18}>
                <div className="mt-2 flex items-center gap-4 border-t border-[var(--lp-rule-soft)] pt-6">
                  <span className="h-px w-8 bg-[var(--lp-accent)]" aria-hidden />
                  <span className="text-[14px] font-semibold text-[var(--lp-ink)]">Pedro</span>
                  <span className="text-[13px] text-[var(--lp-ink-3)]">Fundador, KHUB</span>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </Container>
    </Section>
  );
}

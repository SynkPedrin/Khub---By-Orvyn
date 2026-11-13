import Image from 'next/image';
import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { SCREENS } from '@/lib/marketing/screens';

const CANAIS = [
  { nome: 'WhatsApp', logo: '/lp-revenue/providers/whatsapp.png' },
  { nome: 'Instagram', logo: '/lp-revenue/providers/instagram.png' },
] as const;

/**
 * Conversas — composição assimétrica: texto numa coluna estreita e a tela
 * real ocupando ~68% da viewport, sangrando para fora do container pela
 * direita. Sem card, sem borda decorativa, sem ícone em quadradinho.
 */
export function Conversations() {
  return (
    <Section id="conversas" space="lg" className="overflow-hidden">
      <Container>
        <div className="grid items-center gap-[clamp(40px,5vw,72px)] lg:grid-cols-[minmax(280px,30%)_1fr]">
          <div>
            <p className="lp-label lp-eyebrow mb-6">Conversas</p>
            <h2 className="lp-h3 max-w-[13ch] text-[var(--lp-ink)]">
              <Reveal variant="clip" as="span" className="block">
                O lead não
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.08} className="block">
                escolhe o seu
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.16} className="block">
                canal.
              </Reveal>
            </h2>

            <Reveal delay={0.2}>
              <p className="lp-body mt-7 max-w-[38ch] text-[16px]">
                Ele responde onde é mais fácil para ele. Aqui, WhatsApp, Instagram, e-mail e site caem na mesma
                fila, com etiqueta, etapa do funil e histórico do lead ao lado da mensagem, para quem atende
                não precisar perguntar de novo o que já foi dito.
              </p>
            </Reveal>

            <Reveal delay={0.28}>
              <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-[var(--lp-rule-soft)] pt-6">
                {CANAIS.map((c) => (
                  <span key={c.nome} className="flex items-center gap-2.5 text-[13px] text-[var(--lp-ink-2)]">
                    <Image src={c.logo} alt="" width={36} height={36} className="h-[18px] w-[18px] object-contain" />
                    {c.nome}
                  </span>
                ))}
                <span className="text-[13px] text-[var(--lp-ink-3)]">E-mail</span>
                <span className="text-[13px] text-[var(--lp-ink-3)]">Site / Chat</span>
              </div>
            </Reveal>
          </div>

          <Reveal variant="shot" className="lp-bleed-r">
            <ProductShot
              screen={SCREENS.conversations}
              sizes="(max-width: 1023px) 100vw, 68vw"
              quality={92}
              focusMobile={{ x: 0.62, y: 0.42, scale: 2.4 }}
            />
          </Reveal>
        </div>
      </Container>
    </Section>
  );
}

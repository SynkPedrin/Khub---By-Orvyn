import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { SCREENS } from '@/lib/marketing/screens';

/** Analytics — headline, uma frase, e a tela quase de borda a borda. */
export function Analytics() {
  return (
    <Section id="analytics" space="lg" className="overflow-hidden">
      <Container>
        <h2 className="lp-h2 max-w-[16ch] text-[var(--lp-ink)]">
          <Reveal variant="clip" as="span" className="block">
            O relatório é a
          </Reveal>
          <Reveal variant="clip" as="span" delay={0.1} className="block">
            operação, não uma
          </Reveal>
          <Reveal variant="clip" as="span" delay={0.2} className="block">
            cópia dela.
          </Reveal>
        </h2>
        <Reveal delay={0.24}>
          <p className="lp-body mt-8 max-w-[52ch]">
            Receita por canal, funil, tempo de resposta por equipe e meta versus realizado, lidos direto do
            que o time fez, sem exportar nada.
          </p>
        </Reveal>
      </Container>

      <div className="mt-[clamp(48px,6vw,96px)]">
        <Reveal variant="shot" className="mx-auto w-[min(94vw,1700px)]">
          <ProductShot
            screen={SCREENS.analytics}
            sizes="94vw"
            quality={94}
            focusMobile={{ x: 0.45, y: 0.42, scale: 2.3 }}
          />
        </Reveal>
      </div>
    </Section>
  );
}

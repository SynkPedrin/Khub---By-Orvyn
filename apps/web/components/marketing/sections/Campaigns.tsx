import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { SCREENS } from '@/lib/marketing/screens';

/**
 * Campanhas e atribuição.
 *
 * Os números visíveis na captura são de um cenário de demonstração do
 * produto — a seção diz isso com todas as letras. Nenhuma promessa de
 * resultado de cliente, nenhum "gerou R$ X": a prova aqui é o sistema
 * amarrar campanha → resposta → reunião → negócio, não um case fictício.
 */
export function Campaigns() {
  return (
    <Section id="campanhas" tone="warm" space="lg" className="overflow-hidden">
      <Container>
        <div className="grid items-end gap-[clamp(32px,4vw,64px)] lg:grid-cols-[1fr_minmax(240px,420px)]">
          <h2 className="lp-h2 max-w-[13ch] text-[var(--lp-ink)]">
            <Reveal variant="clip" as="span" className="block">
              O anúncio é só
            </Reveal>
            <Reveal variant="clip" as="span" delay={0.1} className="block">
              o primeiro passo.
            </Reveal>
          </h2>
          <Reveal delay={0.18}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              Sequência multicanal, público, janela de envio e o que cada etapa devolveu. Como a campanha vive
              no mesmo sistema do lead, a atribuição não precisa ser reconstruída: ela já está no cartão do
              negócio.
            </p>
          </Reveal>
        </div>

        <Reveal variant="shot" className="mt-[clamp(48px,6vw,88px)]">
          <ProductShot
            screen={SCREENS.campaigns}
            sizes="(max-width: 1023px) 100vw, 86vw"
            quality={92}
            focusMobile={{ x: 0.45, y: 0.5, scale: 2.4 }}
          />
        </Reveal>

        <Reveal delay={0.1}>
          <div className="mt-6 flex flex-col gap-3 border-t border-[var(--lp-rule)] pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="lp-label">Cenário operacional de demonstração</p>
            <p className="max-w-[62ch] text-[13px] leading-[1.55] text-[var(--lp-ink-3)]">
              Os valores da captura ilustram como o sistema organiza a leitura de uma campanha. Eles não
              representam resultado de cliente.
            </p>
          </div>
        </Reveal>
      </Container>
    </Section>
  );
}

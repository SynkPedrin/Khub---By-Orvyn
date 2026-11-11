import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';

const CRM = [
  'A conversa acontece em outro app.',
  'A automação é uma regra isolada por ferramenta.',
  'O relatório é reconstruído em planilha, uma semana atrasado.',
  'O follow-up depende de alguém lembrar.',
];

const O_KHUB_FAZ = [
  'A conversa acontece dentro do registro do lead.',
  'A automação cruza lead, conversa, pipeline e tarefa.',
  'O relatório é a operação lida em tempo real.',
  'O follow-up é um gatilho com estado e histórico.',
];

/**
 * CRM vs KHUB: split editorial, sem tabela.
 *
 * A V1 usava uma `<table>` de 3 colunas que estourava a largura em
 * 390–430px (overflow horizontal medido no QA). Aqui a comparação é uma
 * coluna dupla separada por uma régua vertical: empilha sozinha no mobile
 * e lê melhor no desktop.
 */
export function Differentiation() {
  return (
    <Section id="crm" space="lg">
      <Container>
        <div className="grid gap-[clamp(40px,5vw,96px)] md:grid-cols-2">
          <div className="md:pr-[clamp(24px,3vw,56px)]">
            <h2 className="lp-h3 text-[var(--lp-ink-4)]">
              <Reveal variant="clip" as="span" className="block">
                CRM
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.08} className="block">
                registra.
              </Reveal>
            </h2>
            <ul className="mt-9 flex flex-col">
              {CRM.map((t, i) => (
                <Reveal
                  key={t}
                  as="li"
                  delay={i * 0.06}
                  className="border-t border-[var(--lp-rule-soft)] py-5 text-[15px] leading-[1.55] text-[var(--lp-ink-3)]"
                >
                  {t}
                </Reveal>
              ))}
            </ul>
          </div>

          <div className="relative md:pl-[clamp(24px,3vw,56px)]">
            <span
              aria-hidden
              className="absolute -left-px bottom-0 top-0 hidden w-px bg-[var(--lp-accent-line)] md:block"
            />
            <h2 className="lp-h3 text-[var(--lp-ink)]">
              <Reveal variant="clip" as="span" delay={0.06} className="block">
                O KHUB
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.14} className="lp-serif block text-[var(--lp-accent)]">
                faz andar.
              </Reveal>
            </h2>
            <ul className="mt-9 flex flex-col">
              {O_KHUB_FAZ.map((t, i) => (
                <Reveal
                  key={t}
                  as="li"
                  delay={0.06 + i * 0.06}
                  className="border-t border-[var(--lp-rule)] py-5 text-[15px] leading-[1.55] text-[var(--lp-ink)]"
                >
                  {t}
                </Reveal>
              ))}
            </ul>
          </div>
        </div>
      </Container>
    </Section>
  );
}

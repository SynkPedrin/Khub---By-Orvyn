import { Container } from '@/components/marketing/ui/Container';
import { Section } from '@/components/marketing/ui/Section';
import { Reveal } from '@/components/marketing/ui/Reveal';
import { ProductShot } from '@/components/marketing/ui/ProductShot';
import { Wordmark } from '@/components/marketing/ui/Wordmark';
import { SCREENS } from '@/lib/marketing/screens';

/**
 * NICO — apresentada pelo que ela produz dentro da tela de um lead real:
 * contexto lido, risco apontado, próxima ação sugerida. Sem cérebro, sem
 * robô, sem "IA" como enfeite: as três anotações apontam para regiões que
 * existem de fato na captura (`lead-detail-flat.png`).
 *
 * As anotações vivem em colunas de grade (não posicionadas em absoluto
 * por cima do print): assim nunca cobrem a interface nem colidem entre si
 * quando a largura muda.
 */
const ANOTACOES = [
  {
    rotulo: 'Contexto',
    texto:
      'Timeline unificada: mensagem no WhatsApp, reunião realizada, e-mail enviado, clique na campanha e visita à página de preços.',
    lado: 'esq',
    offset: 'xl:mt-[16%]',
  },
  {
    rotulo: 'Próxima ação',
    texto: 'Etapa no funil com o próximo passo sugerido, enviar proposta comercial, já ligado ao negócio aberto.',
    lado: 'dir',
    offset: 'xl:mt-[4%]',
  },
  {
    rotulo: 'Risco e prioridade',
    texto: 'Score de conversão com os sinais que o sustentam: engajamento, cargo de decisão e fit com o ICP.',
    lado: 'dir',
    offset: 'xl:mt-[30%]',
  },
] as const;

export function Intelligence() {
  const esq = ANOTACOES.filter((a) => a.lado === 'esq');
  const dir = ANOTACOES.filter((a) => a.lado === 'dir');

  return (
    <Section id="nyro" space="lg" className="overflow-hidden">
      <Container>
        <div className="grid gap-[clamp(24px,3vw,64px)] lg:grid-cols-[1fr_minmax(240px,400px)] lg:items-end">
          <div>
            <Reveal className="mb-7 flex items-center gap-4">
              <Wordmark mark="nico" height={16} />
              <span className="h-px w-10 bg-[var(--lp-accent-line)]" aria-hidden />
              <span className="lp-label">Camada de raciocínio da NICO</span>
            </Reveal>
            <h2 className="lp-h2 max-w-[13ch] text-[var(--lp-ink)]">
              <Reveal variant="clip" as="span" className="block">
                Inteligência
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.1} className="block">
                que sabe onde
              </Reveal>
              <Reveal variant="clip" as="span" delay={0.2} className="block">
                olhar.
              </Reveal>
            </h2>
          </div>
          <Reveal delay={0.2}>
            <p className="text-[15px] leading-[1.62] text-[var(--lp-ink-2)]">
              A NICO não é um chat colado num canto. Ela lê o que já está no sistema, conversa, negócio,
              campanha, tarefa, e devolve leitura dentro da mesma tela onde o time trabalha. Ação sensível
              passa por aprovação humana, sempre.
            </p>
          </Reveal>
        </div>
      </Container>

      {/* Anotação | tela | anotação — em grade, nunca sobreposto.
          Fora do `Container` de propósito: a tela do lead precisa de mais
          largura do que a coluna de texto da página. */}
      <div className="mx-auto mt-[clamp(40px,5vw,80px)] grid w-[min(92vw,1560px)] items-start gap-[clamp(20px,2.4vw,44px)] xl:w-[min(95vw,1780px)] xl:grid-cols-[minmax(190px,1fr)_minmax(0,64%)_minmax(190px,1fr)]">
        <div className="order-2 flex flex-col gap-8 xl:order-1 xl:text-right">
          {esq.map((a, i) => (
            <Anotacao key={a.rotulo} {...a} delay={0.24 + i * 0.1} alinhaFim />
          ))}
        </div>

        <Reveal variant="shot" className="order-1 xl:order-2">
          <ProductShot
            screen={SCREENS.leadDetail}
            sizes="(max-width: 1279px) 92vw, 60vw"
            quality={94}
            focusMobile={{ x: 0.52, y: 0.62, scale: 2.4 }}
          />
        </Reveal>

        <div className="order-3 flex flex-col gap-8">
          {dir.map((a, i) => (
            <Anotacao key={a.rotulo} {...a} delay={0.32 + i * 0.1} />
          ))}
        </div>
      </div>
    </Section>
  );
}

function Anotacao({
  rotulo,
  texto,
  offset,
  delay,
  alinhaFim = false,
}: {
  rotulo: string;
  texto: string;
  offset: string;
  delay: number;
  alinhaFim?: boolean;
}) {
  return (
    <Reveal delay={delay} className={offset}>
      <span
        aria-hidden
        className={`mb-3 block h-px w-8 bg-[var(--lp-accent)] ${alinhaFim ? 'xl:ml-auto' : ''}`}
      />
      <span className="block text-[12px] font-semibold uppercase tracking-[0.16em] text-[var(--lp-accent)]">
        {rotulo}
      </span>
      <span className="mt-2 block text-[13.5px] leading-[1.55] text-[var(--lp-ink-2)]">{texto}</span>
    </Reveal>
  );
}

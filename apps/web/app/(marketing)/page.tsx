import type { Metadata } from 'next';
import { Nav } from '@/components/marketing/sections/Nav';
import { Hero } from '@/components/marketing/sections/Hero';
import { Statement } from '@/components/marketing/sections/Statement';
import { RevenueFlow } from '@/components/marketing/sections/RevenueFlow';
import { ProductMoment } from '@/components/marketing/sections/ProductMoment';
import { Conversations } from '@/components/marketing/sections/Conversations';
import { Pipeline } from '@/components/marketing/sections/Pipeline';
import { Automations } from '@/components/marketing/sections/Automations';
import { Intelligence } from '@/components/marketing/sections/Intelligence';
import { Campaigns } from '@/components/marketing/sections/Campaigns';
import { Analytics } from '@/components/marketing/sections/Analytics';
import { Integrations } from '@/components/marketing/sections/Integrations';
import { Differentiation } from '@/components/marketing/sections/Differentiation';
import { Founder } from '@/components/marketing/sections/Founder';
import { FinalSequence } from '@/components/marketing/sections/FinalSequence';
import { FinalCTA } from '@/components/marketing/sections/FinalCTA';
import { Footer } from '@/components/marketing/sections/Footer';
import { RevenueSpine } from '@/components/marketing/ui/RevenueSpine';

export const metadata: Metadata = {
  title: 'KHUB · Gerar lead é apenas o começo',
  description:
    'Leads, conversas, pipeline, automação e inteligência no mesmo registro. O KHUB opera o trecho entre o clique e a receita, onde o CRM tradicional para.',
};

/**
 * Landing page pública do KHUB Revenue OS — primeira tela em "/".
 *
 * Arquitetura de leitura (ver `docs/lp-qa/`):
 *   hero → ruptura editorial → fluxo sticky (6 estágios) → produto em
 *   tela cheia → conversas → PIPELINE (única seção dark) → automações →
 *   NYRO → campanhas → analytics → integrações → CRM vs Revenue OS →
 *   fundador → sequência tipográfica final → CTA → rodapé.
 *
 * A Revenue Spine (`components/marketing/ui/RevenueSpine.tsx`) é o fio
 * que costura tudo: trilho de 1px na borda, e a mesma linha reaparecendo
 * dentro das seções (índice do fluxo, coluna das automações, eixo das
 * integrações, fechamento da sequência final).
 *
 * Os CTAs apontam para `/login` e `/signup` reais (`lib/marketing/env.ts`)
 * — mesma aplicação, mesmo domínio.
 */
export default function LandingPage() {
  return (
    <>
      <RevenueSpine />
      <Nav />
      <main id="conteudo">
        <Hero />
        <Statement />
        <RevenueFlow />
        <ProductMoment />
        <Conversations />
        <Pipeline />
        <Automations />
        <Intelligence />
        <Campaigns />
        <Analytics />
        <Integrations />
        <Differentiation />
        <Founder />
        <FinalSequence />
        <FinalCTA />
      </main>
      <Footer />
    </>
  );
}

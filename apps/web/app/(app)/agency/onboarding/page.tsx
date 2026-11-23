'use client';

import { PageShell, PageHeader } from '@/components/revenue/Page';
import { VisaoExecutivaView } from '@/components/agency/onboarding/VisaoExecutiva';

/** Visão executiva do Onboarding KROMA (db/078): todos os clientes em entrada. */
export default function OnboardingVisaoPage() {
  return (
    <PageShell>
      <PageHeader title="Onboarding" subtitle="A entrada de cada cliente, da coleta à homologação, com tarefas reais no Daily." />
      <VisaoExecutivaView />
    </PageShell>
  );
}

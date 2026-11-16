'use client';

import { PageShell, PageHeader } from '@/components/revenue/Page';
import { TarefasView } from '@/components/agency/daily/TarefasView';

export default function TodasTarefasPage() {
  return (
    <PageShell>
      <PageHeader title="Todas as tarefas" subtitle="Toda a operação da agência num lugar só, em lista ou quadro." />
      <TarefasView escopo="todas" />
    </PageShell>
  );
}

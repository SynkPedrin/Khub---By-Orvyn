'use client';

import { PageShell, PageHeader } from '@/components/revenue/Page';
import { TarefasView } from '@/components/agency/daily/TarefasView';

export default function MinhasTarefasPage() {
  return (
    <PageShell>
      <PageHeader title="Minhas tarefas" subtitle="O que está com você hoje: tarefas e subtarefas atribuídas, por prazo." />
      <TarefasView escopo="minhas" />
    </PageShell>
  );
}

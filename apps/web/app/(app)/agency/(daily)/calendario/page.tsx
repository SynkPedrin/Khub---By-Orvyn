'use client';

import { PageShell, PageHeader } from '@/components/revenue/Page';
import { CalendarioView } from '@/components/agency/daily/CalendarioView';

export default function CalendarioAgenciaPage() {
  return (
    <PageShell>
      <PageHeader title="Calendário da agência" subtitle="Eventos da equipe, prazos de entrega e datas de publicação. Arraste para reagendar." />
      <CalendarioView />
    </PageShell>
  );
}

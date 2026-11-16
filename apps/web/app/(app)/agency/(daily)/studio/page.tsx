'use client';

import { PageShell, PageHeader } from '@/components/revenue/Page';
import { StudioView } from '@/components/agency/daily/StudioView';

export default function StudioPage() {
  return (
    <PageShell>
      <PageHeader title="Studio" subtitle="Posts, carrosséis, Reels e criativos: legenda, aprovação e publicação num fluxo só." />
      <StudioView />
    </PageShell>
  );
}

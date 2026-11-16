'use client';

import { DailyProvider } from '@/components/agency/daily/DailyContext';

/** Daily da agência (ADR-0050): contexto compartilhado + gaveta de tarefa em todas as telas do grupo. */
export default function DailyLayout({ children }: { children: React.ReactNode }) {
  return <DailyProvider>{children}</DailyProvider>;
}

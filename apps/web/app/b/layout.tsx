import type { ReactNode } from 'react';

/**
 * Páginas PÚBLICAS de agendamento (/b/<slug>), fora do grupo (app): sem shell
 * e sem sessão. Tema escuro Kroma herdado do layout raiz.
 */
export default function LayoutAgendamentoPublico({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-bg text-fg">{children}</div>;
}

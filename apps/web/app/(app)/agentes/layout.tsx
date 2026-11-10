import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/agents/kit';

/** Área de agentes: feedback (toasts) compartilhado entre Manager, Wizard e workspace. */
export default function AgentesLayout({ children }: { children: ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>;
}

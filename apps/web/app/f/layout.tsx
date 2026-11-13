import type { ReactNode } from 'react';

/**
 * Páginas PÚBLICAS de formulário (/f/<slug>), fora do grupo (app): sem shell,
 * sem sidebar, sem sessão. Tema escuro Kroma herdado do layout raiz.
 */
export default function LayoutFormularioPublico({ children }: { children: ReactNode }) {
  return <div className="min-h-screen bg-bg text-fg">{children}</div>;
}

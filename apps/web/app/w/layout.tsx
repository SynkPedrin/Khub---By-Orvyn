import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/** Link público de conexão do WhatsApp (/w/<token>): sem shell, sem sessão, fora dos buscadores. */
export const metadata: Metadata = { title: 'Conectar WhatsApp · KHUB', robots: { index: false, follow: false } };

export default function LayoutConectarWhatsApp({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

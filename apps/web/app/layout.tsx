import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

// Inter: grotesca neutra, precisão de OS (SF Pro/Geist). Variável para hierarquia.
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'ORVYN OS — CRM configurado por IA',
  description: 'O CRM que já nasce pronto para o seu negócio. Powered by Nyro IA.',
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = {
  themeColor: '#7B2EFF',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable}>
      <body>
        {/* Fundo estúdio infinito: camada fixa atrás de tudo (-z-10), CSS puro. */}
        <div className="studio-bg" aria-hidden="true" />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { LocaleProvider } from '@/lib/locale';
import { AgencyProvider } from '@/components/agency/AgencyProvider';
import { GlassLight } from '@/components/shell/GlassLight';

/**
 * Inter: grotesca neutra, open-source, já no projeto — nenhuma dependência
 * nova. Alta legibilidade em tabelas densas e hierarquia limpa nos títulos,
 * que é o que um produto B2B de operação precisa.
 */
const sans = localFont({ src: '../public/fonts/inter-latin-variable.woff2', weight: '100 900', variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'KHUB',
  description:
    'Transforme leads em receita: CRM, atendimento, automação, inteligência artificial, follow-up, campanhas, agenda e analytics em uma única plataforma.',
  icons: { icon: '/khub-mark.png' },
};

export const viewport: Viewport = {
  themeColor: '#6C2BFF',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable}>
      <body>
        <GlassLight />
        <AuthProvider>
          <LocaleProvider><AgencyProvider>{children}</AgencyProvider></LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

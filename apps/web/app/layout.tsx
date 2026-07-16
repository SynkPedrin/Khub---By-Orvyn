import type { Metadata, Viewport } from 'next';
import { Nunito } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

// Fonte arredondada e profissional (variável: pesos finos→grossos por elemento).
const sans = Nunito({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  title: 'ORVYN OS — CRM configurado por IA',
  description: 'O CRM que já nasce pronto para o seu negócio. Powered by Nyro IA.',
  icons: { icon: '/logo-orvynos.png' },
};

export const viewport: Viewport = {
  themeColor: '#7B2FBE',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={sans.variable}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Orvyn — CRM configurado por IA',
  description: 'O CRM que já nasce pronto para o seu negócio. Powered by Nyro IA.',
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = {
  themeColor: '#7B2FBE',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

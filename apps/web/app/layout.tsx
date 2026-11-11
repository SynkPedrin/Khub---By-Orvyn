import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import { LocaleProvider } from '@/lib/locale';
import { AgencyProvider } from '@/components/agency/AgencyProvider';
import { GlassLight } from '@/components/shell/GlassLight';

/**
 * Identidade Kroma (ADR-0043): Manrope na interface inteira e Instrument
 * Serif itálica só como acento editorial (uma palavra por título). Arquivos
 * locais em /public/fonts (OFL): o build de deploy não baixa nada.
 */
const sans = localFont({ src: '../public/fonts/manrope-latin-variable.woff2', weight: '200 800', variable: '--font-sans', display: 'swap' });
const serif = localFont({
  src: [
    { path: '../public/fonts/instrument-serif-latin-italic.woff2', weight: '400', style: 'italic' },
    { path: '../public/fonts/instrument-serif-latin.woff2', weight: '400', style: 'normal' },
  ],
  variable: '--font-serif',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'KHUB',
  description:
    'Transforme leads em receita: CRM, atendimento, automação, inteligência artificial, follow-up, campanhas, agenda e analytics em uma única plataforma.',
  icons: { icon: '/khub-mark.png' },
};

export const viewport: Viewport = {
  themeColor: '#050505',
  width: 'device-width',
  initialScale: 1,
};

const TEMA_ANTES_DE_PINTAR = `(function(){try{var p=location.pathname;if(/^\\/(login|signup|esqueci-senha|redefinir-senha|agency-invite|privacidade|termos)?(\\/|$)/.test(p))return;var t=localStorage.getItem('khub-theme');if(t==='system')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';if(t==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" data-theme="dark" className={`${sans.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        {/* Pinta o tema claro antes do primeiro frame (sem piscar escuro) na
            área logada. Login, cadastro e LP ficam sempre escuros. A fonte
            de verdade é `users.prefs`; isto é só o cache local dela. */}
        <script dangerouslySetInnerHTML={{ __html: TEMA_ANTES_DE_PINTAR }} />
      </head>
      <body>
        <GlassLight />
        <AuthProvider>
          <LocaleProvider><AgencyProvider>{children}</AgencyProvider></LocaleProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

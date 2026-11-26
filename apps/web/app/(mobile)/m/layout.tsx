import type { Metadata, Viewport } from 'next';
import { MobileShell } from '@/components/mobile/ui';

/** App mobile do cliente (PWA): aprovações, agenda e avisos. Protegido pelo middleware. */
export const metadata: Metadata = { title: 'KHUB', robots: { index: false } };
export const viewport: Viewport = { themeColor: '#050505', width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover' };

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileShell>{children}</MobileShell>;
}

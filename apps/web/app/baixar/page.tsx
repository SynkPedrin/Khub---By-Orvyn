import type { Metadata } from 'next';
import { InstalarApp } from '@/components/pwa/InstalarApp';

export const metadata: Metadata = {
  title: 'Baixar o app KHUB',
  description: 'Instale o app KHUB no celular: aprove artes e roteiros, acompanhe a agenda e receba avisos.',
};

export default function BaixarPage() {
  return <InstalarApp />;
}

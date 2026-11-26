import type { MetadataRoute } from 'next';

/**
 * App mobile do KHUB (PWA). Instalado pela página /baixar (botão "Baixar app"
 * da LP). Abre direto no app do cliente (/m): aprovações, agenda e avisos.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/m',
    name: 'KHUB',
    short_name: 'KHUB',
    description: 'Aprove artes e roteiros, acompanhe sua agenda e receba avisos no celular.',
    start_url: '/m?origem=app',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#050505',
    theme_color: '#050505',
    lang: 'pt-BR',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Aprovações', url: '/m/aprovacoes', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
      { name: 'Agenda', url: '/m/agenda', icons: [{ src: '/pwa/icon-192.png', sizes: '192x192' }] },
    ],
  };
}

/* KHUB — service worker do app mobile (PWA).
 *
 * - Push: mostra o aviso ("Arte para aprovar") e, ao tocar, abre a peça.
 * - Navegação: rede primeiro; sem internet, mostra a página offline.
 * - Nunca guarda resposta de /api (dado do cliente e sessão).
 */
const VERSAO = 'khub-pwa-v1';
const OFFLINE = '/offline.html';
const ESTATICOS = [OFFLINE, '/pwa/icon-192.png', '/pwa/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ESTATICOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((chaves) => Promise.all(chaves.filter((k) => k !== VERSAO).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE).then((r) => r || Response.error())));
});

self.addEventListener('push', (event) => {
  let dados = {};
  try { dados = event.data ? event.data.json() : {}; } catch (_) { dados = { body: event.data ? event.data.text() : '' }; }
  const titulo = dados.title || 'KHUB';
  const opcoes = {
    body: dados.body || '',
    icon: '/pwa/icon-192.png',
    badge: '/pwa/icon-192.png',
    tag: dados.tag || undefined,
    renotify: Boolean(dados.tag),
    data: { url: typeof dados.url === 'string' && dados.url.startsWith('/') ? dados.url : '/m' },
  };
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data && event.notification.data.url ? event.notification.data.url : '/m', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const j of janelas) {
        if (new URL(j.url).origin === self.location.origin && 'focus' in j) {
          return j.navigate(destino).then((w) => (w || j).focus()).catch(() => j.focus());
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});

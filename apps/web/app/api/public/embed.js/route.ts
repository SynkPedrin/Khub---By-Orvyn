/**
 * Script de embed do formulário (Q4.1). Uso no site do cliente:
 *   <script src="https://<web>/api/public/embed.js" data-khub-form="<slug>" async></script>
 * Cria o iframe de /f/<slug>/embed logo após a tag, repassa as UTM e a URL da
 * página (para a origem do lead), ajusta a altura pelo postMessage do iframe
 * e segue o redirecionamento configurado no formulário. Só aceita mensagens
 * vindas do próprio iframe, da mesma origem do script.
 */
export const dynamic = 'force-static';

const SCRIPT = `(function () {
  var s = document.currentScript;
  if (!s) return;
  var slug = s.getAttribute('data-khub-form') || '';
  if (!/^[a-z0-9-]{4,64}$/.test(slug)) return;
  var base = new URL(s.src).origin;
  var q = new URLSearchParams(window.location.search);
  var p = new URLSearchParams();
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'].forEach(function (k) {
    var v = q.get(k);
    if (v) p.set(k, v);
  });
  p.set('_pagina', window.location.href.split('#')[0]);
  var f = document.createElement('iframe');
  f.src = base + '/f/' + slug + '/embed?' + p.toString();
  f.title = s.getAttribute('data-titulo') || 'Formulário';
  f.loading = 'lazy';
  f.style.cssText = 'width:100%;border:0;min-height:420px;display:block;background:transparent;color-scheme:dark';
  s.parentNode.insertBefore(f, s.nextSibling);
  window.addEventListener('message', function (e) {
    if (e.origin !== base || e.source !== f.contentWindow) return;
    var d = e.data || {};
    if (d.slug !== slug) return;
    if (d.tipo === 'khub-form:altura' && typeof d.altura === 'number') f.style.height = Math.min(Math.max(d.altura, 200), 5000) + 'px';
    if (d.tipo === 'khub-form:redirecionar' && typeof d.url === 'string' && /^https?:\\/\\//.test(d.url)) window.location.href = d.url;
  });
})();
`;

export function GET() {
  return new Response(SCRIPT, {
    headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });
}

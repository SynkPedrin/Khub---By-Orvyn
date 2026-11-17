/**
 * Cliente HTTP do Agendart (Laravel + Inertia) para EXPORTAR dados da clínica,
 * somente leitura. Login com ~/.khub/agendart.env (AGENDART_EMAIL/AGENDART_SENHA),
 * nunca impresso. Sessão por cookie + XSRF, como o navegador.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export const BASE = 'https://agendart.tech';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function credenciais() {
  const env = Object.fromEntries(readFileSync(`${homedir()}/.khub/agendart.env`, 'utf8').split('\n').filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
  if (!env.AGENDART_EMAIL || !env.AGENDART_SENHA) throw new Error('~/.khub/agendart.env sem AGENDART_EMAIL/AGENDART_SENHA');
  return env;
}

export class Agendart {
  jar = new Map();
  inertiaVersion = null;

  cookie() { return [...this.jar.values()].join('; '); }
  xsrf() { const c = this.jar.get('XSRF-TOKEN'); return c ? decodeURIComponent(c.slice(c.indexOf('=') + 1)) : undefined; }

  async req(metodo, caminho, { corpo, json = true, inertia = false, tentativas = 4 } = {}) {
    for (let t = 1; ; t++) {
      try {
        const r = await fetch(BASE + caminho, {
          method: metodo,
          redirect: 'manual',
          signal: AbortSignal.timeout(90_000),
          headers: {
            'user-agent': UA,
            accept: json ? 'application/json, text/plain, */*' : 'text/html',
            'x-requested-with': 'XMLHttpRequest',
            ...(this.jar.size ? { cookie: this.cookie() } : {}),
            ...(this.xsrf() ? { 'x-xsrf-token': this.xsrf() } : {}),
            ...(inertia ? { 'x-inertia': 'true', ...(this.inertiaVersion ? { 'x-inertia-version': this.inertiaVersion } : {}) } : {}),
            ...(corpo ? { 'content-type': 'application/json' } : {}),
            referer: `${BASE}/`,
          },
          body: corpo ? JSON.stringify(corpo) : undefined,
        });
        for (const sc of r.headers.getSetCookie?.() ?? []) { const kv = sc.split(';')[0]; this.jar.set(kv.slice(0, kv.indexOf('=')), kv); }
        const texto = await r.text();
        let dados = null;
        try { dados = JSON.parse(texto); } catch { /* html */ }
        if ((r.status === 429 || r.status >= 500) && t < tentativas) { await new Promise((ok) => setTimeout(ok, 2000 * t)); continue; }
        return { status: r.status, dados, texto, location: r.headers.get('location') };
      } catch (e) {
        if (t >= tentativas) throw e;
        await new Promise((ok) => setTimeout(ok, 3000 * t));
      }
    }
  }

  async login() {
    const { AGENDART_EMAIL, AGENDART_SENHA } = credenciais();
    const pag = await this.req('GET', '/login', { json: false });
    const m = pag.texto.match(/data-page="([^"]+)"/);
    if (m) this.inertiaVersion = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')).version ?? null;
    const r = await this.req('POST', '/login', { corpo: { email: AGENDART_EMAIL, password: AGENDART_SENHA, remember: false }, inertia: true });
    if (r.status >= 400) throw new Error(`login recusado: HTTP ${r.status} ${(r.dados?.message ?? '').slice(0, 120)}`);
    return r;
  }

  /** Página Inertia: devolve { component, props, url }. */
  async pagina(caminho) {
    const r = await this.req('GET', caminho, { inertia: true });
    if (r.status === 409 && r.location) return this.pagina(new URL(r.location).pathname);
    if (r.status >= 300 && r.status < 400 && r.location) return this.pagina(new URL(r.location, BASE).pathname + new URL(r.location, BASE).search);
    return r.dados ?? { status: r.status, html: r.texto.slice(0, 200) };
  }
}

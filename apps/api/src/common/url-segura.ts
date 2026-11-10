/**
 * URL sem credencial, para log, Sentry e corpo de erro (doc 18: token de webhook
 * vazava em todo 5xx). Três rotas públicas carregam segredo na URL:
 *  - `/hooks/:chave`            (webhook genérico de workflow: a chave É a credencial)
 *  - `/hooks/evolution/:token`  (token global da Evolution no path)
 *  - `?token=` / `?key=` / …    (Stevo e afins na query)
 */
const PARAMS_SENSIVEIS = /^(token|key|apikey|api_key|secret|signature|access_token|hub\.verify_token)$/i;
const REDIGIDO = '[redigido]';

export function urlSegura(url: string | undefined | null): string {
  if (!url) return '';
  const i = url.indexOf('?');
  const caminho = i >= 0 ? url.slice(0, i) : url;
  const query = i >= 0 ? url.slice(i + 1) : '';

  const c = caminho
    .replace(/(\/hooks\/evolution\/)[^/]+/i, `$1${REDIGIDO}`)
    .replace(/(\/hooks\/)(?!evolution(?:\/|$))[^/]+/i, `$1${REDIGIDO}`);
  if (!query) return c;

  const q = query
    .split('&')
    .map((par) => {
      const nome = par.split('=')[0];
      let decodificado = nome;
      try {
        decodificado = decodeURIComponent(nome);
      } catch {
        /* nome malformado: compara cru */
      }
      return PARAMS_SENSIVEIS.test(decodificado) ? `${nome}=${REDIGIDO}` : par;
    })
    .join('&');
  return `${c}?${q}`;
}

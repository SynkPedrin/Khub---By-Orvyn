import { API } from '@/lib/server-auth';

/**
 * Ponte do web para a API pública (/v1/public/*) das páginas /f e /b.
 *
 * O navegador do visitante só fala com o domínio do web; a API vê o servidor
 * do web como origem. Para o rate limit por IP valer para o VISITANTE, o IP
 * real vai em `x-khub-client-ip`, autenticado por `x-khub-proxy-secret`
 * (KHUB_PROXY_SECRET, o mesmo valor nos dois serviços). Sem o segredo, a API
 * ignora o cabeçalho (ninguém forja IP chamando a API direto).
 */

/** Recursos públicos que o proxy repassa. Qualquer outro caminho é 404. */
const PERMITIDOS = /^(forms\/[a-z0-9-]{4,64}(\/submit)?|booking\/[a-z0-9-]{4,64}(\/(slots|book))?|reservas\/[A-Za-z0-9_-]{43}(\/(cancelar|remarcar|ics))?)$/;

export function caminhoPublicoPermitido(caminho: string): boolean {
  return PERMITIDOS.test(caminho);
}

/** Primeiro IP do `x-forwarded-for` (o cliente), senão `x-real-ip`. */
export function ipDoVisitante(headers: Pick<Headers, 'get'>): string | null {
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = xff || headers.get('x-real-ip')?.trim() || null;
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

export function cabecalhosParaApi(origem: Pick<Headers, 'get'>, extra: Record<string, string> = {}): Record<string, string> {
  const h: Record<string, string> = { ...extra };
  const ip = ipDoVisitante(origem);
  const segredo = process.env.KHUB_PROXY_SECRET;
  if (ip && segredo) {
    h['x-khub-client-ip'] = ip;
    h['x-khub-proxy-secret'] = segredo;
  }
  const ua = origem.get('user-agent');
  if (ua) h['user-agent'] = ua.slice(0, 400);
  return h;
}

/** GET server-side (páginas /f e /b renderizadas no servidor). `null` = não existe. */
export async function buscarPublico<T>(caminho: string, headers: Pick<Headers, 'get'>): Promise<{ ok: true; dados: T } | { ok: false; status: number }> {
  if (!caminhoPublicoPermitido(caminho)) return { ok: false, status: 404 };
  try {
    const r = await fetch(`${API}/v1/public/${caminho}`, { headers: cabecalhosParaApi(headers), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return { ok: false, status: r.status };
    return { ok: true, dados: (await r.json()) as T };
  } catch {
    return { ok: false, status: 503 };
  }
}

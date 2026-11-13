import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';

/**
 * Pesquisa na web e leitura de páginas da NICO, via Firecrawl (REST v1).
 *
 * Gating (Brief §2): sem `FIRECRAWL_API_KEY` as tools devolvem `config_required`
 * para o modelo, que avisa o usuário em vez de inventar pesquisa. O conteúdo
 * da web é DADO NÃO CONFIÁVEL: quem chama embrulha em <web> com aviso
 * anti prompt-injection (mesma regra do RAG, invariante 3).
 */

const BASE = 'https://api.firecrawl.dev/v1';
export const MAX_CHARS_PAGINA = 12_000;
export const MAX_CHARS_RESULTADO = 1_800;

export interface ResultadoBusca {
  titulo: string;
  url: string;
  descricao: string;
  trecho: string;
}

/** URL pública http(s) sem credencial embutida. O fetch sai do Firecrawl, não do nosso servidor. */
export function urlValida(bruta: string): URL | null {
  try {
    const u = new URL(bruta);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) return null;
    if (/^(localhost|.*\.local|.*\.internal)$/i.test(u.hostname) || /^(127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}

/** Texto da web nunca fecha a tag nem vira instrução. */
export function embrulharWeb(url: string, texto: string): string {
  return `<web url="${url.replace(/"/g, '')}">\n${texto.replace(/<\/web>/gi, '</ web>')}\n</web>`;
}

@Injectable()
export class FirecrawlService {
  private readonly log = new Logger('Firecrawl');
  private readonly circuito = new CircuitBreaker({ nome: 'Firecrawl', limiteFalhas: 4, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {}

  configurado(): boolean {
    return this.config.isConfigured('firecrawl');
  }

  private async chamar<T>(caminho: string, corpo: Record<string, unknown>, timeoutMs: number): Promise<T> {
    const chave = this.config.get('FIRECRAWL_API_KEY');
    const res = await this.circuito.run(async () => {
      const r = await fetch(`${BASE}${caminho}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${chave}` },
        body: JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // só 5xx/rede abre o circuito; 4xx é problema do pedido
      if (r.status >= 500) throw new Error(`Firecrawl ${r.status}`);
      return r;
    });
    if (res.status === 401 || res.status === 403) throw new Error('chave do Firecrawl inválida ou sem permissão');
    if (res.status === 402) throw new Error('créditos do Firecrawl esgotados');
    if (res.status === 429) throw new Error('limite de uso do Firecrawl atingido; tente em instantes');
    if (!res.ok) throw new Error(`Firecrawl respondeu ${res.status}: ${(await res.text().catch(() => '')).slice(0, 160)}`);
    return (await res.json()) as T;
  }

  /** Busca na web. `lerPaginas` traz o conteúdo (markdown) dos primeiros resultados, para benchmark. */
  async buscar(consulta: string, opcoes: { limite?: number; pais?: string; lerPaginas?: boolean } = {}): Promise<ResultadoBusca[]> {
    const limite = Math.min(Math.max(opcoes.limite ?? 5, 1), 8);
    const corpo: Record<string, unknown> = { query: consulta, limit: limite, lang: 'pt-br', country: (opcoes.pais ?? 'br').toLowerCase() };
    if (opcoes.lerPaginas) corpo.scrapeOptions = { formats: ['markdown'], onlyMainContent: true };
    const j = await this.chamar<{ success?: boolean; data?: { title?: string; url?: string; description?: string; markdown?: string }[] }>('/search', corpo, opcoes.lerPaginas ? 60_000 : 25_000);
    return (j.data ?? []).filter((d) => d.url).map((d) => ({
      titulo: (d.title ?? d.url ?? '').slice(0, 160),
      url: d.url!,
      descricao: (d.description ?? '').slice(0, 400),
      trecho: (d.markdown ?? '').slice(0, MAX_CHARS_RESULTADO),
    }));
  }

  /** Lê uma página como markdown limpo. */
  async lerPagina(url: string): Promise<{ titulo: string; url: string; markdown: string; truncado: boolean }> {
    const u = urlValida(url);
    if (!u) throw new Error('URL inválida: use um endereço público http(s)');
    const j = await this.chamar<{ success?: boolean; data?: { markdown?: string; metadata?: { title?: string; sourceURL?: string } } }>(
      '/scrape',
      { url: u.toString(), formats: ['markdown'], onlyMainContent: true, timeout: 40_000 },
      55_000,
    );
    const md = (j.data?.markdown ?? '').trim();
    if (!md) throw new Error('a página não retornou texto (pode exigir login ou ser só imagem)');
    return { titulo: j.data?.metadata?.title ?? u.hostname, url: j.data?.metadata?.sourceURL ?? u.toString(), markdown: md.slice(0, MAX_CHARS_PAGINA), truncado: md.length > MAX_CHARS_PAGINA };
  }
}

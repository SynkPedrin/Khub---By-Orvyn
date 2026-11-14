import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { CircuitBreaker } from '../common/circuit-breaker';
import { validarUrlPublica } from '../agents/knowledge/text-extraction';
import { ErroRede, mapearErroGoogle, mapearErroMeta, mapearErroTiktok, type InfoErroRede } from './redes.erros';
import type { RedeSocial } from './redes.tipos';

type Json = Record<string, unknown>;
type Mapeador = (status: number, corpo: unknown, esperadas: readonly string[]) => InfoErroRede;

const MAPEADOR: Record<RedeSocial, Mapeador> = { instagram: mapearErroMeta, tiktok: mapearErroTiktok, youtube: mapearErroGoogle };

/** Limite do arquivo baixado para o envio ao YouTube (o worker transmite, sem guardar em disco). */
export const LIMITE_VIDEO_BYTES = 2 * 1024 ** 3;

/**
 * Chamadas HTTP das três redes com erro ESTRUTURADO (`ErroRede`): o código
 * da rede chega até a tela para dizer qual permissão falta. Token sempre no
 * header `Authorization` (nunca na URL, que pode ir para log).
 */
@Injectable()
export class RedesHttp {
  private readonly circuitos: Record<RedeSocial, CircuitBreaker> = {
    instagram: new CircuitBreaker({ nome: 'Meta Redes', limiteFalhas: 5, cooldownMs: 30_000 }),
    tiktok: new CircuitBreaker({ nome: 'TikTok', limiteFalhas: 5, cooldownMs: 30_000 }),
    youtube: new CircuitBreaker({ nome: 'YouTube Redes', limiteFalhas: 5, cooldownMs: 30_000 }),
  };

  constructor(private readonly config: ConfigService) {}

  versaoMeta(): string {
    return this.config.get('META_GRAPH_VERSION') ?? 'v21.0';
  }

  private async chamar(rede: RedeSocial, url: string, init: RequestInit, esperadas: readonly string[], timeoutMs = 20_000): Promise<{ corpo: Json; resp: Response }> {
    let resp: Response;
    try {
      resp = await this.circuitos[rede].run(() => fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) }));
    } catch (e) {
      throw new ErroRede(rede, { tipo: 'indisponivel', mensagem: `Sem resposta da rede: ${(e as Error).message}`, faltando: [], codigo: null, httpStatus: 0, doc: '' });
    }
    const texto = await resp.text().catch(() => '');
    let corpo: Json = {};
    try {
      corpo = texto ? (JSON.parse(texto) as Json) : {};
    } catch {
      corpo = {};
    }
    const erroTiktok = rede === 'tiktok' && corpo.error && typeof corpo.error === 'object' && (corpo.error as Json).code !== 'ok';
    const erroOauth = typeof corpo.error === 'string';
    const erroGraph = rede !== 'tiktok' && corpo.error && typeof corpo.error === 'object';
    if (!resp.ok || erroTiktok || erroOauth || erroGraph) throw new ErroRede(rede, MAPEADOR[rede](resp.status, corpo, esperadas));
    return { corpo, resp };
  }

  /* ------------------------------ Meta ------------------------------ */

  private urlMeta(caminho: string, params: Record<string, unknown>): string {
    const u = new URL(`https://graph.facebook.com/${this.versaoMeta()}/${caminho}`);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return u.toString();
  }

  async metaGet(caminho: string, params: Record<string, unknown>, token: string | null, esperadas: readonly string[] = []): Promise<Json> {
    return (await this.chamar('instagram', this.urlMeta(caminho, params), { headers: token ? { Authorization: `Bearer ${token}` } : {} }, esperadas)).corpo;
  }

  /** POST com parâmetros na query (formato dos exemplos de DOC_REDES.igPublicacao). */
  async metaPost(caminho: string, params: Record<string, unknown>, token: string, esperadas: readonly string[] = []): Promise<Json> {
    return (await this.chamar('instagram', this.urlMeta(caminho, params), { method: 'POST', headers: { Authorization: `Bearer ${token}` } }, esperadas)).corpo;
  }

  /* ------------------------------ TikTok ---------------------------- */

  /** `POST /v2/oauth/token/` e `/v2/oauth/revoke/` (form). DOC_REDES.tiktokToken */
  async tiktokOauth(caminho: 'token' | 'revoke', form: Record<string, string>): Promise<Json> {
    return (
      await this.chamar('tiktok', `https://open.tiktokapis.com/v2/oauth/${caminho}/`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'cache-control': 'no-cache' },
        body: new URLSearchParams(form).toString(),
      }, [])
    ).corpo;
  }

  async tiktokGet(caminho: string, params: Record<string, string>, token: string, esperados: readonly string[]): Promise<Json> {
    const u = new URL(`https://open.tiktokapis.com/v2/${caminho}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return (await this.chamar('tiktok', u.toString(), { headers: { Authorization: `Bearer ${token}` } }, esperados)).corpo;
  }

  async tiktokPost(caminho: string, params: Record<string, string>, corpo: Json, token: string, esperados: readonly string[]): Promise<Json> {
    const u = new URL(`https://open.tiktokapis.com/v2/${caminho}`);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return (
      await this.chamar('tiktok', u.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(corpo),
      }, esperados)
    ).corpo;
  }

  /* ------------------------------ Google ---------------------------- */

  /** `POST https://oauth2.googleapis.com/token` (form). */
  async googleToken(form: Record<string, string>): Promise<Json> {
    return (
      await this.chamar('youtube', 'https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
      }, [])
    ).corpo;
  }

  /** GET na YouTube Data API v3 ou no YouTube Analytics API (URL base completa). */
  async googleGet(base: string, params: Record<string, unknown>, token: string, esperados: readonly string[]): Promise<Json> {
    const u = new URL(base);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return (await this.chamar('youtube', u.toString(), { headers: { Authorization: `Bearer ${token}` } }, esperados)).corpo;
  }

  /**
   * Envio retomável ao YouTube (DOC_REDES.ytUploadRetomavel): abre a sessão
   * com os metadados e transmite os bytes da mídia baixada da URL pública.
   */
  async youtubeEnviar(token: string, metadados: Json, midia: { corpo: ReadableStream<Uint8Array>; tamanho: number; tipo: string }, esperados: readonly string[]): Promise<Json> {
    const meta = JSON.stringify(metadados);
    const sessao = await this.chamar('youtube', 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-length': String(midia.tamanho),
        'x-upload-content-type': midia.tipo,
      },
      body: meta,
    }, esperados);
    const destino = sessao.resp.headers.get('location');
    if (!destino) throw new ErroRede('youtube', { tipo: 'outro', mensagem: 'O YouTube não devolveu a URL de envio.', faltando: [], codigo: null, httpStatus: sessao.resp.status, doc: '' });
    const init: RequestInit & { duplex: 'half' } = {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'content-length': String(midia.tamanho), 'content-type': midia.tipo },
      body: midia.corpo,
      duplex: 'half',
    };
    // Envio grande: sem o teto curto das leituras.
    return (await this.chamar('youtube', destino, init, esperados, 60 * 60_000)).corpo;
  }

  /**
   * Baixa a mídia de uma URL PÚBLICA (anti-SSRF: host e cada redirecionamento
   * validados) e devolve o corpo como stream, com tamanho e tipo.
   */
  async baixarMidia(url: string): Promise<{ corpo: ReadableStream<Uint8Array>; tamanho: number; tipo: string }> {
    let atual = await validarUrlPublica(url);
    for (let saltos = 0; saltos < 4; saltos++) {
      const r = await fetch(atual.toString(), { redirect: 'manual', signal: AbortSignal.timeout(60_000) });
      if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
        atual = await validarUrlPublica(new URL(r.headers.get('location')!, atual).toString());
        continue;
      }
      if (!r.ok || !r.body) throw new Error(`a URL da mídia respondeu ${r.status}`);
      const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim();
      const tamanho = Number(r.headers.get('content-length') ?? NaN);
      if (!/^video\//.test(tipo) && tipo !== 'application/octet-stream') throw new Error(`a URL não é de vídeo (${tipo || 'tipo desconhecido'})`);
      if (!Number.isFinite(tamanho) || tamanho <= 0) throw new Error('o servidor da mídia não informou o tamanho do arquivo (Content-Length)');
      if (tamanho > LIMITE_VIDEO_BYTES) throw new Error('vídeo maior que 2 GB');
      return { corpo: r.body as ReadableStream<Uint8Array>, tamanho, tipo: /^video\//.test(tipo) ? tipo : 'video/*' };
    }
    throw new Error('redirecionamentos demais na URL da mídia');
  }
}


import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../../config/config.service';
import { CircuitBreaker } from '../../../common/circuit-breaker';

/**
 * Erro de chamada a uma rede. `incerto` = não sabemos se a rede aceitou
 * (timeout/5xx): o envio NÃO é repetido sozinho (pode duplicar para o cliente).
 */
export class ErroCanal extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly incerto: boolean,
  ) {
    super(message);
    this.name = 'ErroCanal';
  }
}

type Json = Record<string, unknown>;

async function chamar(circuito: CircuitBreaker, rotulo: string, url: string, init: RequestInit): Promise<Json> {
  let resp: Response;
  try {
    resp = await circuito.run(() => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }));
  } catch (e) {
    throw new ErroCanal(`${rotulo}: sem resposta (${(e as Error).message})`, 0, true);
  }
  const j = (await resp.json().catch(() => ({}))) as Json & { error?: { message?: string } | string; error_description?: string };
  if (!resp.ok || (j.error && typeof j.error === 'object')) {
    const msg = typeof j.error === 'object' ? j.error?.message : j.error_description ?? (typeof j.error === 'string' ? j.error : undefined);
    throw new ErroCanal(`${rotulo} ${resp.status}: ${msg ?? 'erro'}`, resp.status, resp.status >= 500);
  }
  return j;
}

/** Graph API da Meta para Conversas (GET/POST/DELETE com token no header). Injetável para mock em teste. */
@Injectable()
export class MetaCanaisHttp {
  private readonly circuito = new CircuitBreaker({ nome: 'Meta Conversas', limiteFalhas: 5, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {}

  versao(): string {
    return this.config.get('META_GRAPH_VERSION') ?? 'v21.0';
  }

  private url(caminho: string, params: Record<string, unknown> = {}): URL {
    const u = new URL(`https://graph.facebook.com/${this.versao()}/${caminho}`);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return u;
  }

  get(caminho: string, params: Record<string, unknown>, token?: string): Promise<Json> {
    return chamar(this.circuito, 'Meta Graph', this.url(caminho, params).toString(), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  }

  post(caminho: string, corpo: Json, token: string, params: Record<string, unknown> = {}): Promise<Json> {
    return chamar(this.circuito, 'Meta Graph', this.url(caminho, params).toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  }
}

/** OAuth do Google + YouTube Data API v3. Injetável para mock em teste. */
@Injectable()
export class YoutubeHttp {
  private readonly circuito = new CircuitBreaker({ nome: 'YouTube', limiteFalhas: 5, cooldownMs: 30_000 });

  /** `POST https://oauth2.googleapis.com/token` (form). DOC.googleOauth */
  token(form: Record<string, string>): Promise<Json> {
    return chamar(this.circuito, 'Google OAuth', 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
    });
  }

  /** `POST https://oauth2.googleapis.com/revoke?token=` (melhor esforço). DOC.googleOauth */
  async revogar(token: string): Promise<void> {
    await chamar(this.circuito, 'Google OAuth', `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    }).catch(() => undefined);
  }

  get(recurso: string, params: Record<string, unknown>, token: string): Promise<Json> {
    const u = new URL(`https://www.googleapis.com/youtube/v3/${recurso}`);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return chamar(this.circuito, 'YouTube', u.toString(), { headers: { Authorization: `Bearer ${token}` } });
  }

  post(recurso: string, params: Record<string, unknown>, corpo: Json, token: string): Promise<Json> {
    const u = new URL(`https://www.googleapis.com/youtube/v3/${recurso}`);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, String(v));
    return chamar(this.circuito, 'YouTube', u.toString(), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
  }
}

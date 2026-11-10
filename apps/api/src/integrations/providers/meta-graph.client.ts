import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { CircuitBreaker } from '../../common/circuit-breaker';

/** Wrapper HTTP da Graph API (injetável para mock em teste). */
export interface GraphClient {
  get(path: string, params: Record<string, unknown>, accessToken?: string): Promise<any>;
}

export const META_GRAPH = Symbol('META_GRAPH');

@Injectable()
export class MetaGraphClient implements GraphClient {
  private readonly circuito = new CircuitBreaker({ nome: 'Meta Graph', limiteFalhas: 5, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {}

  private base(): string {
    return `https://graph.facebook.com/${this.config.get('META_GRAPH_VERSION') ?? 'v21.0'}`;
  }

  async get(path: string, params: Record<string, unknown>, accessToken?: string): Promise<any> {
    const url = new URL(`${this.base()}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    const r = await this.circuito.run(async () => {
      const resp = await fetch(url, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}, signal: AbortSignal.timeout(15_000) });
      if (resp.status >= 500) throw new Error(`Meta Graph ${resp.status}`);
      return resp;
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Meta Graph ${r.status}: ${j.error?.message ?? 'erro'}`);
    return j;
  }
}

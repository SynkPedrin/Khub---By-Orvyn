import { Injectable } from '@nestjs/common';

/** Wrapper HTTP da Graph API (injetável para mock em teste). */
export interface GraphClient {
  get(path: string, params: Record<string, unknown>, accessToken?: string): Promise<any>;
}

export const META_GRAPH = Symbol('META_GRAPH');

@Injectable()
export class MetaGraphClient implements GraphClient {
  private base(): string {
    return `https://graph.facebook.com/${process.env.META_GRAPH_VERSION ?? 'v21.0'}`;
  }

  async get(path: string, params: Record<string, unknown>, accessToken?: string): Promise<any> {
    const url = new URL(`${this.base()}/${path}`);
    for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, String(v));
    if (accessToken) url.searchParams.set('access_token', accessToken);
    const r = await fetch(url);
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(`Meta Graph ${r.status}: ${j.error?.message ?? 'erro'}`);
    return j;
  }
}

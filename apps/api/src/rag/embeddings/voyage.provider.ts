import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';
import { CircuitBreaker } from '../../common/circuit-breaker';
import type { EmbeddingInputType, EmbeddingProvider } from './embedding-provider';

/**
 * Provider real Voyage AI (`voyage-3-large`, 1024 dims). Usa fetch nativo do
 * Node 20. Sem a chave, `configured()` devolve false (o chamador degrada para
 * busca lexical) e `embed` lança erro claro — nunca retorna vetor fake.
 */
@Injectable()
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  private readonly log = new Logger(VoyageEmbeddingProvider.name);
  private readonly endpoint = 'https://api.voyageai.com/v1/embeddings';
  private readonly circuito = new CircuitBreaker({ nome: 'Voyage', limiteFalhas: 5, cooldownMs: 30_000 });

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get('VOYAGE_MODEL') ?? 'voyage-3-large';
  }
  get dims(): number {
    return Number(this.config.get('VOYAGE_DIMS') ?? 1024);
  }

  configured(): boolean {
    return this.config.isConfigured('voyage');
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const key = this.config.get('VOYAGE_API_KEY');
    if (!key) throw new Error('VOYAGE_API_KEY ausente: configure a chave para gerar embeddings.');
    const res = await this.circuito.run(async () => {
      const r = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ input: texts, model: this.model, input_type: inputType }),
      });
      if (r.status >= 500) throw new Error(`Voyage ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return r;
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Voyage ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

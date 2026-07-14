import { Logger } from '@nestjs/common';
import type { EmbeddingInputType, EmbeddingProvider } from './embedding-provider';

/**
 * Provider real Voyage AI (`voyage-3-large`, 1024 dims). Usa fetch nativo do
 * Node 20. Sem a chave, `embed` lança erro claro (nunca retorna vetor fake).
 */
export class VoyageEmbeddingProvider implements EmbeddingProvider {
  readonly model = process.env.VOYAGE_MODEL ?? 'voyage-3-large';
  readonly dims = Number(process.env.VOYAGE_DIMS ?? 1024);
  private readonly log = new Logger(VoyageEmbeddingProvider.name);
  private readonly endpoint = 'https://api.voyageai.com/v1/embeddings';

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const key = process.env.VOYAGE_API_KEY;
    if (!key) {
      throw new Error('VOYAGE_API_KEY ausente: configure a chave para gerar embeddings.');
    }
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ input: texts, model: this.model, input_type: inputType }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Voyage ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    return json.data.map((d) => d.embedding);
  }
}

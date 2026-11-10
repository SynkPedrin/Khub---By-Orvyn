import { Injectable } from '@nestjs/common';
import { CircuitBreaker } from '../../common/circuit-breaker';
import type { EmbeddingInputType, EmbeddingProvider } from './embedding-provider';

/**
 * Provider de embeddings via Ollama (`/api/embed`), mesmo caminho do chat da
 * NICO (AI_PROVIDER=ollama): zero dependência externa e zero custo por token.
 *
 * Modelo padrão `mxbai-embed-large`: 1024 dims — a MESMA dimensão da coluna
 * `rag_chunks.embedding (vector(1024))` e do `voyage-3-large`, então nenhum
 * schema muda. ATENÇÃO: espaços vetoriais de modelos diferentes não se
 * misturam — ao trocar de provider, re-embedar TODOS os chunks (foi o que o
 * backfill local fez) e o `embedding_model` gravado passa a valer como marca.
 *
 * `configured()` é sempre true: o Ollama não tem credencial. Se o servidor
 * estiver fora, o circuit breaker fail-fasta e o chamador degrada (busca
 * lexical) como já fazia com a Voyage.
 */
@Injectable()
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  private readonly circuito = new CircuitBreaker({ nome: 'OllamaEmbed', limiteFalhas: 5, cooldownMs: 30_000 });

  get model(): string {
    return process.env.OLLAMA_EMBED_MODEL ?? 'mxbai-embed-large';
  }
  get dims(): number {
    return Number(process.env.OLLAMA_EMBED_DIMS ?? 1024);
  }

  private get endpoint(): string {
    return `${(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, '')}/api/embed`;
  }

  configured(): boolean {
    return true;
  }

  async embed(texts: string[], _inputType: EmbeddingInputType): Promise<number[][]> {
    const res = await this.circuito.run(async () => {
      const r = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: AbortSignal.timeout(120_000),
      });
      if (r.status >= 500) throw new Error(`OllamaEmbed ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
      return r;
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`OllamaEmbed ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { embeddings: number[][] };
    return json.embeddings;
  }
}

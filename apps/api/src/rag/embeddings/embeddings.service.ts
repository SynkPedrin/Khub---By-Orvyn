import { Inject, Injectable, Logger } from '@nestjs/common';
import { EMBEDDING_PROVIDER, type EmbeddingInputType, type EmbeddingProvider } from './embedding-provider';

export interface EmbeddingsOptions {
  batchSize: number;
  maxRetries: number;
  baseDelayMs: number;
}

/**
 * Orquestra embeddings: batch + retry exponencial sobre um provider abstrato
 * (R1.2). Degradação suave documentada: após maxRetries, propaga o erro para o
 * chamador (ingestão marca o doc como `failed`; busca declara lacuna).
 */
@Injectable()
export class EmbeddingsService {
  private readonly log = new Logger(EmbeddingsService.name);
  private readonly opts: EmbeddingsOptions;

  constructor(
    @Inject(EMBEDDING_PROVIDER) private readonly provider: EmbeddingProvider,
    opts: Partial<EmbeddingsOptions> = {},
  ) {
    this.opts = {
      batchSize: opts.batchSize ?? Number(process.env.RAG_EMBED_BATCH ?? 96),
      maxRetries: opts.maxRetries ?? 3,
      baseDelayMs: opts.baseDelayMs ?? 200,
    };
  }

  get dims(): number {
    return this.provider.dims;
  }

  /** Há credencial para gerar embeddings? Se não, o chamador degrada para lexical. */
  get available(): boolean {
    return this.provider.configured?.() ?? true;
  }

  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.opts.batchSize) {
      const batch = texts.slice(i, i + this.opts.batchSize);
      out.push(...(await this.withRetry(() => this.provider.embed(batch, inputType))));
    }
    return out;
  }

  async embedOne(text: string, inputType: EmbeddingInputType): Promise<number[]> {
    const [v] = await this.embed([text], inputType);
    return v;
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (attempt === this.opts.maxRetries) break;
        const delay = this.opts.baseDelayMs * 2 ** attempt;
        this.log.warn(`embed falhou (tentativa ${attempt + 1}): ${(e as Error).message}; retry em ${delay}ms`);
        await sleep(delay);
      }
    }
    throw lastErr;
  }

  /**
   * Serializa um vetor para literal SQL `[..]::vector`. Valida que todo item é
   * número finito — barreira contra injeção no $queryRawUnsafe (BUG-001).
   */
  static toSqlVector(vec: number[]): string {
    for (const n of vec) {
      if (typeof n !== 'number' || !Number.isFinite(n)) {
        throw new Error('vetor inválido: todos os componentes devem ser números finitos');
      }
    }
    return `[${vec.join(',')}]`;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

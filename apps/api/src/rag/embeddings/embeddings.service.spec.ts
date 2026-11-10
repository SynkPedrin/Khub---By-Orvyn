import { EmbeddingsService } from './embeddings.service';
import type { EmbeddingInputType, EmbeddingProvider } from './embedding-provider';

class FakeProvider implements EmbeddingProvider {
  readonly model = 'fake';
  readonly dims = 4;
  calls: { texts: string[]; inputType: EmbeddingInputType }[] = [];
  failTimes = 0;
  constructor(failTimes = 0) {
    this.failTimes = failTimes;
  }
  async embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]> {
    this.calls.push({ texts, inputType });
    if (this.failTimes > 0) {
      this.failTimes--;
      throw new Error('provedor instável');
    }
    return texts.map(() => [0.1, 0.2, 0.3, 0.4]);
  }
}

describe('EmbeddingsService (R1.2)', () => {
  it('faz batch conforme batchSize', async () => {
    const p = new FakeProvider();
    const svc = new EmbeddingsService(p, { batchSize: 96, baseDelayMs: 0 });
    const texts = Array.from({ length: 200 }, (_, i) => `t${i}`);
    const out = await svc.embed(texts, 'document');
    expect(out).toHaveLength(200);
    expect(p.calls.map((c) => c.texts.length)).toEqual([96, 96, 8]);
    expect(p.calls[0].inputType).toBe('document');
  });

  it('retenta com backoff e sucede', async () => {
    const p = new FakeProvider(2); // falha 2x, sucede na 3ª
    const svc = new EmbeddingsService(p, { maxRetries: 3, baseDelayMs: 0 });
    const [v] = await svc.embed(['oi'], 'query');
    expect(v).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(p.calls.length).toBe(3);
  });

  it('propaga erro após esgotar retries', async () => {
    const p = new FakeProvider(99);
    const svc = new EmbeddingsService(p, { maxRetries: 2, baseDelayMs: 0 });
    await expect(svc.embed(['x'], 'query')).rejects.toThrow('provedor instável');
    expect(p.calls.length).toBe(3); // 1 + 2 retries
  });

  it('toSqlVector serializa e valida números', () => {
    expect(EmbeddingsService.toSqlVector([0.1, 0.2, -3])).toBe('[0.1,0.2,-3]');
    expect(() => EmbeddingsService.toSqlVector([0.1, NaN])).toThrow();
    expect(() => EmbeddingsService.toSqlVector([1, Infinity])).toThrow();
  });
});

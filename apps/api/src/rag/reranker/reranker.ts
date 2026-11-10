export interface RerankDoc {
  id: string;
  text: string;
  baseScore: number; // score do estágio híbrido (RRF + boost)
}

export interface RerankResult {
  id: string;
  score: number;
}

export interface Reranker {
  /**
   * `calibrated=true` significa que `score` é comparável a RAG_MIN_SCORE (0..1),
   * de um cross-encoder. `false` = sem cross-encoder (baseline): NÃO aplicar o
   * corte por MIN_SCORE, pois os scores são do RRF (escala diferente).
   */
  readonly calibrated: boolean;
  rerank(query: string, docs: RerankDoc[], topN: number): Promise<RerankResult[]>;
}

export const RERANKER = Symbol('RERANKER');

/**
 * Baseline R1: mantém a ordem do estágio híbrido e corta em topN, preservando
 * o score do RRF. O cross-encoder (Voyage `rerank-2.5`, ADR-04) entra em R2.2.
 */
export class IdentityReranker implements Reranker {
  readonly calibrated = false;

  async rerank(_query: string, docs: RerankDoc[], topN: number): Promise<RerankResult[]> {
    return docs
      .slice()
      .sort((a, b) => b.baseScore - a.baseScore)
      .slice(0, topN)
      .map((d) => ({ id: d.id, score: d.baseScore }));
  }
}

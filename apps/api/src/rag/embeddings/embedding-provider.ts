export type EmbeddingInputType = 'query' | 'document';

/** Abstração de provider de embeddings (ADR-05). Permite trocar Voyage/OpenAI
 *  e mockar em teste sem chamar rede. */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dims: number;
  embed(texts: string[], inputType: EmbeddingInputType): Promise<number[][]>;
  /** false = sem credencial; o chamador degrada (busca lexical) em vez de quebrar.
   *  Provider que omite o método é considerado sempre disponível (ex.: fake de teste). */
  configured?(): boolean;
}

export const EMBEDDING_PROVIDER = Symbol('EMBEDDING_PROVIDER');

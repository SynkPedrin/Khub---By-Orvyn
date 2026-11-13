import { Module } from '@nestjs/common';
import { ChunkingService } from './chunking.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embeddings/embedding-provider';
import { VoyageEmbeddingProvider } from './embeddings/voyage.provider';
import { OllamaEmbeddingProvider } from './embeddings/ollama.provider';
import { RAG_CACHE } from './cache/rag-cache';
import { InMemoryRagCache } from './cache/rag-cache';
import { RERANKER } from './reranker/reranker';
import { IdentityReranker } from './reranker/reranker';
import { RetrievalService } from './retrieval.service';
import { IngestionService } from './ingestion/ingestion.service';
import { IngestionProcessor } from './ingestion/ingestion.processor';
import { InProcessIngestionQueue } from './ingestion/in-process.queue';
import { INGESTION_QUEUE } from './ingestion/ingestion.types';
import { SearchKnowledgeTool } from './search-knowledge.tool';
import { RagController } from './rag.controller';

@Module({
  controllers: [RagController],
  providers: [
    ChunkingService,
    VoyageEmbeddingProvider,
    OllamaEmbeddingProvider,
    // Embeddings seguem o backend de IA: AI_PROVIDER=ollama → vetores locais
    // via Ollama (mxbai-embed-large, 1024 dims); caso contrário, Voyage.
    {
      provide: EMBEDDING_PROVIDER,
      inject: [VoyageEmbeddingProvider, OllamaEmbeddingProvider],
      useFactory: (voyage: EmbeddingProvider, ollama: EmbeddingProvider): EmbeddingProvider =>
        ['ollama', 'openai'].includes((process.env.AI_PROVIDER || '').toLowerCase().trim()) ? ollama : voyage,
    },
    {
      provide: EmbeddingsService,
      inject: [EMBEDDING_PROVIDER],
      useFactory: (provider: EmbeddingProvider) => new EmbeddingsService(provider),
    },
    { provide: RAG_CACHE, useClass: InMemoryRagCache },
    { provide: RERANKER, useClass: IdentityReranker },
    RetrievalService,
    IngestionProcessor,
    { provide: INGESTION_QUEUE, useClass: InProcessIngestionQueue },
    IngestionService,
    SearchKnowledgeTool,
  ],
  exports: [RetrievalService, SearchKnowledgeTool, IngestionService],
})
export class RagModule {}

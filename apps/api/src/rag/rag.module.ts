import { Module } from '@nestjs/common';
import { ChunkingService } from './chunking.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from './embeddings/embedding-provider';
import { VoyageEmbeddingProvider } from './embeddings/voyage.provider';
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
    { provide: EMBEDDING_PROVIDER, useClass: VoyageEmbeddingProvider },
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

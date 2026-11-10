import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { RagEscopo } from '@khub/types';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionService } from './ingestion/ingestion.service';
import { RetrievalService } from './retrieval.service';
import { FeedbackDto, RegisterDocumentDto, SearchDebugDto } from './dto/rag.dto';
import { TenantId } from '../auth/decorators';

/** Rotas do RAG. Tenant vem do JWT (@TenantId), nunca de header do browser. */
@Controller('rag')
export class RagController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly retrieval: RetrievalService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('documents')
  @HttpCode(202)
  async register(@TenantId() tenantId: string, @Body() dto: RegisterDocumentDto) {
    // Ingestão de base do tenant. Bases global/nicho são publicadas por script (khub_service).
    return this.ingestion.register({
      tenantId,
      escopo: 'tenant',
      nicho: dto.nicho ?? null,
      subespecialidade: dto.subespecialidade ?? null,
      titulo: dto.titulo,
      fonte: dto.fonte,
      mime: dto.mime,
      content: dto.content,
    });
  }

  @Post('search')
  async search(@TenantId() tenantId: string, @Body() dto: SearchDebugDto) {
    const ctx = { tenantId, nicho: dto.nicho, subespecialidade: dto.subespecialidade ?? null };
    const hits = await this.retrieval.search(ctx, dto.query, dto.escopos as RagEscopo[] | undefined);
    return { hits, context: this.retrieval.buildContext(hits) };
  }

  @Post('feedback')
  @HttpCode(201)
  async feedback(@TenantId() tenantId: string, @Body() dto: FeedbackDto) {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.$executeRaw`
        INSERT INTO rag_feedback (tenant_id, query_id, resposta, chunk_ids, voto, comentario)
        VALUES (${tenantId}::uuid, ${dto.queryId ?? null}::uuid, ${dto.resposta},
                ${dto.chunkIds}::uuid[], ${dto.voto}, ${dto.comentario ?? null})`,
    );
    return { ok: true };
  }
}

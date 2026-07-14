import { BadRequestException, Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import type { RagEscopo } from '@orvyn/types';
import { PrismaService } from '../prisma/prisma.service';
import { IngestionService } from './ingestion/ingestion.service';
import { RetrievalService, type RagContext } from './retrieval.service';
import { FeedbackDto, RegisterDocumentDto, SearchDebugDto } from './dto/rag.dto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Rotas do RAG. `x-tenant-id` é uma ponte de DEV até o módulo `auth` existir
 * (F0-11); em produção o tenant vem do JWT, nunca de header/cliente.
 */
@Controller('rag')
export class RagController {
  constructor(
    private readonly ingestion: IngestionService,
    private readonly retrieval: RetrievalService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('documents')
  @HttpCode(202)
  async register(@Body() dto: RegisterDocumentDto) {
    return this.ingestion.register({
      tenantId: dto.tenantId ?? null,
      escopo: dto.escopo,
      nicho: dto.nicho ?? null,
      subespecialidade: dto.subespecialidade ?? null,
      titulo: dto.titulo,
      fonte: dto.fonte,
      mime: dto.mime,
      content: dto.content,
    });
  }

  @Post('search')
  async search(@Headers('x-tenant-id') tenantId: string | undefined, @Body() dto: SearchDebugDto) {
    const ctx = this.requireTenant(tenantId, dto.nicho, dto.subespecialidade);
    const hits = await this.retrieval.search(ctx, dto.query, dto.escopos as RagEscopo[] | undefined);
    return { hits, context: this.retrieval.buildContext(hits) };
  }

  @Post('feedback')
  @HttpCode(201)
  async feedback(@Headers('x-tenant-id') tenantId: string | undefined, @Body() dto: FeedbackDto) {
    if (!tenantId || !UUID_RE.test(tenantId)) throw new BadRequestException('x-tenant-id (UUID) obrigatório');
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.$executeRaw`
        INSERT INTO rag_feedback (tenant_id, query_id, resposta, chunk_ids, voto, comentario)
        VALUES (${tenantId}::uuid, ${dto.queryId ?? null}::uuid, ${dto.resposta},
                ${dto.chunkIds}::uuid[], ${dto.voto}, ${dto.comentario ?? null})`,
    );
    return { ok: true };
  }

  private requireTenant(tenantId: string | undefined, nicho: string, sub?: string): RagContext {
    if (!tenantId || !UUID_RE.test(tenantId)) {
      throw new BadRequestException('x-tenant-id (UUID) obrigatório');
    }
    return { tenantId, nicho, subespecialidade: sub ?? null };
  }
}

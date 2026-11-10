import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ChunkingService } from '../chunking.service';
import { EmbeddingsService } from '../embeddings/embeddings.service';

interface DocRow {
  id: string;
  tenantId: string | null;
  escopo: string;
  nicho: string | null;
  subespecialidade: string | null;
}

/**
 * Processa um documento: parse/chunk -> embed -> upsert de chunks (R1.3).
 * Idempotente: apaga os chunks do documento antes de reinserir, então
 * reprocessar N vezes gera a mesma contagem, zero duplicata.
 * Contextual Retrieval (ADR-03) entra em R2.1; aqui o chunk vai cru.
 * Bases compartilhadas (global/nicho/sub) são escritas pela role de serviço (BYPASSRLS).
 */
@Injectable()
export class IngestionProcessor {
  private readonly log = new Logger(IngestionProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly chunking: ChunkingService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /**
   * `tenantId` = dono do documento (null = base compartilhada). BUG-022: com RLS
   * FORCE, ler/gravar documento e chunks de TENANT exige `app.current_tenant_id`
   * na transação — sem ele o documento "não existia" e o chunk violava a policy.
   */
  async process(documentId: string, content: string, tenantId: string | null = null): Promise<{ chunks: number }> {
    const doc = (await this.noEscopo(tenantId, (db) =>
      db.ragDocument.findUnique({
        where: { id: documentId },
        select: { id: true, tenantId: true, escopo: true, nicho: true, subespecialidade: true },
      }),
    )) as DocRow | null;
    if (!doc) throw new Error(`documento ${documentId} não encontrado`);

    try {
      const chunks = this.chunking.chunk(content);
      if (!chunks.length) {
        await this.setStatus(tenantId, documentId, 'published', null);
        return { chunks: 0 };
      }
      // Sem credencial de embedding: grava os chunks SEM vetor (a busca lexical
      // já funciona) e marca o documento para reindexar quando a chave chegar —
      // degradação suave (Brief §2), em vez de deixar a base inteira em `failed`.
      const lexical = !this.embeddings.available;
      const vectors = lexical ? chunks.map(() => null) : await this.embeddings.embed(chunks.map((c) => c.conteudo), 'document');
      await this.writeChunks(tenantId, doc, chunks, vectors);
      await this.setStatus(tenantId, documentId, 'published', null, { indexacao: lexical ? 'lexical' : 'hibrida', chunks: chunks.length });
      return { chunks: chunks.length };
    } catch (e) {
      const msg = (e as Error).message;
      this.log.error(`falha ao processar ${documentId}: ${msg}`);
      await this.setStatus(tenantId, documentId, 'failed', msg).catch(() => undefined);
      throw e;
    }
  }

  /** Transação sob a RLS do tenant (base de cliente) ou comum (base compartilhada). */
  private noEscopo<T>(tenantId: string | null, work: (db: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return tenantId ? this.prisma.withTenant(tenantId, work) : this.prisma.$transaction(work);
  }

  private async writeChunks(
    tenantId: string | null,
    doc: DocRow,
    chunks: { ordem: number; breadcrumb: string | null; conteudo: string; tokens: number }[],
    vectors: (number[] | null)[],
  ): Promise<void> {
    await this.noEscopo(tenantId, async (tx) => {
      await tx.$executeRawUnsafe(`DELETE FROM rag_chunks WHERE document_id = $1::uuid`, doc.id);
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const v = vectors[i];
        const vec = v ? EmbeddingsService.toSqlVector(v) : null;
        await tx.$executeRawUnsafe(
          `INSERT INTO rag_chunks
             (document_id, tenant_id, escopo, nicho, subespecialidade, ordem, breadcrumb, conteudo, tokens, embedding, embedding_model, status)
           VALUES ($1::uuid, $2::uuid, $3::rag_escopo, $4, $5, $6, $7, $8, $9, $10::vector, $11, 'published')`,
          doc.id,
          doc.tenantId,
          doc.escopo,
          doc.nicho,
          doc.subespecialidade,
          c.ordem,
          c.breadcrumb,
          c.conteudo,
          c.tokens,
          vec,
          v ? (this.embeddings.dims === 1024 ? 'voyage-3-large' : `dims-${this.embeddings.dims}`) : 'none',
        );
      }
    });
  }

  private async setStatus(tenantId: string | null, id: string, status: string, erro: string | null, meta?: Record<string, unknown>): Promise<void> {
    await this.noEscopo(tenantId, async (db) => {
      await db.ragDocument.update({
        where: { id },
        data: {
          status: status as never,
          erro,
          publishedAt: status === 'published' ? new Date() : null,
          updatedAt: new Date(),
        },
      });
      // Merge atômico (`||`): quem grava outras chaves de metadados em paralelo não perde nada.
      if (meta) {
        await db.$executeRaw`UPDATE rag_documents SET metadados = metadados || ${JSON.stringify({ ...meta, processadoEm: new Date().toISOString() })}::jsonb WHERE id = ${id}::uuid`;
      }
    });
  }
}

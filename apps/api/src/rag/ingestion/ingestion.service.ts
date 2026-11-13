import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  assertEscopoCoerente,
  INGESTION_QUEUE,
  type IngestionInput,
  type IngestionQueue,
  type IngestionResult,
} from './ingestion.types';

/**
 * Registro de documentos no RAG (R1.3). Idempotente por `content_hash`:
 * reenviar o mesmo conteúdo não cria documento duplicado. O processamento
 * pesado (chunk/embed) roda no IngestionProcessor via fila.
 */
@Injectable()
export class IngestionService {
  private readonly log = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(INGESTION_QUEUE) private readonly queue: IngestionQueue,
  ) {}

  static contentHash(content: string): string {
    return createHash('sha256').update(content, 'utf8').digest('hex');
  }

  /**
   * Reindexação (db/034): reenvia para a fila o texto guardado em
   * `rag_documents.texto_fonte`. Usado quando a chave de embedding chega depois
   * (documento lexical → híbrido) ou quando o chunking muda.
   */
  async reprocessar(tenantId: string, documentId: string): Promise<{ id: string; status: string }> {
    const doc = await this.prisma.withTenant(tenantId, async (tx) => {
      const d = await tx.ragDocument.findUnique({ where: { id: documentId }, select: { id: true, tenantId: true, textoFonte: true } });
      if (!d || d.tenantId !== tenantId) return null;
      await tx.ragDocument.update({ where: { id: documentId }, data: { status: 'pending', erro: null, updatedAt: new Date() } });
      return d;
    });
    if (!doc) throw new Error('documento inexistente');
    if (!doc.textoFonte) throw new Error('documento sem texto de origem guardado: envie a fonte de novo');
    await this.queue.enqueue(doc.id, doc.textoFonte, tenantId);
    return { id: doc.id, status: 'pending' };
  }

  async register(input: IngestionInput): Promise<IngestionResult> {
    assertEscopoCoerente(input);
    const contentHash = IngestionService.contentHash(input.content);

    // BUG-022: base de TENANT só é gravável com `app.current_tenant_id` setado
    // (RLS FORCE em rag_documents; khub_app não tem BYPASSRLS). Sem isso a
    // escrita falhava na policy. Bases compartilhadas seguem pela role de serviço.
    const gravar = async (db: Prisma.TransactionClient | PrismaService) => {
      const existing = await db.ragDocument.findFirst({
        where: { tenantId: input.tenantId ?? null, escopo: input.escopo, contentHash },
        select: { id: true, status: true },
      });
      if (existing) return { ...existing, deduped: true };
      const doc = await db.ragDocument.create({
        data: {
          tenantId: input.tenantId ?? null,
          escopo: input.escopo,
          nicho: input.nicho ?? null,
          subespecialidade: input.subespecialidade ?? null,
          titulo: input.titulo,
          fonte: input.fonte,
          mime: input.mime ?? 'text/markdown',
          contentHash,
          status: 'pending',
          criadoPor: input.criadoPor ?? null,
        },
        select: { id: true, status: true },
      });
      return { ...doc, deduped: false };
    };
    const doc = input.escopo === 'tenant' && input.tenantId ? await this.prisma.withTenant(input.tenantId, gravar) : await gravar(this.prisma);
    const tenantDaFila = input.escopo === 'tenant' ? input.tenantId ?? null : null;
    if (doc.deduped) {
      // Mesmo conteúdo de um documento que FALHOU (ex.: embedding fora do ar) volta
      // para a fila — sem isso ele ficaria preso em `failed` para sempre.
      if (doc.status === 'failed') {
        this.log.warn(`documento ${doc.id} tinha falhado -> reprocessando`);
        await this.queue.enqueue(doc.id, input.content, tenantDaFila);
        return { id: doc.id, status: doc.status, deduped: false };
      }
      this.log.debug(`documento já existe (hash ${contentHash.slice(0, 12)}) -> dedupe`);
      return { id: doc.id, status: doc.status, deduped: true };
    }

    await this.queue.enqueue(doc.id, input.content, tenantDaFila);
    return { id: doc.id, status: doc.status, deduped: false };
  }
}

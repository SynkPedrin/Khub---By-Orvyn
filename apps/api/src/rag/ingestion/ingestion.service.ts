import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
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

  async register(input: IngestionInput): Promise<IngestionResult> {
    assertEscopoCoerente(input);
    const contentHash = IngestionService.contentHash(input.content);

    const existing = await this.prisma.ragDocument.findFirst({
      where: { tenantId: input.tenantId ?? null, escopo: input.escopo, contentHash },
      select: { id: true, status: true },
    });
    if (existing) {
      this.log.debug(`documento já existe (hash ${contentHash.slice(0, 12)}) -> dedupe`);
      return { id: existing.id, status: existing.status, deduped: true };
    }

    const doc = await this.prisma.ragDocument.create({
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

    await this.queue.enqueue(doc.id, input.content);
    return { id: doc.id, status: doc.status, deduped: false };
  }
}

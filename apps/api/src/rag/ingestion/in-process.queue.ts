import { Injectable, Logger } from '@nestjs/common';
import { IngestionProcessor } from './ingestion.processor';
import type { IngestionQueue } from './ingestion.types';

/**
 * Fila in-process (dev/single-node): processa o documento de forma assíncrona
 * (fire-and-forget com catch). É uma fila REAL, não um mock. O path de escala
 * com durabilidade/retries/DLQ é BullMQ (ADR-08), habilitado quando houver Redis.
 */
@Injectable()
export class InProcessIngestionQueue implements IngestionQueue {
  private readonly log = new Logger(InProcessIngestionQueue.name);

  constructor(private readonly processor: IngestionProcessor) {}

  async enqueue(documentId: string, content: string, tenantId: string | null): Promise<void> {
    void this.processor
      .process(documentId, content, tenantId)
      .then((r) => this.log.debug(`documento ${documentId} processado: ${r.chunks} chunks`))
      .catch((e) => this.log.error(`processamento de ${documentId} falhou: ${(e as Error).message}`));
  }
}

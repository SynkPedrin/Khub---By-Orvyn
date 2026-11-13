import type { RagEscopo } from '@khub/types';

export interface IngestionInput {
  tenantId?: string | null;
  escopo: RagEscopo;
  nicho?: string | null;
  subespecialidade?: string | null;
  titulo: string;
  fonte: string;
  mime?: string;
  content: string;
  criadoPor?: string | null;
}

export interface IngestionResult {
  id: string;
  status: string;
  deduped: boolean;
}

/** Transporte de ingestão. Impl in-process agora; BullMQ é o path de escala
 *  (ADR-08) quando houver Redis. */
export interface IngestionQueue {
  /** `tenantId` do documento (null = base compartilhada): o processador grava sob a RLS dele (BUG-022). */
  enqueue(documentId: string, content: string, tenantId: string | null): Promise<void>;
}

export const INGESTION_QUEUE = Symbol('INGESTION_QUEUE');

/** Valida a coerência escopo x campos (espelha o CHECK chk_escopo_campos do 001). */
export function assertEscopoCoerente(input: IngestionInput): void {
  const { escopo, tenantId, nicho, subespecialidade } = input;
  const ok =
    (escopo === 'global' && !tenantId && !nicho) ||
    (escopo === 'nicho' && !tenantId && !!nicho) ||
    (escopo === 'sub' && !tenantId && !!nicho && !!subespecialidade) ||
    (escopo === 'tenant' && !!tenantId);
  if (!ok) {
    throw new Error(`escopo '${escopo}' incoerente com os campos (tenantId/nicho/subespecialidade)`);
  }
}

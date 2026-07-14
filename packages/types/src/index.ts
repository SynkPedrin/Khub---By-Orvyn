// Contratos compartilhados do Orvyn. Espelham os enums/entidades de db/*.sql.
// Fonte da verdade do schema: db/001_rag_schema.sql. Ver Nyro IA/cerebro/Banco.md.

export type RagEscopo = 'global' | 'nicho' | 'sub' | 'tenant';

export type RagDocStatus =
  | 'pending'
  | 'processing'
  | 'published'
  | 'failed'
  | 'superseded'
  | 'candidate';

/** Boost de escopo pós-RRF (ver RAG.md §5). */
export const RAG_ESCOPO_BOOST: Record<RagEscopo, number> = {
  tenant: 1.35,
  sub: 1.2,
  nicho: 1.1,
  global: 1.0,
};

export interface RagHit {
  chunkId: string;
  documentId: string;
  escopo: RagEscopo;
  titulo: string;
  breadcrumb: string | null;
  conteudo: string;
  score: number;
}

/** Erro padronizado RFC 7807 (ver APIs.md §4). */
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
}

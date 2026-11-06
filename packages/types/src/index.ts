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

// ======================= Tempo real (Sprint D2 — ADR-0011) =======================

/**
 * Contrato dos eventos do socket. Front e back importam DAQUI: evento novo sem
 * tipo aqui não compila. Todo evento é entregue apenas na sala do tenant —
 * o `tenantId` NUNCA vem do cliente, sempre do ticket assinado.
 */
/** Quem responde a conversa agora: um agente de IA ou um humano (ADR-0030). */
export type AtendimentoConversa = 'ia' | 'humano';

export interface RealtimeEvents {
  'message.created': {
    conversationId: string;
    id: string;
    de: string; // contato | humano | ia | nyro
    texto: string;
    hora: string | null;
    /** Agente que escreveu, quando `de === 'ia'` (ADR-0030). */
    agentId?: string | null;
  };
  'conversation.updated': {
    id: string;
    ultimaPrevia?: string | null;
    ultimaHora?: string | null;
    naoLidas?: number;
    /** Estado do atendimento (ADR-0030). Ausente = não mudou neste evento. */
    atendimento?: AtendimentoConversa;
    agentId?: string | null;
    assigneeId?: string | null;
    handoffMotivo?: string | null;
  };
  'deal.moved': { id: string; stageId: string; stageAnterior: string | null };
  'deal.created': { id: string; stageId: string };
  'deal.updated': { id: string };
  'deal.deleted': { id: string };
  /** Status do negócio mudou (ganho/perdido/aberto) — gatilho de pós-venda/reativação. */
  'deal.status_changed': { id: string; status: string; contactId: string | null };
  'contact.created': { id: string; nome: string; origem: string };
  'contact.tagged': { id: string; tag: string };
  /** Execução de automação ao vivo (Sprint E): alimenta a timeline da run. */
  'automation.run': { runId: string; workflowId: string; nodeId: string; status: string };
}

export type RealtimeEvent = keyof RealtimeEvents;
export type RealtimePayload<E extends RealtimeEvent> = RealtimeEvents[E];

/** Envelope entregue ao cliente: `emitidoEm` permite descartar evento atrasado. */
export interface RealtimeEnvelope<E extends RealtimeEvent = RealtimeEvent> {
  evento: E;
  dados: RealtimeEvents[E];
  emitidoEm: string; // ISO
}

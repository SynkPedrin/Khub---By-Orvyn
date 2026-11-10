import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { RagEscopo, RagHit } from '@khub/types';
import { RetrievalService, type RagContext } from './retrieval.service';

const ESCOPOS = ['tenant', 'sub', 'nicho', 'global'] as const;

/**
 * Argumentos que o LLM pode passar. NOTE: NÃO existe `tenantId` aqui — o tenant
 * vem SEMPRE da sessão (R1.5). `.strip()` descarta qualquer chave extra que o
 * modelo tente injetar (ex.: um tenantId de outra conta).
 */
const SearchArgs = z
  .object({
    query: z.string().min(1).max(1000),
    escopos: z.array(z.enum(ESCOPOS)).nonempty().optional(),
  })
  .strip();

export interface SearchKnowledgeOutput {
  context: string;
  hits: RagHit[];
}

/** Definição da tool para function calling (sem tenantId no schema). */
export const SEARCH_KNOWLEDGE_TOOL = {
  name: 'search_knowledge',
  description:
    'Busca conhecimento do nicho/subespecialidade/tenant para embasar a resposta. Retorna trechos citáveis por [#id]. Use antes de responder qualquer coisa de nicho, preço, prazo ou protocolo.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'A pergunta ou termo a buscar.' },
      escopos: {
        type: 'array',
        items: { type: 'string', enum: [...ESCOPOS] },
        description: 'Opcional: restringe os níveis de herança pesquisados.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
} as const;

@Injectable()
export class SearchKnowledgeTool {
  constructor(private readonly retrieval: RetrievalService) {}

  /**
   * @param session contexto autenticado (tenantId/nicho/sub) — a ÚNICA fonte de tenant.
   * @param rawArgs argumentos vindos do LLM (não confiáveis).
   */
  async execute(session: RagContext, rawArgs: unknown): Promise<SearchKnowledgeOutput> {
    const args = SearchArgs.parse(rawArgs);
    const escopos = args.escopos as RagEscopo[] | undefined;
    const hits = await this.retrieval.search(session, args.query, escopos);
    return { context: this.retrieval.buildContext(hits), hits };
  }
}

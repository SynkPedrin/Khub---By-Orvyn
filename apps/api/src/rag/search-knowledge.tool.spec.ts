import { SearchKnowledgeTool, SEARCH_KNOWLEDGE_TOOL } from './search-knowledge.tool';
import type { RetrievalService, RagContext } from './retrieval.service';

const SESSION_A: RagContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  nicho: 'medico',
  subespecialidade: null,
};

describe('SearchKnowledgeTool (R1.5)', () => {
  it('a definição da tool NÃO expõe tenantId ao LLM', () => {
    expect(Object.keys(SEARCH_KNOWLEDGE_TOOL.input_schema.properties)).not.toContain('tenantId');
    expect(SEARCH_KNOWLEDGE_TOOL.input_schema.required).toEqual(['query']);
  });

  it('ignora tenantId injetado nos args e usa o da sessão', async () => {
    const search = jest.fn().mockResolvedValue([]);
    const buildContext = jest.fn().mockReturnValue('CTX');
    const retrieval = { search, buildContext } as unknown as RetrievalService;
    const tool = new SearchKnowledgeTool(retrieval);

    await tool.execute(SESSION_A, {
      query: 'qual o valor da consulta?',
      tenantId: '22222222-2222-2222-2222-222222222222', // LLM tentando trocar de tenant
      escopos: ['tenant'],
    });

    expect(search).toHaveBeenCalledTimes(1);
    const [ctxArg] = search.mock.calls[0];
    expect(ctxArg).toEqual(SESSION_A); // tenant da sessão, não o injetado
    expect(ctxArg.tenantId).toBe(SESSION_A.tenantId);
  });

  it('valida args (query obrigatória)', async () => {
    const retrieval = { search: jest.fn(), buildContext: jest.fn() } as unknown as RetrievalService;
    const tool = new SearchKnowledgeTool(retrieval);
    await expect(tool.execute(SESSION_A, { escopos: ['tenant'] })).rejects.toThrow();
  });
});

import { RetrievalService, type RagContext } from './retrieval.service';
import { EmbeddingsService } from './embeddings/embeddings.service';
import { InMemoryRagCache } from './cache/rag-cache';
import { IdentityReranker } from './reranker/reranker';
import type { PrismaService } from '../prisma/prisma.service';

const CTX_A: RagContext = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  nicho: 'medico',
  subespecialidade: null,
};

const CANDIDATES = [
  { chunk_id: 'c-global', document_id: 'd1', escopo: 'global', titulo: 'Global', breadcrumb: null, conteudo: 'protocolo global', score: 0.02 },
  { chunk_id: 'c-tenant', document_id: 'd2', escopo: 'tenant', titulo: 'DocA', breadcrumb: 'A > x', conteudo: 'protocolo do tenant A', score: 0.05 },
];

function fakeEmbeddings(): EmbeddingsService {
  return { embedOne: jest.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]), dims: 4 } as unknown as EmbeddingsService;
}

function fakePrisma(rows: unknown[], seenTenants: string[]) {
  return {
    withTenant: jest.fn(async (tenantId: string, work: (tx: unknown) => Promise<unknown>) => {
      seenTenants.push(tenantId);
      const tx = {
        $queryRawUnsafe: jest.fn().mockResolvedValue(rows),
        $executeRaw: jest.fn().mockResolvedValue(1),
      };
      return work(tx);
    }),
  } as unknown as PrismaService;
}

describe('RetrievalService (R1.4 / R1.5 isolamento)', () => {
  it('usa o tenant da SESSÃO na transação (não do LLM)', async () => {
    const seen: string[] = [];
    const svc = new RetrievalService(fakePrisma(CANDIDATES, seen), fakeEmbeddings(), new InMemoryRagCache(), new IdentityReranker());
    const hits = await svc.search(CTX_A, 'protocolo');
    expect(hits.map((h) => h.chunkId)).toEqual(['c-tenant', 'c-global']); // ordenado por score desc
    // toda transação abriu com o tenant da sessão
    expect(seen.every((t) => t === CTX_A.tenantId)).toBe(true);
  });

  it('não aplica corte MIN_SCORE no baseline (reranker não calibrado)', async () => {
    const svc = new RetrievalService(fakePrisma(CANDIDATES, []), fakeEmbeddings(), new InMemoryRagCache(), new IdentityReranker());
    const hits = await svc.search(CTX_A, 'protocolo');
    // scores ~0.02/0.05 estão abaixo de 0.35, mas não são cortados (RRF != cross-encoder)
    expect(hits).toHaveLength(2);
  });

  it('cacheia: 2ª busca idêntica não reembeda', async () => {
    const emb = fakeEmbeddings();
    const svc = new RetrievalService(fakePrisma(CANDIDATES, []), emb, new InMemoryRagCache(), new IdentityReranker());
    await svc.search(CTX_A, 'protocolo');
    await svc.search(CTX_A, 'protocolo');
    expect((emb.embedOne as jest.Mock).mock.calls.length).toBe(1);
  });

  it('buildContext envolve o chunk com aviso anti prompt-injection', async () => {
    const svc = new RetrievalService(fakePrisma(CANDIDATES, []), fakeEmbeddings(), new InMemoryRagCache(), new IdentityReranker());
    const hits = await svc.search(CTX_A, 'protocolo');
    const ctx = svc.buildContext(hits);
    expect(ctx).toContain('não instrução');
    expect(ctx).toContain('<documento');
    expect(ctx).toContain('protocolo do tenant A');
    expect(svc.buildContext([])).toContain('vazia="true"');
  });

  it('sem candidatos retorna vazio', async () => {
    const svc = new RetrievalService(fakePrisma([], []), fakeEmbeddings(), new InMemoryRagCache(), new IdentityReranker());
    expect(await svc.search(CTX_A, 'nada')).toEqual([]);
  });
});

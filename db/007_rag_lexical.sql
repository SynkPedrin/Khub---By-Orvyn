-- 007_rag_lexical.sql — busca lexical (BM25/ts_rank_cd) sem vetor.
-- Motivo (Brief §2 · fallback funcional): sem VOYAGE_API_KEY não há embedding da
-- query, mas o RAG não pode morrer — degrada para busca lexical pura sobre o
-- MESMO `filtro` do híbrido (RLS + escopo + nicho + sub dentro do WHERE).
-- Idempotente. Rodar como orvyn_service.

CREATE OR REPLACE FUNCTION rag_search_lexical(
  p_query_text TEXT,
  p_nicho      TEXT,
  p_sub        TEXT,
  p_escopos    TEXT[] DEFAULT ARRAY['tenant','sub','nicho','global'],
  p_limit      INT    DEFAULT 30
)
RETURNS TABLE (
  chunk_id    UUID,
  document_id UUID,
  escopo      rag_escopo,
  titulo      TEXT,
  breadcrumb  TEXT,
  conteudo    TEXT,
  score       REAL
)
LANGUAGE sql STABLE AS $$
WITH filtro AS (
  SELECT c.id, c.document_id, c.escopo, c.breadcrumb, c.conteudo, c.tsv
  FROM rag_chunks c
  WHERE c.status = 'published'
    AND c.escopo::text = ANY(p_escopos)
    AND (
      c.escopo = 'global'
      OR (c.escopo = 'nicho'  AND c.nicho = p_nicho)
      OR (c.escopo = 'sub'    AND c.nicho = p_nicho AND c.subespecialidade = p_sub)
      OR (c.escopo = 'tenant' AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    )
),
lexico AS (
  SELECT f.id, ts_rank_cd(f.tsv, websearch_to_tsquery('pt_unaccent', p_query_text)) AS rank
  FROM filtro f
  WHERE f.tsv @@ websearch_to_tsquery('pt_unaccent', p_query_text)
  ORDER BY rank DESC
  LIMIT p_limit
)
SELECT
  l.id,
  fl.document_id,
  fl.escopo,
  d.titulo,
  fl.breadcrumb,
  fl.conteudo,
  -- mesmo boost de escopo do híbrido, para a ordem não mudar de "personalidade"
  (l.rank * CASE fl.escopo
      WHEN 'tenant' THEN 1.35
      WHEN 'sub'    THEN 1.20
      WHEN 'nicho'  THEN 1.10
      ELSE 1.00
   END)::real AS score
FROM lexico l
JOIN filtro fl ON fl.id = l.id
JOIN rag_documents d ON d.id = fl.document_id
ORDER BY score DESC
LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION rag_search_lexical(TEXT, TEXT, TEXT, TEXT[], INT) TO orvyn_app;

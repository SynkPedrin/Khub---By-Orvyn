-- =====================================================================
-- ORVYN · Nyro IA — Schema do RAG (PostgreSQL 15+ / pgvector 0.7+)
-- Migration 001. Idempotente. Rodar com role owner (não com a role da app).
-- Requer 000_foundation.sql aplicado antes (tabela tenants + roles).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Config de full-text em português SEM acento (lado léxico do BM25)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'pt_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION pt_unaccent (COPY = portuguese);
    ALTER TEXT SEARCH CONFIGURATION pt_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, portuguese_stem;
  END IF;
END$$;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE rag_escopo AS ENUM ('global','nicho','sub','tenant');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE rag_doc_status AS ENUM ('pending','processing','published','failed','superseded','candidate');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- Documentos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_documents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NULL REFERENCES tenants(id) ON DELETE CASCADE, -- NULL para global/nicho/sub
  escopo            rag_escopo NOT NULL,
  nicho             TEXT NULL,          -- 'medico' | 'juridico' | 'contabil' | 'agencia'
  subespecialidade  TEXT NULL,          -- 'neurologia' | 'previdenciario' | 'fiscal' ...
  titulo            TEXT NOT NULL,
  fonte             TEXT NOT NULL,      -- 'playbook_interno' | 'upload_cliente' | 'site_publico' ...
  uri               TEXT NULL,          -- s3://... ou https://...
  mime              TEXT NOT NULL DEFAULT 'text/markdown',
  content_hash      TEXT NOT NULL,      -- sha256 do binário/limpo -> idempotência
  versao            INT  NOT NULL DEFAULT 1,
  status            rag_doc_status NOT NULL DEFAULT 'pending',
  erro              TEXT NULL,
  metadados         JSONB NOT NULL DEFAULT '{}'::jsonb,
  criado_por        UUID NULL,
  published_at      TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- coerência escopo x campos (barreira contra bug de vazamento)
  CONSTRAINT chk_escopo_campos CHECK (
    (escopo = 'global' AND tenant_id IS NULL AND nicho IS NULL) OR
    (escopo = 'nicho'  AND tenant_id IS NULL AND nicho IS NOT NULL) OR
    (escopo = 'sub'    AND tenant_id IS NULL AND nicho IS NOT NULL AND subespecialidade IS NOT NULL) OR
    (escopo = 'tenant' AND tenant_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_doc_hash
  ON rag_documents (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), escopo, content_hash);
CREATE INDEX IF NOT EXISTS idx_rag_doc_escopo ON rag_documents (escopo, nicho, subespecialidade) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_rag_doc_tenant ON rag_documents (tenant_id) WHERE tenant_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- Chunks
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_chunks (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id       UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  tenant_id         UUID NULL,          -- desnormalizado de rag_documents -> filtro barato + RLS
  escopo            rag_escopo NOT NULL,
  nicho             TEXT NULL,
  subespecialidade  TEXT NULL,
  ordem             INT NOT NULL,
  breadcrumb        TEXT NULL,          -- "Documento > Seção > Subseção"
  contexto          TEXT NULL,          -- ADR-03: 1-2 frases geradas pelo Haiku
  conteudo          TEXT NOT NULL,      -- texto original do chunk (é o que vai no prompt)
  tokens            INT  NOT NULL DEFAULT 0,
  embedding         VECTOR(1024) NULL,  -- voyage-3-large
  embedding_model   TEXT NOT NULL DEFAULT 'voyage-3-large',
  status            rag_doc_status NOT NULL DEFAULT 'published',
  metadados         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- índice léxico: contexto + conteúdo, pesos A/B
  tsv TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('pt_unaccent', coalesce(breadcrumb,'') || ' ' || coalesce(contexto,'')), 'A') ||
    setweight(to_tsvector('pt_unaccent', coalesce(conteudo,'')), 'B')
  ) STORED
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_rag_chunk_doc_ordem ON rag_chunks (document_id, ordem);

-- HNSW para busca vetorial (cosine). Ajuste m/ef_construction conforme volume.
CREATE INDEX IF NOT EXISTS idx_rag_chunks_embedding
  ON rag_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_rag_chunks_tsv     ON rag_chunks USING GIN (tsv);
CREATE INDEX IF NOT EXISTS idx_rag_chunks_escopo  ON rag_chunks (escopo, nicho, subespecialidade) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_rag_chunks_tenant  ON rag_chunks (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_rag_chunks_meta    ON rag_chunks USING GIN (metadados);

-- ---------------------------------------------------------------------
-- Telemetria: log de buscas, feedback e guardrails
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rag_queries (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL,
  conversation_id UUID NULL,
  query        TEXT NOT NULL,
  query_reescrita TEXT NULL,
  escopos      TEXT[] NOT NULL,
  chunk_ids    UUID[] NOT NULL DEFAULT '{}',
  scores       REAL[] NOT NULL DEFAULT '{}',
  cache_hit    BOOLEAN NOT NULL DEFAULT false,
  latencia_ms  INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rag_queries_tenant_ts ON rag_queries (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS rag_feedback (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL,
  query_id     UUID NULL REFERENCES rag_queries(id) ON DELETE SET NULL,
  resposta     TEXT NOT NULL,
  chunk_ids    UUID[] NOT NULL DEFAULT '{}',
  voto         SMALLINT NOT NULL CHECK (voto IN (-1, 1)),
  comentario   TEXT NULL,
  virou_documento UUID NULL REFERENCES rag_documents(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS nyro_guardrail_hits (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL,
  nicho        TEXT NULL,
  regra        TEXT NOT NULL,
  trecho       TEXT NOT NULL,
  acao         TEXT NOT NULL,  -- 'bloqueado' | 'reescrito' | 'escalado'
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- RLS — isolamento no banco, não na aplicação
-- ---------------------------------------------------------------------
ALTER TABLE rag_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_queries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE rag_feedback  ENABLE ROW LEVEL SECURITY;

-- Conhecimento compartilhado (global/nicho/sub) é legível por todos; do tenant, só pelo dono.
DROP POLICY IF EXISTS rag_documents_read ON rag_documents;
CREATE POLICY rag_documents_read ON rag_documents FOR SELECT USING (
  escopo <> 'tenant'
  OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

DROP POLICY IF EXISTS rag_documents_write ON rag_documents;
CREATE POLICY rag_documents_write ON rag_documents FOR ALL USING (
  escopo = 'tenant'
  AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
) WITH CHECK (
  escopo = 'tenant'
  AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);
-- Bases global/nicho/sub são gravadas SOMENTE pela role de serviço (BYPASSRLS).

DROP POLICY IF EXISTS rag_chunks_read ON rag_chunks;
CREATE POLICY rag_chunks_read ON rag_chunks FOR SELECT USING (
  escopo <> 'tenant'
  OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

DROP POLICY IF EXISTS rag_queries_rw ON rag_queries;
CREATE POLICY rag_queries_rw ON rag_queries FOR ALL USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
) WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

DROP POLICY IF EXISTS rag_feedback_rw ON rag_feedback;
CREATE POLICY rag_feedback_rw ON rag_feedback FOR ALL USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
) WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- ---------------------------------------------------------------------
-- Busca híbrida (vetorial + léxico) com RRF + boost de escopo — em SQL,
-- uma ida ao banco só.
-- Chamar SEMPRE dentro de transação com:
--   SET LOCAL app.current_tenant_id = '<uuid>';
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rag_search_hybrid(
  p_query_embedding VECTOR(1024),
  p_query_text      TEXT,
  p_nicho           TEXT,
  p_sub             TEXT,
  p_escopos         TEXT[]  DEFAULT ARRAY['tenant','sub','nicho','global'],
  p_k_each          INT     DEFAULT 50,
  p_limit           INT     DEFAULT 30,
  p_rrf_k           INT     DEFAULT 60
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
  SELECT c.id, c.document_id, c.escopo, c.breadcrumb, c.conteudo, c.contexto, c.embedding, c.tsv
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
vetorial AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> p_query_embedding) AS rank
  FROM filtro
  WHERE embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding
  LIMIT p_k_each
),
lexico AS (
  SELECT id, ROW_NUMBER() OVER (
           ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('pt_unaccent', p_query_text)) DESC
         ) AS rank
  FROM filtro
  WHERE tsv @@ websearch_to_tsquery('pt_unaccent', p_query_text)
  ORDER BY ts_rank_cd(tsv, websearch_to_tsquery('pt_unaccent', p_query_text)) DESC
  LIMIT p_k_each
),
fundido AS (
  SELECT
    COALESCE(v.id, l.id) AS id,
    (COALESCE(1.0 / (p_rrf_k + v.rank), 0) + COALESCE(1.0 / (p_rrf_k + l.rank), 0)) AS rrf
  FROM vetorial v
  FULL OUTER JOIN lexico l ON l.id = v.id
)
SELECT
  f.id,
  fl.document_id,
  fl.escopo,
  d.titulo,
  fl.breadcrumb,
  fl.conteudo,
  (f.rrf * CASE fl.escopo
      WHEN 'tenant' THEN 1.35
      WHEN 'sub'    THEN 1.20
      WHEN 'nicho'  THEN 1.10
      ELSE 1.00
   END)::real AS score
FROM fundido f
JOIN filtro fl ON fl.id = f.id
JOIN rag_documents d ON d.id = fl.document_id
ORDER BY score DESC
LIMIT p_limit;
$$;

-- Aumentar recall do HNSW nas buscas (setar por sessão do worker de leitura):
-- SET hnsw.ef_search = 100;

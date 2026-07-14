-- =====================================================================
-- ORVYN · Nyro IA — Endurecimento de RLS + grants das roles (R0.2)
-- Migration 001a. Idempotente. Rodar com role owner APÓS 001_rag_schema.sql.
--
-- Fecha lacunas do 001 para o critério de aceite R0.2 (isolamento provado):
--   1. FORCE ROW LEVEL SECURITY -> RLS vale até para o OWNER da tabela
--      (defesa em profundidade; superuser sempre ignora RLS por design).
--   2. RLS em nyro_guardrail_hits (tem tenant_id e ficou sem policy no 001).
--   3. GRANTs mínimos: orvyn_app opera as tabelas mas sempre filtrada pela RLS.
-- =====================================================================

-- 1. Forçar RLS mesmo para o owner ---------------------------------------
ALTER TABLE rag_documents        FORCE ROW LEVEL SECURITY;
ALTER TABLE rag_chunks           FORCE ROW LEVEL SECURITY;
ALTER TABLE rag_queries          FORCE ROW LEVEL SECURITY;
ALTER TABLE rag_feedback         FORCE ROW LEVEL SECURITY;

-- 2. nyro_guardrail_hits: isolar por tenant ------------------------------
ALTER TABLE nyro_guardrail_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE nyro_guardrail_hits FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS nyro_guardrail_hits_rw ON nyro_guardrail_hits;
CREATE POLICY nyro_guardrail_hits_rw ON nyro_guardrail_hits FOR ALL USING (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
) WITH CHECK (
  tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
);

-- 3. Grants -------------------------------------------------------------
-- orvyn_app: opera todas as tabelas do RAG (a RLS é quem restringe as linhas).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  rag_documents, rag_chunks, rag_queries, rag_feedback, nyro_guardrail_hits
  TO orvyn_app;

-- orvyn_service: mesma superfície; o BYPASSRLS (definido no 000) é que dá
-- o poder de publicar bases global/nicho/sub e semear dados cross-tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  rag_documents, rag_chunks, rag_queries, rag_feedback, nyro_guardrail_hits
  TO orvyn_service;

-- Função de busca híbrida (SECURITY INVOKER -> roda com a RLS do chamador).
GRANT EXECUTE ON FUNCTION
  rag_search_hybrid(vector, text, text, text, text[], int, int, int)
  TO orvyn_app, orvyn_service;

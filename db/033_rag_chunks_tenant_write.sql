-- =====================================================================
-- 033_rag_chunks_tenant_write.sql — BUG-022: base de conhecimento de TENANT
-- não era indexável pela aplicação.
--
-- 001 criou `rag_documents_write` (o tenant grava os PRÓPRIOS documentos), mas
-- `rag_chunks` ficou só com a policy de LEITURA. Com RLS FORCE (001a) e a app
-- rodando como orvyn_app (NOBYPASSRLS), todo INSERT de chunk falhava com 42501
-- — nenhum documento de cliente chegava a ser publicado.
--
-- Esta policy espelha `rag_documents_write` e ainda exige que o chunk aponte
-- para um documento do MESMO tenant (a subconsulta roda sob a RLS de leitura:
-- documento de outro tenant é invisível → o WITH CHECK falha). Bases
-- global/nicho/sub continuam gravadas SOMENTE pela role de serviço.
--
-- ADITIVA e idempotente. Rollback:
--   DROP POLICY IF EXISTS rag_chunks_write ON rag_chunks;
-- =====================================================================
BEGIN;

DROP POLICY IF EXISTS rag_chunks_write ON rag_chunks;
CREATE POLICY rag_chunks_write ON rag_chunks FOR ALL USING (
  escopo = 'tenant'
  AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
) WITH CHECK (
  escopo = 'tenant'
  AND tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  AND EXISTS (
    SELECT 1 FROM rag_documents d
    WHERE d.id = rag_chunks.document_id
      AND d.tenant_id = rag_chunks.tenant_id
      AND d.escopo = 'tenant'
  )
);

COMMIT;

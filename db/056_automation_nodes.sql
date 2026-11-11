-- =====================================================================
-- 056_automation_nodes.sql — nós novos do motor de automação (Q3.1 + W4)
--
-- Contexto: para o motor chegar ao nível do GHL Workflows, a Q3.1 traz os nós
-- `acao.atribuir_usuario` (dono fixo ou rodízio), `acao.atualizar_negocio`
-- (valor, status, etapa, dono, campos) e companhia. O dono do negócio
-- (`deals.owner_id`) e o motivo de perda já vieram na db/051 (Q2.1): esta
-- migração NÃO mexe em `deals`. O que falta é:
--   `workflow_round_robin`: contador atômico do rodízio, por (tenant,
--      fluxo, nó). O executor faz UPSERT ... RETURNING contador na MESMA
--      transação em que grava o dono — retry depois de rollback não pula
--      ninguém da fila. Mesmo padrão do `workflow_drip_counters` (db/015).
--
-- ADITIVA: uma tabela nova com RLS FORCE.
-- Roda no QA (papéis khub_*) e no DEV (papéis orvyn_*).
--
-- Rollback (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS workflow_round_robin;
--   DELETE FROM schema_migrations WHERE filename = 'db/056_automation_nodes.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- Rodízio (round-robin) do nó "Atribuir usuário"
CREATE TABLE IF NOT EXISTS workflow_round_robin (
  tenant_id   UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  node_id     TEXT        NOT NULL,
  contador    BIGINT      NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workflow_id, node_id)
);

ALTER TABLE workflow_round_robin ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_round_robin FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON workflow_round_robin;
CREATE POLICY tenant_rw ON workflow_round_robin FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_round_robin TO %I', r);
    END IF; END LOOP; END $$;

COMMIT;

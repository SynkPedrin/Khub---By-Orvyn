-- =====================================================================
-- 058_automations_editor.sql — Sprint Q3.3 (editor de automações)
--
-- Contexto:
--  1. Pastas na lista de automações: `workflows.pasta`. Decisão: coluna
--     própria, não `tags`. Pasta é LOCAL (um fluxo mora em exatamente uma
--     pasta, como no GHL); tag é RÓTULO (vários por fluxo, usados na busca e
--     no filtro). Reaproveitar `tags` com um prefixo ("pasta:x") obrigaria
--     toda tela que lista tags a esconder as "falsas" e deixaria um fluxo
--     morar em duas pastas. NULL = "Sem pasta".
--  2. Execuções por contato (perfil do contato → seção Automações):
--     `GET /v1/automations/runs?contactId=` ordena por `started_at DESC` sem
--     filtrar por workflow; o índice de db/011 começa por workflow_id e não
--     serve. Índice novo (tenant_id, contact_id, started_at DESC).
--  3. Estatística por etapa no canvas (`GET .../workflows/:id/stats`): parte
--     dos runs do fluxo que ainda podiam ter passo no período
--     (finished_at IS NULL OR finished_at >= desde) e desce aos passos pelo
--     índice de db/010 (tenant_id, run_id, created_at). Índice novo
--     (tenant_id, workflow_id, finished_at) para essa poda.
--
-- ADITIVA: uma coluna nula + CHECK + três índices. `workflows`,
-- `workflow_runs` e `workflow_run_steps` já têm RLS FORCE + policy tenant_rw
-- (db/010); a coluna nova herda os grants de tabela de khub_app/orvyn_app.
-- Nenhuma tabela nova, então nenhuma policy nova.
--
-- Rollback (manual):
--   BEGIN;
--   DROP INDEX IF EXISTS idx_workflows_pasta;
--   DROP INDEX IF EXISTS idx_wf_runs_contato_recente;
--   DROP INDEX IF EXISTS idx_wf_runs_wf_fim;
--   ALTER TABLE workflows DROP CONSTRAINT IF EXISTS workflows_pasta_len;
--   ALTER TABLE workflows DROP COLUMN IF EXISTS pasta;
--   COMMIT;
-- =====================================================================

BEGIN;

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS pasta TEXT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workflows_pasta_len') THEN
    ALTER TABLE workflows ADD CONSTRAINT workflows_pasta_len
      CHECK (pasta IS NULL OR char_length(btrim(pasta)) BETWEEN 1 AND 60);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_workflows_pasta
  ON workflows (tenant_id, pasta) WHERE pasta IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wf_runs_contato_recente
  ON workflow_runs (tenant_id, contact_id, started_at DESC) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wf_runs_wf_fim
  ON workflow_runs (tenant_id, workflow_id, finished_at);

COMMIT;

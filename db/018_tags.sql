-- 018_tags.sql — Sistema de tags do CRM (nome + cor, por tenant).
-- Os contatos guardam tags como String[] (nomes); esta tabela é o catálogo
-- canônico com cor e metadados. RLS padrão: cada tenant só vê/edita as suas.
-- Aplicar:  node scripts/apply-sql.mjs db/018_tags.sql

CREATE TABLE IF NOT EXISTS crm_tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#7B2EFF',
  descricao  TEXT NOT NULL DEFAULT '',
  usos       INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ==SPLIT==
-- nome único por tenant (case-insensitive): "Lead" e "lead" são a mesma tag.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_tag_name ON crm_tags (tenant_id, lower(name));
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_crm_tags_tenant ON crm_tags (tenant_id);
-- ==SPLIT==
ALTER TABLE crm_tags ENABLE ROW LEVEL SECURITY;
-- ==SPLIT==
ALTER TABLE crm_tags FORCE  ROW LEVEL SECURITY;
-- ==SPLIT==
DROP POLICY IF EXISTS tenant_rw ON crm_tags;
-- ==SPLIT==
CREATE POLICY tenant_rw ON crm_tags FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- ==SPLIT==
GRANT SELECT, INSERT, UPDATE, DELETE ON crm_tags TO orvyn_app, orvyn_service;

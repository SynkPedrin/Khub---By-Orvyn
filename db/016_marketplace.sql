-- 016_marketplace.sql — Automation Marketplace (templates de automação).
-- Dois escopos: GLOBAL (tenant_id NULL, publicado só por orvyn_service — mesma
-- exceção das bases global/nicho do RAG) e DO TENANT (tenant_id = X, privado).
-- O workflow do template é o grafo do editor ({nos, arestas}) — reuso total.

CREATE TABLE IF NOT EXISTS automation_templates (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NULL REFERENCES tenants(id) ON DELETE CASCADE,  -- NULL = global/oficial
  slug          TEXT NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  category      TEXT NOT NULL,
  subcategory   TEXT NULL,
  icon          TEXT NULL,
  segment       TEXT NULL,
  difficulty    TEXT NOT NULL DEFAULT 'facil',       -- facil | medio | avancado
  estimated_min INTEGER NULL,
  tags          TEXT[] NOT NULL DEFAULT '{}',
  author        TEXT NOT NULL DEFAULT 'Orvyn',
  version       INTEGER NOT NULL DEFAULT 1,
  is_official   BOOLEAN NOT NULL DEFAULT false,
  is_premium    BOOLEAN NOT NULL DEFAULT false,
  is_published  BOOLEAN NOT NULL DEFAULT true,
  featured      BOOLEAN NOT NULL DEFAULT false,
  installs      INTEGER NOT NULL DEFAULT 0,
  rating        NUMERIC(3,2) NULL,
  requirements  TEXT[] NOT NULL DEFAULT '{}',         -- providers/nós exigidos (gating na UI)
  workflow      JSONB NOT NULL,                        -- {nos, arestas}
  variables     JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- slug único por escopo (global usa o UUID zero como sentinela)
CREATE UNIQUE INDEX IF NOT EXISTS uq_template_slug
  ON automation_templates (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);
CREATE INDEX IF NOT EXISTS idx_template_cat ON automation_templates (category);

ALTER TABLE automation_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE automation_templates FORCE  ROW LEVEL SECURITY;  -- BYPASSRLS (orvyn_service) ainda passa

-- LEITURA: globais PUBLICADOS + os do próprio tenant.
DROP POLICY IF EXISTS tpl_read ON automation_templates;
CREATE POLICY tpl_read ON automation_templates FOR SELECT
  USING (
    (tenant_id IS NULL AND is_published)
    OR tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
  );

-- ESCRITA: só os próprios (tenant). Globais (tenant_id NULL) só via orvyn_service.
DROP POLICY IF EXISTS tpl_write ON automation_templates;
CREATE POLICY tpl_write ON automation_templates FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON automation_templates TO orvyn_app, orvyn_service;

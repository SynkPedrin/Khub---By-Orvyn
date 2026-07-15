-- =====================================================================
-- ORVYN OS · Integrações de anúncios (SPRINT A) — schema + RLS
-- Migration 005. Aditiva. Rodar com owner/superuser APÓS 000..004.
-- Toda tabela: tenant_id NOT NULL + RLS (app.current_tenant_id).
-- Tokens OAuth do cliente ficam em credentials_encrypted (AES-256-GCM na app).
-- =====================================================================

CREATE TABLE IF NOT EXISTS integrations (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider             TEXT NOT NULL,                 -- meta | google | tiktok
  status               TEXT NOT NULL DEFAULT 'pending', -- pending|connected|error|revoked
  external_business_id TEXT NULL,
  credentials_encrypted TEXT NULL,                    -- payload AES-256-GCM (base64), nunca em claro
  scopes               TEXT[] NOT NULL DEFAULT '{}',
  connected_by         UUID NULL,
  connected_at         TIMESTAMPTZ NULL,
  last_sync_at         TIMESTAMPTZ NULL,
  health               TEXT NOT NULL DEFAULT 'unknown', -- ok|degraded|down|unknown
  erro                 TEXT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_business_id)
);
CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations (tenant_id, provider);

CREATE TABLE IF NOT EXISTS ad_accounts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  provider       TEXT NOT NULL,
  external_id    TEXT NOT NULL,
  name           TEXT NOT NULL,
  currency       TEXT NULL,
  timezone       TEXT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_accounts_tenant ON ad_accounts (tenant_id, integration_id);

CREATE TABLE IF NOT EXISTS ad_campaigns (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id  UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  external_id    TEXT NOT NULL,
  name           TEXT NOT NULL,
  objective      TEXT NULL,
  status         TEXT NOT NULL DEFAULT 'active',
  daily_budget   NUMERIC(14,2) NULL,
  lifetime_budget NUMERIC(14,2) NULL,
  start_at       TIMESTAMPTZ NULL,
  stop_at        TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_campaigns_tenant ON ad_campaigns (tenant_id, ad_account_id);

CREATE TABLE IF NOT EXISTS ad_sets (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id  UUID NOT NULL REFERENCES ad_campaigns(id) ON DELETE CASCADE,
  external_id  TEXT NOT NULL,
  name         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'active',
  targeting    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);

CREATE TABLE IF NOT EXISTS ad_creatives (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  ad_account_id UUID NOT NULL REFERENCES ad_accounts(id) ON DELETE CASCADE,
  campaign_id   UUID NULL REFERENCES ad_campaigns(id) ON DELETE SET NULL,
  ad_set_id     UUID NULL REFERENCES ad_sets(id) ON DELETE SET NULL,
  external_id   TEXT NOT NULL,
  name          TEXT NULL,
  format        TEXT NULL,                    -- image | video | carousel
  thumbnail_url TEXT NULL,
  preview_url   TEXT NULL,
  body          TEXT NULL,
  cta           TEXT NULL,
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_ad_creatives_tenant ON ad_creatives (tenant_id, ad_account_id);

-- Insights PARTICIONADO por date (RANGE) — maior volume
CREATE TABLE IF NOT EXISTS ad_insights (
  id             UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  level          TEXT NOT NULL,                -- account | campaign | adset | ad
  provider       TEXT NOT NULL,
  external_ref_id TEXT NOT NULL,
  date           DATE NOT NULL,
  spend          NUMERIC(14,2) NOT NULL DEFAULT 0,
  impressions    BIGINT NOT NULL DEFAULT 0,
  clicks         BIGINT NOT NULL DEFAULT 0,
  ctr            NUMERIC(8,4) NOT NULL DEFAULT 0,
  cpc            NUMERIC(12,4) NOT NULL DEFAULT 0,
  cpm            NUMERIC(12,4) NOT NULL DEFAULT 0,
  reach          BIGINT NOT NULL DEFAULT 0,
  frequency      NUMERIC(10,4) NOT NULL DEFAULT 0,
  leads          BIGINT NOT NULL DEFAULT 0,
  conversions    BIGINT NOT NULL DEFAULT 0,
  revenue        NUMERIC(14,2) NOT NULL DEFAULT 0,
  roas           NUMERIC(12,4) NOT NULL DEFAULT 0,
  cpl            NUMERIC(12,4) NOT NULL DEFAULT 0,
  cpa            NUMERIC(12,4) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, date),
  UNIQUE (tenant_id, provider, level, external_ref_id, date)
) PARTITION BY RANGE (date);

-- partição default (evita pré-criar cada mês; particionar fino depois se necessário)
CREATE TABLE IF NOT EXISTS ad_insights_default PARTITION OF ad_insights DEFAULT;
CREATE INDEX IF NOT EXISTS idx_ad_insights_tenant ON ad_insights (tenant_id, provider, date DESC);

CREATE TABLE IF NOT EXISTS ad_sync_runs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id UUID NULL REFERENCES integrations(id) ON DELETE SET NULL,
  provider       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running', -- running|success|failed
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ NULL,
  erro           TEXT NULL,
  records        INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ad_sync_runs_tenant ON ad_sync_runs (tenant_id, started_at DESC);

-- ---------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['integrations','ad_accounts','ad_campaigns','ad_sets','ad_creatives','ad_insights','ad_sync_runs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO orvyn_app, orvyn_service', t);
  END LOOP;
  -- partição default herda RLS do pai, mas precisa de grant próprio
  GRANT SELECT, INSERT, UPDATE, DELETE ON ad_insights_default TO orvyn_app, orvyn_service;
END$$;

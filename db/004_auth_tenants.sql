-- =====================================================================
-- ORVYN · Auth + Tenants (FASE 1) — identidade global + RLS
-- Migration 004. Idempotente. Rodar com owner/superuser APÓS 000..003.
--
-- ADR-0006: login é PRÉ-tenant, então separo IDENTIDADE de TENANT.
--   identities/memberships/refresh_tokens/invites = infra de auth (SEM RLS;
--     não carregam dado de negócio; a API consulta com filtros explícitos).
--   audit_logs / webhook_events = dado do tenant -> RLS + caso no 002.
-- =====================================================================

-- tenants: campos de nicho (plano/status/template_* já existem)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS nicho TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS subespecialidade TEXT;

-- ---------------------------------------------------------------------
-- Identidade global (credenciais de login). SEM RLS.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identities (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email             TEXT NOT NULL,
  password_hash     TEXT NULL,             -- null quando só OAuth
  oauth_provider    TEXT NULL,             -- 'google' | 'github'
  oauth_subject     TEXT NULL,             -- id do usuário no provider
  email_verified_at TIMESTAMPTZ NULL,
  twofa_secret      TEXT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_email ON identities (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_identities_oauth ON identities (oauth_provider, oauth_subject) WHERE oauth_provider IS NOT NULL;

-- users (perfil por tenant) ganha vínculo com a identidade
ALTER TABLE users ADD COLUMN IF NOT EXISTS identity_id UUID NULL REFERENCES identities(id) ON DELETE SET NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS permissoes JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------
-- memberships (identidade <-> tenant, N:N). Infra, SEM RLS.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS memberships (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identity_id  UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'owner',
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identity_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_memberships_identity ON memberships (identity_id);

-- ---------------------------------------------------------------------
-- refresh_tokens (rotativos, revogáveis). Infra, SEM RLS.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identity_id  UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,       -- sha256 do token opaco
  tenant_id    UUID NULL,                  -- tenant ativo quando emitido
  expires_at   TIMESTAMPTZ NOT NULL,
  revoked_at   TIMESTAMPTZ NULL,
  user_agent   TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_refresh_identity ON refresh_tokens (identity_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------------
-- invites (por token). Infra, SEM RLS (aceite é pré-tenant).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'member',
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  accepted_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- audit_logs — IMUTÁVEL + RLS por tenant
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_type     TEXT NOT NULL DEFAULT 'humano', -- humano | nyro | sistema
  actor_id       TEXT NULL,
  acao           TEXT NOT NULL,
  entidade       TEXT NULL,
  entidade_id    TEXT NULL,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id TEXT NULL,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_ts ON audit_logs (tenant_id, ts DESC);

CREATE OR REPLACE FUNCTION audit_logs_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs é imutável (append-only): % negado', TG_OP;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_immutable ON audit_logs;
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_immutable();

-- ---------------------------------------------------------------------
-- webhook_events — dedupe idempotente + RLS por tenant
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_events (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL,
  event_id     TEXT NOT NULL,
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

-- ---------------------------------------------------------------------
-- RLS nas tabelas de tenant (audit_logs, webhook_events)
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs','webhook_events']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END$$;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
-- Infra de auth (sem RLS): a API precisa consultar por email/token pré-tenant.
GRANT SELECT, INSERT, UPDATE, DELETE ON identities, memberships, refresh_tokens, invites TO orvyn_app, orvyn_service;
-- signup cria tenant + define settings:
GRANT INSERT, UPDATE ON tenants TO orvyn_app;
-- audit é append-only (sem UPDATE/DELETE):
GRANT SELECT, INSERT ON audit_logs TO orvyn_app, orvyn_service;
REVOKE UPDATE, DELETE ON audit_logs FROM orvyn_app, orvyn_service;
GRANT SELECT, INSERT, UPDATE, DELETE ON webhook_events TO orvyn_app, orvyn_service;

-- =====================================================================
-- 038_password_reset_proposals.sql — "Esqueci minha senha" + Propostas
-- ADR-0042 · fecha SEC-01 (offboarding) e itens de produto da virada GHL
--
-- ADITIVA: só cria tabelas novas. Nada existente muda de significado.
--
--   password_reset_tokens — infra de auth (mesmo padrão de refresh_tokens:
--     global, SEM RLS, ADR-0006). Guarda só o HASH do token, uso único,
--     validade curta (a API usa 60 min).
--   proposals — proposta comercial ligada a contato/negócio. Dado de
--     negócio: tenant_id NOT NULL + RLS FORCE + gatilho tenant_reference.
--
-- Carteira de clientes e horário de atendimento dos agentes NÃO criam
-- schema: a carteira é derivada de negócios ganhos (fonte única) e o
-- horário mora em agents.config (validado por Zod na API).
--
-- Rollback (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS proposals;
--   DROP TABLE IF EXISTS password_reset_tokens;
--   COMMIT;
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- password_reset_tokens
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  identity_id  UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pwd_reset_identity ON password_reset_tokens (identity_id) WHERE used_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON password_reset_tokens TO khub_app, khub_service;

-- ---------------------------------------------------------------------
-- proposals
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proposals (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id           UUID NULL REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id              UUID NULL REFERENCES deals(id) ON DELETE SET NULL,
  titulo               TEXT NOT NULL,
  -- [{descricao, quantidade, valorUnitario}] — validado na API.
  itens                JSONB NOT NULL DEFAULT '[]'::jsonb,
  desconto             NUMERIC(12,2) NOT NULL DEFAULT 0,
  valor                NUMERIC(12,2) NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'rascunho',
  validade             DATE NULL,
  enviada_em           TIMESTAMPTZ NULL,
  respondida_em        TIMESTAMPTZ NULL,
  motivo_recusa        TEXT NULL,
  observacoes          TEXT NULL,
  owner_id             UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  proximo_followup_at  TIMESTAMPTZ NULL,
  created_by           UUID NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT proposals_titulo_chk   CHECK (length(titulo) BETWEEN 1 AND 160),
  CONSTRAINT proposals_status_chk   CHECK (status IN ('rascunho', 'enviada', 'aceita', 'recusada', 'expirada', 'cancelada')),
  CONSTRAINT proposals_valor_chk    CHECK (valor >= 0 AND desconto >= 0),
  CONSTRAINT proposals_obs_chk      CHECK (observacoes IS NULL OR length(observacoes) <= 4000),
  CONSTRAINT proposals_motivo_chk   CHECK (motivo_recusa IS NULL OR length(motivo_recusa) <= 500),
  CONSTRAINT proposals_itens_chk    CHECK (jsonb_typeof(itens) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_proposals_status  ON proposals (tenant_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_proposals_contact ON proposals (tenant_id, contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proposals_deal    ON proposals (tenant_id, deal_id) WHERE deal_id IS NOT NULL;

ALTER TABLE proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposals FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON proposals;
CREATE POLICY tenant_rw ON proposals FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON proposals TO khub_app, khub_service;

-- Contato/negócio de OUTRO tenant é recusado no banco, não só na API (db/022).
DROP TRIGGER IF EXISTS tenant_reference ON proposals;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON proposals
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('contact_id', 'contacts', 'deal_id', 'deals');

COMMIT;

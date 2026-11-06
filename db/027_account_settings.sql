-- Aditiva: configurações da operação, preferências da agência e convites.
BEGIN;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}';
-- Como agency_members, esta é uma relação global de identidade/agência.
-- Toda leitura administrativa é autorizada por agency_id no serviço.
CREATE TABLE IF NOT EXISTS agency_invites (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','member','viewer')),
  client_ids uuid[] NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_invites_agency ON agency_invites(agency_id);
GRANT SELECT,INSERT,UPDATE,DELETE ON agency_invites TO orvyn_app,orvyn_service;
COMMIT;
-- Rollback operacional: voltar o código; manter colunas/tabela preserva convites e preferências.

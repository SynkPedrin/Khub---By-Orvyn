-- =====================================================================
-- ORVYN Revenue OS — migration 026
-- =====================================================================
-- Agency Mode + Client Subaccounts.
--
-- ESTRITAMENTE ADITIVA. Nenhuma tabela/coluna existente é alterada. Nenhum
-- tenant/contato/negócio é movido ou recriado.
--
-- Decisão de arquitetura: `agencies`/`agency_members`/`agency_client_accounts`
-- são tabelas GLOBAIS, sem `tenant_id` próprio e SEM RLS — mesmo padrão já
-- usado por `identities`/`memberships` (ADR-0002/004): descrevem a relação
-- ENTRE tenants e identidades, não são dado operacional de um tenant. Um
-- ClientAccount é só um APONTADOR para um tenant que já existe e já tem
-- RLS/isolamento — nenhuma tabela de negócio (contacts, deals, ad_insights…)
-- é duplicada ou referenciada de novo aqui. "Entrar num cliente" = trocar
-- qual tenantId vai no JWT (ver AgencyService), não uma segunda tenancy.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS agencies (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  owner_identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE RESTRICT,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agency_members (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, identity_id)
);
CREATE INDEX IF NOT EXISTS agency_members_identity ON agency_members(identity_id);

CREATE TABLE IF NOT EXISTS agency_client_accounts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')),
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, tenant_id)
);
CREATE INDEX IF NOT EXISTS agency_client_accounts_agency ON agency_client_accounts(agency_id, status);

-- Acesso granular opcional (seção 27 do brief): quando ausente para um
-- (member, client), o membro vê TODOS os clientes da agência (V1 — acesso
-- global de admin). Uma linha aqui RESTRINGE esse membro a essa lista.
CREATE TABLE IF NOT EXISTS agency_member_client_access (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_member_id uuid NOT NULL REFERENCES agency_members(id) ON DELETE CASCADE,
  client_account_id uuid NOT NULL REFERENCES agency_client_accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_member_id, client_account_id)
);

-- Mesmo padrão de 004_auth_tenants.sql (linha 142) pra `identities`/
-- `memberships`: tabelas globais sem RLS ainda precisam de GRANT explícito
-- pro role de runtime — sem isto toda query do Prisma em produção falha com
-- "permission denied" mesmo com o schema correto (achado real, não hipótese).
GRANT SELECT, INSERT, UPDATE, DELETE ON agencies, agency_members, agency_client_accounts, agency_member_client_access TO orvyn_app, orvyn_service;

COMMIT;

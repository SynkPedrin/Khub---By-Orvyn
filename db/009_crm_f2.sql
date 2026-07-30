-- =====================================================================
-- ORVYN OS · CRM F2 (SPRINT D1) — empresas, tarefas, notas + perfil 360
-- Migration 009. Aditiva e idempotente. Rodar com owner/superuser APÓS 003.
-- Invariante: toda tabela de negócio tem tenant_id NOT NULL + RLS + FORCE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Empresas (contas). O contato passa a poder pertencer a uma empresa.
-- `empresa TEXT` continua existindo em contacts como rótulo livre (dado
-- legado + import rápido); company_id é o vínculo relacional.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  dominio     TEXT NULL,
  telefone    TEXT NULL,
  endereco    TEXT NULL,
  segmento    TEXT NULL,
  tamanho     TEXT NULL,               -- 1-10 | 11-50 | 51-200 | 200+
  site        TEXT NULL,
  campos_custom JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companies_tenant ON companies (tenant_id, created_at DESC);
-- mesma empresa não duplica dentro do tenant (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_nome ON companies (tenant_id, lower(nome));

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id UUID NULL REFERENCES companies(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts (tenant_id, company_id);

-- ---------------------------------------------------------------------
-- Tarefas. Pendura em contato e/ou negócio (ambos opcionais: tarefa solta vale).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tasks (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titulo      TEXT NOT NULL,
  descricao   TEXT NULL,
  status      TEXT NOT NULL DEFAULT 'aberta',      -- aberta | concluida
  prioridade  TEXT NOT NULL DEFAULT 'media',       -- baixa | media | alta
  due_at      TIMESTAMPTZ NULL,
  contact_id  UUID NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id     UUID NULL REFERENCES deals(id)    ON DELETE CASCADE,
  company_id  UUID NULL REFERENCES companies(id) ON DELETE CASCADE,
  assignee_id UUID NULL,                           -- identities.id (sem FK: identity é global, fora da RLS)
  created_by  UUID NULL,
  completed_at TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tasks_status_chk CHECK (status IN ('aberta','concluida')),
  CONSTRAINT tasks_prioridade_chk CHECK (prioridade IN ('baixa','media','alta'))
);
-- fila do dia: abertas por vencimento
CREATE INDEX IF NOT EXISTS idx_tasks_abertas ON tasks (tenant_id, due_at) WHERE status = 'aberta';
CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deal    ON tasks (tenant_id, deal_id);

-- ---------------------------------------------------------------------
-- Notas. Texto livre preso a contato/negócio/empresa.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  corpo       TEXT NOT NULL,
  contact_id  UUID NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id     UUID NULL REFERENCES deals(id)    ON DELETE CASCADE,
  company_id  UUID NULL REFERENCES companies(id) ON DELETE CASCADE,
  author_id   UUID NULL,                           -- identities.id
  author_nome TEXT NULL,                           -- snapshot: a nota sobrevive à saída do autor
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notes_contact ON notes (tenant_id, contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_deal    ON notes (tenant_id, deal_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Paginação por cursor: (created_at, id) precisa de índice composto estável.
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_contacts_cursor ON contacts (tenant_id, created_at DESC, id DESC);

-- ---------------------------------------------------------------------
-- Timeline do perfil 360: atividade passa a poder apontar para a entidade.
-- ---------------------------------------------------------------------
ALTER TABLE activities ADD COLUMN IF NOT EXISTS contact_id UUID NULL REFERENCES contacts(id) ON DELETE CASCADE;
ALTER TABLE activities ADD COLUMN IF NOT EXISTS deal_id    UUID NULL REFERENCES deals(id)    ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities (tenant_id, contact_id, created_at DESC);

-- ---------------------------------------------------------------------
-- RLS — mesmo padrão do 003 (policy única tenant_rw + FORCE).
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['companies','tasks','notes']
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
END$$;

-- ---------------------------------------------------------------------
-- Roteamento do webhook de Lead Ads da Meta: page_id → tenant.
-- Mesma justificativa da migration 008: o webhook é público e chega sem
-- tenant; a app (orvyn_app, NOBYPASSRLS) não enxerga `integrations` sem o
-- contexto. A função SECURITY DEFINER expõe SOMENTE o tenant_id de
-- roteamento — nenhum dado de negócio atravessa.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS meta_pages (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id UUID NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
  page_id        TEXT NOT NULL,
  page_nome      TEXT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (page_id)          -- uma página do Facebook pertence a um único tenant
);
CREATE INDEX IF NOT EXISTS idx_meta_pages_tenant ON meta_pages (tenant_id);

ALTER TABLE meta_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_pages FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON meta_pages;
CREATE POLICY tenant_rw ON meta_pages FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON meta_pages TO orvyn_app, orvyn_service;

CREATE OR REPLACE FUNCTION resolve_tenant_by_meta_page(p_page_id TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tenant_id FROM meta_pages p WHERE p.page_id = p_page_id LIMIT 1;
$$;
ALTER FUNCTION resolve_tenant_by_meta_page(TEXT) OWNER TO orvyn_service;
REVOKE ALL ON FUNCTION resolve_tenant_by_meta_page(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_meta_page(TEXT) TO orvyn_app;

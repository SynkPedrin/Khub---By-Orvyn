-- =====================================================================
-- 052_contact_views.sql — listas salvas (smart lists) de Leads/Contatos
--
-- Contexto (Q2.2): a lista real de Leads ganhou busca, filtros, ordenação e
-- colunas configuráveis. "Lista salva" guarda essa combinação com um nome
-- (paridade com as Smart Lists do GHL). Pertence a quem criou
-- (`owner_identity_id`); `compartilhada = true` deixa a equipe do MESMO
-- tenant usar (só o dono altera ou apaga). Filtros e colunas são jsonb
-- validados na API (contrato em contatos-filtro.ts), nunca SQL.
--
-- Índices de apoio às novas operações:
--   * nome único por dono (case-insensitive);
--   * e-mail normalizado por tenant (dedupe do import e tela "Duplicados").
--     O de telefone já existe (idx_contacts_fone_cauda, db/012).
--
-- ADITIVA: tabela e índices novos. Nenhuma linha existente muda.
--
-- Rollback (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS contact_views;
--   DROP INDEX IF EXISTS idx_contacts_email_lower;
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS contact_views (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome               TEXT NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 80),
  filtros            JSONB NOT NULL DEFAULT '{}'::jsonb,
  colunas            JSONB NOT NULL DEFAULT '[]'::jsonb,
  ordem              TEXT NOT NULL DEFAULT 'recentes',
  owner_identity_id  UUID NOT NULL,
  compartilhada      BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(filtros) = 'object'),
  CHECK (jsonb_typeof(colunas) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_contact_views_nome
  ON contact_views (tenant_id, owner_identity_id, lower(nome));
CREATE INDEX IF NOT EXISTS idx_contact_views_tenant
  ON contact_views (tenant_id, compartilhada, owner_identity_id);

CREATE INDEX IF NOT EXISTS idx_contacts_email_lower
  ON contacts (tenant_id, lower(email)) WHERE email IS NOT NULL;

ALTER TABLE contact_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_views FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON contact_views;
CREATE POLICY tenant_rw ON contact_views FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON contact_views TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

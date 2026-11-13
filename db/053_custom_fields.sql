-- =====================================================================
-- 053_custom_fields.sql — campos personalizados com definição (Q2.3 = RV-02.1)
--
-- Contexto: `contacts.campos_custom` e `companies.campos_custom` (jsonb) já
-- existiam, mas sem definição: qualquer chave entrava, a UI não sabia o tipo
-- e não havia como filtrar. Esta migração cria o catálogo de definições por
-- tenant e entidade (contact|deal|company) e dá a `deals` a mesma coluna de
-- valores. Os VALORES continuam no jsonb da própria entidade (sem EAV):
-- leitura do perfil sem join e filtro por containment (`@>`) com índice GIN.
--
--   custom_field_defs  — uma linha por campo definido (chave estável, slug)
--   deals.campos_custom — jsonb NOT NULL DEFAULT '{}' (contacts/companies já têm)
--   idx_contacts_campos_custom — GIN jsonb_path_ops para `campos_custom @> {...}`
--
-- Arquivar (`arquivado_em`) NÃO apaga valores: o campo some do formulário e do
-- filtro, o dado do registro fica intacto e volta se o campo for restaurado.
--
-- ADITIVA: tabela nova + coluna nova com default + índice. Nenhuma linha
-- existente muda de valor.
--
-- Rollback (manual):
--   BEGIN;
--   DROP INDEX IF EXISTS idx_contacts_campos_custom;
--   ALTER TABLE deals DROP COLUMN IF EXISTS campos_custom;  -- só deals: contacts/companies já tinham a coluna
--   DROP TABLE IF EXISTS custom_field_defs;
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS custom_field_defs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entidade     TEXT NOT NULL CHECK (entidade IN ('contact', 'deal', 'company')),
  -- slug estável: é a chave no jsonb de valores; não muda depois de criada
  chave        TEXT NOT NULL CHECK (chave ~ '^[a-z][a-z0-9_]{0,49}$'),
  rotulo       TEXT NOT NULL CHECK (length(btrim(rotulo)) BETWEEN 1 AND 80),
  tipo         TEXT NOT NULL CHECK (tipo IN ('text', 'textarea', 'number', 'money', 'date', 'select', 'multiselect', 'boolean', 'phone', 'email', 'url')),
  -- select/multiselect: array de strings (opções); demais tipos: '[]'
  opcoes       JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(opcoes) = 'array'),
  obrigatorio  BOOLEAN NOT NULL DEFAULT false,
  ordem        INTEGER NOT NULL DEFAULT 0,
  grupo        TEXT NULL CHECK (grupo IS NULL OR length(grupo) <= 60),
  arquivado_em TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_custom_field_defs_chave UNIQUE (tenant_id, entidade, chave)
);

CREATE INDEX IF NOT EXISTS idx_custom_field_defs_lista
  ON custom_field_defs (tenant_id, entidade, ordem);

ALTER TABLE custom_field_defs ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_field_defs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON custom_field_defs;
CREATE POLICY tenant_rw ON custom_field_defs FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON custom_field_defs TO %I', r);
    END IF;
  END LOOP;
END $$;

-- Valores de campos personalizados do negócio (contacts e companies já têm).
ALTER TABLE deals     ADD COLUMN IF NOT EXISTS campos_custom JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS campos_custom JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contacts  ADD COLUMN IF NOT EXISTS campos_custom JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Filtro `cf_<chave>=<valor>` vira `campos_custom @> '{"chave": valor}'`:
-- jsonb_path_ops é o opclass menor e mais rápido para containment.
CREATE INDEX IF NOT EXISTS idx_contacts_campos_custom ON contacts USING GIN (campos_custom jsonb_path_ops);

COMMIT;

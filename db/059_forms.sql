-- =====================================================================
-- 059_forms.sql — Formulários públicos (Q4.1, paridade com o Forms do GHL)
--
-- Contexto: o tenant monta um formulário no construtor (/formularios), publica
-- num link público (/f/<slug>) ou embute no site (iframe/script). Cada envio
-- cria/atualiza o contato (dedupe por e-mail/telefone no CRM), aplica tag,
-- cria negócio opcional e publica `form.submitted` no outbox (consumido pelo
-- gatilho `formulario_enviado` das automações, Q3.2).
--
-- Tabelas:
--   forms             definição (campos jsonb, estilo jsonb, tag, etapa).
--   form_submissions  cada envio (respostas, utm, ip_hash, user_agent).
--
-- Rota PÚBLICA sem sessão: o tenant sai do slug pela função SECURITY DEFINER
-- `resolve_form_by_slug` (mesmo padrão de `resolve_workflow_by_webhook_key`,
-- db/011). O corpo do request NUNCA escolhe tenant.
--
-- LGPD: respostas são dado pessoal do contato. `form_submissions.contact_id`
-- é ON DELETE CASCADE: excluir o contato apaga as respostas dele. O IP não é
-- gravado em claro (só sha256 com sal por tenant, para rate limit e auditoria).
--
-- Roda no QA (papéis khub_*) e no DEV (papéis orvyn_*).
--
-- Rollback (manual):
--   BEGIN;
--   DROP FUNCTION IF EXISTS resolve_form_by_slug(TEXT);
--   DROP TABLE IF EXISTS form_submissions;
--   DROP TABLE IF EXISTS forms;
--   DELETE FROM schema_migrations WHERE filename = 'db/059_forms.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS forms (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL CHECK (char_length(btrim(nome)) BETWEEN 1 AND 120),
  -- Slug global: é a URL pública (/f/<slug>). Único entre TODOS os tenants.
  slug        TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'),
  campos      JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(campos) = 'array'),
  estilo      JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estilo) = 'object'),
  ativo       BOOLEAN NOT NULL DEFAULT TRUE,
  tag         TEXT NULL CHECK (tag IS NULL OR char_length(tag) BETWEEN 1 AND 40),
  -- Negócio opcional: etapa (o funil sai da etapa).
  stage_id    UUID NULL REFERENCES stages(id) ON DELETE SET NULL,
  created_by  UUID NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_forms_tenant ON forms (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS form_submissions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  form_id     UUID NOT NULL REFERENCES forms(id) ON DELETE CASCADE,
  contact_id  UUID NULL REFERENCES contacts(id) ON DELETE CASCADE,
  deal_id     UUID NULL REFERENCES deals(id) ON DELETE SET NULL,
  respostas   JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(respostas) = 'object'),
  utm         JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utm) = 'object'),
  ip_hash     TEXT NULL CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent  TEXT NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form ON form_submissions (tenant_id, form_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_contact ON form_submissions (tenant_id, contact_id);

-- RLS + grants (os dois nomes de papel).
DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['forms','form_submissions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
    FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- Referências cross-tenant (RLS sozinha não garante): etapa do form, e
-- form/contato/negócio do envio precisam ser do MESMO tenant da linha.
DO $$
DECLARE fn text;
BEGIN
 SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference','orvyn_check_tenant_reference')
  ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
 IF fn IS NOT NULL THEN
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON forms';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON forms FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'stage_id', 'stages');
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON form_submissions';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON form_submissions FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L)',
    fn, 'form_id', 'forms', 'contact_id', 'contacts', 'deal_id', 'deals');
 END IF;
END $$;

-- Resolução pública do slug → (tenant, form). Só formulário ATIVO. Devolve
-- também o nome do tenant (marca na página pública) e nada além disso.
CREATE OR REPLACE FUNCTION resolve_form_by_slug(p_slug TEXT)
RETURNS TABLE (tenant_id UUID, form_id UUID, tenant_nome TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT f.tenant_id, f.id, t.nome
  FROM forms f JOIN tenants t ON t.id = f.tenant_id
  WHERE f.slug = p_slug AND f.ativo
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_form_by_slug(TEXT) FROM PUBLIC;
DO $$
DECLARE dono text; r text;
BEGIN
 SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service','orvyn_service')
  ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
 IF dono IS NOT NULL THEN EXECUTE format('ALTER FUNCTION resolve_form_by_slug(TEXT) OWNER TO %I', dono); END IF;
 FOREACH r IN ARRAY ARRAY['khub_app','orvyn_app'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_form_by_slug(TEXT) TO %I', r);
  END IF;
 END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- 035_khub_rename.sql — rebrand Orvyn → KHUB nos objetos do banco (ADR-0041)
--
-- RENOMEIA (não recria): papéis, funções e gatilhos guardam OID; GRANTs,
-- policies RLS (`TO orvyn_app`), triggers que chamam a função e defaults
-- seguem apontando para o mesmo objeto. Nenhum dado muda.
--
--   orvyn_app                     → khub_app
--   orvyn_service                 → khub_service
--   orvyn_check_tenant_reference  → khub_check_tenant_reference
--   orvyn_domain_outbox           → khub_domain_outbox
--   trigger orvyn_outbox (contacts, deals, messages) → khub_outbox
--
-- IMPORTANTE (deploy): a senha SCRAM-SHA-256 sobrevive ao rename (Postgres 14+
-- padrão). Depois de aplicar, a URL de conexão da aplicação passa a usar
-- `khub_app` (DATABASE_URL) — trocar no MESMO deploy, senão o login no banco
-- falha. Conexões já abertas continuam funcionando até reconectar.
-- As migrações 000–034 continuam citando `orvyn_*`: elas são o histórico que
-- roda ANTES desta e criam os objetos que esta renomeia.
--
-- Rollback (manual):
--   ALTER ROLE khub_app RENAME TO orvyn_app;
--   ALTER ROLE khub_service RENAME TO orvyn_service;
--   ALTER FUNCTION khub_check_tenant_reference() RENAME TO orvyn_check_tenant_reference;
--   ALTER FUNCTION khub_domain_outbox() RENAME TO orvyn_domain_outbox;
--   ALTER TRIGGER khub_outbox ON contacts RENAME TO orvyn_outbox;  (idem deals, messages)
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orvyn_app') AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khub_app') THEN
    EXECUTE 'ALTER ROLE orvyn_app RENAME TO khub_app';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orvyn_service') AND NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khub_service') THEN
    EXECUTE 'ALTER ROLE orvyn_service RENAME TO khub_service';
  END IF;
  -- Ambiente novo sem os papéis antigos (não deveria acontecer: 000 os cria).
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khub_app') OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'khub_service') THEN
    RAISE EXCEPTION 'papéis khub_app/khub_service ausentes após o rename';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'orvyn_check_tenant_reference') AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'khub_check_tenant_reference') THEN
    EXECUTE 'ALTER FUNCTION orvyn_check_tenant_reference() RENAME TO khub_check_tenant_reference';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'orvyn_domain_outbox') AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'khub_domain_outbox') THEN
    EXECUTE 'ALTER FUNCTION orvyn_domain_outbox() RENAME TO khub_domain_outbox';
  END IF;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['contacts', 'deals', 'messages'] LOOP
    IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orvyn_outbox' AND tgrelid = t::regclass) THEN
      EXECUTE format('ALTER TRIGGER orvyn_outbox ON %I RENAME TO khub_outbox', t);
    END IF;
  END LOOP;
END $$;

COMMIT;

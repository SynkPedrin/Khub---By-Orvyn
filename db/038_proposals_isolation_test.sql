-- =====================================================================
-- Propostas — teste de isolamento cross-tenant (db/038)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/038_proposals_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. A não lê, não altera e não apaga proposta de B;
--   2. INSERT com tenant_id de B é barrado (WITH CHECK);
--   3. proposta de A apontando para contato/negócio de B é barrada pelo
--      gatilho tenant_reference;
--   4. sem tenant na sessão, nada é visível.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000038', 'TENANT_A_PROP'),
  ('b2b2b2b2-0000-4000-8000-000000000038', 'TENANT_B_PROP');
INSERT INTO pipelines (id, tenant_id, nome) VALUES
  ('3a000000-0000-4000-8000-00000000038a', 'a1a1a1a1-0000-4000-8000-000000000038', 'Funil A'),
  ('3b000000-0000-4000-8000-00000000038b', 'b2b2b2b2-0000-4000-8000-000000000038', 'Funil B');
INSERT INTO stages (id, tenant_id, pipeline_id, nome, ordem) VALUES
  ('4a000000-0000-4000-8000-00000000038a', 'a1a1a1a1-0000-4000-8000-000000000038', '3a000000-0000-4000-8000-00000000038a', 'Novo', 0),
  ('4b000000-0000-4000-8000-00000000038b', 'b2b2b2b2-0000-4000-8000-000000000038', '3b000000-0000-4000-8000-00000000038b', 'Novo', 0);
INSERT INTO contacts (id, tenant_id, nome) VALUES
  ('ca000000-0000-4000-8000-00000000038a', 'a1a1a1a1-0000-4000-8000-000000000038', 'Contato A'),
  ('cb000000-0000-4000-8000-00000000038b', 'b2b2b2b2-0000-4000-8000-000000000038', 'CONTATO_SECRETO_B');
INSERT INTO deals (id, tenant_id, titulo, contact_id, pipeline_id, stage_id) VALUES
  ('5a000000-0000-4000-8000-00000000038a', 'a1a1a1a1-0000-4000-8000-000000000038', 'Negócio A', 'ca000000-0000-4000-8000-00000000038a', '3a000000-0000-4000-8000-00000000038a', '4a000000-0000-4000-8000-00000000038a'),
  ('5b000000-0000-4000-8000-00000000038b', 'b2b2b2b2-0000-4000-8000-000000000038', 'NEGOCIO_SECRETO_B', 'cb000000-0000-4000-8000-00000000038b', '3b000000-0000-4000-8000-00000000038b', '4b000000-0000-4000-8000-00000000038b');
INSERT INTO proposals (id, tenant_id, contact_id, deal_id, titulo, valor) VALUES
  ('6a000000-0000-4000-8000-00000000038a', 'a1a1a1a1-0000-4000-8000-000000000038', 'ca000000-0000-4000-8000-00000000038a', '5a000000-0000-4000-8000-00000000038a', 'Proposta A', 100),
  ('6b000000-0000-4000-8000-00000000038b', 'b2b2b2b2-0000-4000-8000-000000000038', 'cb000000-0000-4000-8000-00000000038b', '5b000000-0000-4000-8000-00000000038b', 'PROPOSTA_SECRETA_B', 999);

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  -- sem tenant na sessão: nada aparece
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM proposals;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[proposals sem tenant]: % linha(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000038', true);

  SELECT count(*) INTO n FROM proposals WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000038' OR titulo = 'PROPOSTA_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[proposals]: tenant A leu % proposta(s) de B', n; END IF;
  SELECT count(*) INTO n FROM proposals;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[proposals]: esperava 1 proposta de A, veio %', n; END IF;

  UPDATE proposals SET titulo = 'ALTERADA' WHERE id = '6b000000-0000-4000-8000-00000000038b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update proposals]: A alterou proposta de B'; END IF;

  DELETE FROM proposals WHERE id = '6b000000-0000-4000-8000-00000000038b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete proposals]: A apagou proposta de B'; END IF;

  BEGIN
    INSERT INTO proposals (tenant_id, titulo) VALUES ('b2b2b2b2-0000-4000-8000-000000000038', 'FORJADA_EM_B');
    RAISE EXCEPTION 'VAZAMENTO[write proposals]: A gravou proposta no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proposals (tenant_id, contact_id, titulo) VALUES ('a1a1a1a1-0000-4000-8000-000000000038', 'cb000000-0000-4000-8000-00000000038b', 'APONTA_CONTATO_B');
    RAISE EXCEPTION 'VAZAMENTO[ref proposals→contacts]: A referenciou contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO proposals (tenant_id, deal_id, titulo) VALUES ('a1a1a1a1-0000-4000-8000-000000000038', '5b000000-0000-4000-8000-00000000038b', 'APONTA_NEGOCIO_B');
    RAISE EXCEPTION 'VAZAMENTO[ref proposals→deals]: A referenciou negócio de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK proposals: leitura, update, delete, insert e referência cruzada isolados';
END $$;

RESET ROLE;
ROLLBACK;

\echo '============================================'
\echo ' 038 OK — propostas isoladas por tenant.'
\echo '============================================'

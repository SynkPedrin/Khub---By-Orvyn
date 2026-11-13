-- =====================================================================
-- Listas salvas — teste de isolamento cross-tenant (db/052)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/052_contact_views_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nada é visível;
--   2. A não lê lista de B, nem a COMPARTILHADA (compartilhar é dentro do tenant);
--   3. A não altera nem apaga lista de B;
--   4. INSERT com tenant_id de B é barrado (WITH CHECK);
--   5. UPDATE que tenta mover lista de A para B é barrado.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000052', 'TENANT_A_VIEWS'),
  ('b2b2b2b2-0000-4000-8000-000000000052', 'TENANT_B_VIEWS');
INSERT INTO contact_views (id, tenant_id, nome, filtros, owner_identity_id, compartilhada) VALUES
  ('7a000000-0000-4000-8000-00000000052a', 'a1a1a1a1-0000-4000-8000-000000000052', 'Lista A', '{"tag":"vip"}', '9a000000-0000-4000-8000-00000000052a', false),
  ('7b000000-0000-4000-8000-00000000052b', 'b2b2b2b2-0000-4000-8000-000000000052', 'LISTA_SECRETA_B', '{"tag":"segredo"}', '9b000000-0000-4000-8000-00000000052b', true);

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM contact_views;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[contact_views sem tenant]: % linha(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000052', true);

  SELECT count(*) INTO n FROM contact_views WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000052' OR nome = 'LISTA_SECRETA_B' OR compartilhada;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[contact_views]: tenant A leu % lista(s) de B', n; END IF;
  SELECT count(*) INTO n FROM contact_views;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[contact_views]: esperava 1 lista de A, veio %', n; END IF;

  UPDATE contact_views SET nome = 'ALTERADA' WHERE id = '7b000000-0000-4000-8000-00000000052b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update contact_views]: A alterou lista de B'; END IF;

  DELETE FROM contact_views WHERE id = '7b000000-0000-4000-8000-00000000052b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete contact_views]: A apagou lista de B'; END IF;

  BEGIN
    INSERT INTO contact_views (tenant_id, nome, owner_identity_id) VALUES ('b2b2b2b2-0000-4000-8000-000000000052', 'FORJADA_EM_B', '9a000000-0000-4000-8000-00000000052a');
    RAISE EXCEPTION 'VAZAMENTO[write contact_views]: A gravou lista no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  BEGIN
    UPDATE contact_views SET tenant_id = 'b2b2b2b2-0000-4000-8000-000000000052' WHERE id = '7a000000-0000-4000-8000-00000000052a';
    RAISE EXCEPTION 'VAZAMENTO[move contact_views]: A moveu lista para B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS 052_contact_views_isolation_test: 0 vazamentos';
END $$;

ROLLBACK;

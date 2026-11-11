-- =====================================================================
-- Motivos de perda — teste de isolamento cross-tenant (db/051)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/051_lost_reasons_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nenhum motivo é visível;
--   2. A não lê, não altera e não apaga motivo de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. o mesmo nome pode existir em A e em B (unicidade é por tenant),
--      mas não duplica dentro de A (nem mudando maiúsculas);
--   5. negócio de A não aponta para motivo de B (gatilho de referência);
--   6. negócio de A aceita motivo de A e o filtro por dono não enxerga B.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000051', 'TENANT_A_LR'),
  ('b2b2b2b2-0000-4000-8000-000000000051', 'TENANT_B_LR');
INSERT INTO lost_reasons (id, tenant_id, nome, ordem) VALUES
  ('7a000000-0000-4000-8000-00000000051a', 'a1a1a1a1-0000-4000-8000-000000000051', 'Preço', 0),
  ('7b000000-0000-4000-8000-00000000051b', 'b2b2b2b2-0000-4000-8000-000000000051', 'MOTIVO_SECRETO_B', 0);
INSERT INTO pipelines (id, tenant_id, nome) VALUES
  ('9a000000-0000-4000-8000-00000000051a', 'a1a1a1a1-0000-4000-8000-000000000051', 'Funil A'),
  ('9b000000-0000-4000-8000-00000000051b', 'b2b2b2b2-0000-4000-8000-000000000051', 'Funil B');
INSERT INTO stages (id, tenant_id, pipeline_id, nome, ordem) VALUES
  ('5a000000-0000-4000-8000-00000000051a', 'a1a1a1a1-0000-4000-8000-000000000051', '9a000000-0000-4000-8000-00000000051a', 'Novo', 0),
  ('5b000000-0000-4000-8000-00000000051b', 'b2b2b2b2-0000-4000-8000-000000000051', '9b000000-0000-4000-8000-00000000051b', 'Novo', 0);
INSERT INTO deals (id, tenant_id, titulo, pipeline_id, stage_id, owner_id) VALUES
  ('da000000-0000-4000-8000-00000000051a', 'a1a1a1a1-0000-4000-8000-000000000051', 'Negócio A', '9a000000-0000-4000-8000-00000000051a', '5a000000-0000-4000-8000-00000000051a', NULL),
  ('db000000-0000-4000-8000-00000000051b', 'b2b2b2b2-0000-4000-8000-000000000051', 'NEGOCIO_SECRETO_B', '9b000000-0000-4000-8000-00000000051b', '5b000000-0000-4000-8000-00000000051b', 'eeeeeeee-0000-4000-8000-000000000051');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM lost_reasons;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[lost_reasons sem tenant]: % linha(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000051', true);

  SELECT count(*) INTO n FROM lost_reasons WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000051' OR nome = 'MOTIVO_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[lost_reasons]: tenant A leu % motivo(s) de B', n; END IF;
  SELECT count(*) INTO n FROM lost_reasons;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[lost_reasons]: esperava 1 motivo de A, veio %', n; END IF;

  UPDATE lost_reasons SET nome = 'ALTERADO' WHERE id = '7b000000-0000-4000-8000-00000000051b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update lost_reasons]: A alterou motivo de B'; END IF;

  DELETE FROM lost_reasons WHERE id = '7b000000-0000-4000-8000-00000000051b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete lost_reasons]: A apagou motivo de B'; END IF;

  BEGIN
    INSERT INTO lost_reasons (tenant_id, nome) VALUES ('b2b2b2b2-0000-4000-8000-000000000051', 'FORJADO_EM_B');
    RAISE EXCEPTION 'VAZAMENTO[write lost_reasons]: A gravou motivo no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- unicidade por tenant: A pode usar o nome que B já usa
  INSERT INTO lost_reasons (tenant_id, nome) VALUES ('a1a1a1a1-0000-4000-8000-000000000051', 'MOTIVO_SECRETO_B');
  BEGIN
    INSERT INTO lost_reasons (tenant_id, nome) VALUES ('a1a1a1a1-0000-4000-8000-000000000051', 'PREÇO');
    RAISE EXCEPTION 'FALHA[uq lost_reasons]: nome duplicado (maiúsculas) aceito no mesmo tenant';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- negócio de A não referencia motivo de B (a FK sozinha deixaria)
  BEGIN
    UPDATE deals SET status = 'perdido', motivo_perda_id = '7b000000-0000-4000-8000-00000000051b'
     WHERE id = 'da000000-0000-4000-8000-00000000051a';
    RAISE EXCEPTION 'VAZAMENTO[deals.motivo_perda_id]: negócio de A apontou para motivo de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  UPDATE deals SET status = 'perdido', motivo_perda_id = '7a000000-0000-4000-8000-00000000051a', motivo_perda_obs = 'achou caro'
   WHERE id = 'da000000-0000-4000-8000-00000000051a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[deals.motivo_perda_id]: motivo do próprio tenant recusado'; END IF;

  SELECT count(*) INTO n FROM deals WHERE owner_id = 'eeeeeeee-0000-4000-8000-000000000051';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[deals.owner_id]: filtro por dono enxergou negócio de B'; END IF;

  RAISE NOTICE 'OK lost_reasons: leitura, update, delete, insert, unicidade e referência isolados';
END $$;

ROLLBACK;

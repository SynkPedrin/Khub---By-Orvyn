-- =====================================================================
-- Campos personalizados — teste de isolamento cross-tenant (db/053)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/053_custom_fields_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nenhuma definição é visível;
--   2. A não lê, não altera e não apaga definição de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. a mesma chave pode existir em A e em B (unicidade é por tenant);
--   5. o filtro por containment em contacts.campos_custom não enxerga B.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000053', 'TENANT_A_CF'),
  ('b2b2b2b2-0000-4000-8000-000000000053', 'TENANT_B_CF');
INSERT INTO custom_field_defs (id, tenant_id, entidade, chave, rotulo, tipo) VALUES
  ('7a000000-0000-4000-8000-00000000053a', 'a1a1a1a1-0000-4000-8000-000000000053', 'contact', 'convenio', 'Convênio A', 'text'),
  ('7b000000-0000-4000-8000-00000000053b', 'b2b2b2b2-0000-4000-8000-000000000053', 'contact', 'segredo_b', 'CAMPO_SECRETO_B', 'text');
INSERT INTO contacts (id, tenant_id, nome, campos_custom) VALUES
  ('ca000000-0000-4000-8000-00000000053a', 'a1a1a1a1-0000-4000-8000-000000000053', 'Contato A', '{"convenio":"Unimed"}'),
  ('cb000000-0000-4000-8000-00000000053b', 'b2b2b2b2-0000-4000-8000-000000000053', 'CONTATO_SECRETO_B', '{"convenio":"Unimed","segredo_b":"x"}');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM custom_field_defs;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[custom_field_defs sem tenant]: % linha(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000053', true);

  SELECT count(*) INTO n FROM custom_field_defs WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000053' OR rotulo = 'CAMPO_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[custom_field_defs]: tenant A leu % definição(ões) de B', n; END IF;
  SELECT count(*) INTO n FROM custom_field_defs;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[custom_field_defs]: esperava 1 definição de A, veio %', n; END IF;

  UPDATE custom_field_defs SET rotulo = 'ALTERADO' WHERE id = '7b000000-0000-4000-8000-00000000053b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update custom_field_defs]: A alterou definição de B'; END IF;

  DELETE FROM custom_field_defs WHERE id = '7b000000-0000-4000-8000-00000000053b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete custom_field_defs]: A apagou definição de B'; END IF;

  BEGIN
    INSERT INTO custom_field_defs (tenant_id, entidade, chave, rotulo, tipo)
      VALUES ('b2b2b2b2-0000-4000-8000-000000000053', 'contact', 'forjado', 'FORJADO_EM_B', 'text');
    RAISE EXCEPTION 'VAZAMENTO[write custom_field_defs]: A gravou definição no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- unicidade é por tenant: A pode ter a mesma chave que B já usa
  INSERT INTO custom_field_defs (tenant_id, entidade, chave, rotulo, tipo)
    VALUES ('a1a1a1a1-0000-4000-8000-000000000053', 'contact', 'segredo_b', 'Mesmo slug em A', 'text');

  -- e não pode duplicar dentro do próprio tenant+entidade
  BEGIN
    INSERT INTO custom_field_defs (tenant_id, entidade, chave, rotulo, tipo)
      VALUES ('a1a1a1a1-0000-4000-8000-000000000053', 'contact', 'convenio', 'Duplicado', 'text');
    RAISE EXCEPTION 'FALHA[uq custom_field_defs]: chave duplicada aceita no mesmo tenant';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- filtro do CRM (containment no jsonb) só enxerga o próprio tenant
  SELECT count(*) INTO n FROM contacts WHERE campos_custom @> '{"convenio":"Unimed"}'::jsonb;
  IF n <> 1 THEN RAISE EXCEPTION 'VAZAMENTO[filtro campos_custom]: esperava 1 contato de A, veio %', n; END IF;
  SELECT count(*) INTO n FROM contacts WHERE campos_custom ? 'segredo_b';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[filtro campos_custom]: A enxergou valor de B'; END IF;

  RAISE NOTICE 'OK custom_field_defs: leitura, update, delete, insert e filtro isolados';
END $$;

RESET ROLE;
ROLLBACK;

\echo '============================================'
\echo ' 053 OK — campos personalizados isolados por tenant.'
\echo '============================================'

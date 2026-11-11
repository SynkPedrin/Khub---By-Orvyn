-- =====================================================================
-- NICO relatórios/agendamentos — teste de isolamento cross-tenant (db/039)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0. ROLLBACK no fim.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000039', 'TENANT_A_NICO'),
  ('b2b2b2b2-0000-4000-8000-000000000039', 'TENANT_B_NICO');
INSERT INTO nico_agendamentos (id, tenant_id, titulo, instrucao, frequencia, proximo_em) VALUES
  ('7a000000-0000-4000-8000-00000000039a', 'a1a1a1a1-0000-4000-8000-000000000039', 'Rotina A', 'analise as campanhas', 'semanal', now()),
  ('7b000000-0000-4000-8000-00000000039b', 'b2b2b2b2-0000-4000-8000-000000000039', 'ROTINA_SECRETA_B', 'analise as campanhas de B', 'diaria', now());
INSERT INTO nico_relatorios (id, tenant_id, titulo, conteudo_md, origem, agendamento_id) VALUES
  ('8a000000-0000-4000-8000-00000000039a', 'a1a1a1a1-0000-4000-8000-000000000039', 'Relatório A', '# A', 'agendamento', '7a000000-0000-4000-8000-00000000039a'),
  ('8b000000-0000-4000-8000-00000000039b', 'b2b2b2b2-0000-4000-8000-000000000039', 'RELATORIO_SECRETO_B', '# B confidencial', 'chat', NULL);

SET LOCAL ROLE khub_app;
DO $$
DECLARE n INT; t TEXT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT (SELECT count(*) FROM nico_agendamentos) + (SELECT count(*) FROM nico_relatorios) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[nico sem tenant]: % linha(s)', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000039', true);
  FOREACH t IN ARRAY ARRAY['nico_agendamentos', 'nico_relatorios'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000039') INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: A leu % linha(s) de B', t, n; END IF;
    EXECUTE format('UPDATE %I SET titulo = %L WHERE tenant_id = %L', t, 'X', 'b2b2b2b2-0000-4000-8000-000000000039');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update %]', t; END IF;
    EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000039');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete %]', t; END IF;
  END LOOP;

  BEGIN
    INSERT INTO nico_relatorios (tenant_id, titulo, conteudo_md) VALUES ('b2b2b2b2-0000-4000-8000-000000000039', 'FORJADO', '# x');
    RAISE EXCEPTION 'VAZAMENTO[write nico_relatorios]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO nico_relatorios (tenant_id, titulo, conteudo_md, agendamento_id) VALUES ('a1a1a1a1-0000-4000-8000-000000000039', 'APONTA_B', '# x', '7b000000-0000-4000-8000-00000000039b');
    RAISE EXCEPTION 'VAZAMENTO[ref nico_relatorios→nico_agendamentos]: A apontou para rotina de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  RAISE NOTICE 'OK nico: agendamentos e relatórios isolados';
END $$;

RESET ROLE;
ROLLBACK;
\echo '============================================'
\echo ' 039 OK — relatórios e rotinas da NICO isolados.'
\echo '============================================'

-- =====================================================================
-- Simulações de campanha — teste de isolamento cross-tenant (db/067)
-- BLOQUEANTE: vazamento faz RAISE EXCEPTION. ROLLBACK no fim.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000067', 'TENANT_A_SIM'),
  ('b2b2b2b2-0000-4000-8000-000000000067', 'TENANT_B_SIM');
INSERT INTO ads_simulacoes (tenant_id, nome, entrada, resumo) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000067', 'Sim A', '{"objetivo":"leads"}', '{"resultados":10}'),
  ('b2b2b2b2-0000-4000-8000-000000000067', 'SIM_SECRETA_B', '{"objetivo":"mensagens"}', '{"resultados":42}');

SET LOCAL ROLE khub_app;
DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM ads_simulacoes;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[ads_simulacoes sem tenant]: %', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000067', true);
  SELECT count(*) INTO n FROM ads_simulacoes WHERE nome = 'SIM_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[ads_simulacoes]: A leu simulação de B'; END IF;
  UPDATE ads_simulacoes SET nome = 'x' WHERE nome = 'SIM_SECRETA_B';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update ads_simulacoes]'; END IF;
  DELETE FROM ads_simulacoes WHERE nome = 'SIM_SECRETA_B';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete ads_simulacoes]'; END IF;
  BEGIN
    INSERT INTO ads_simulacoes (tenant_id, nome, entrada) VALUES ('b2b2b2b2-0000-4000-8000-000000000067', 'invadindo', '{}');
    RAISE EXCEPTION 'VAZAMENTO[insert ads_simulacoes]: A gravou no tenant de B';
  EXCEPTION WHEN check_violation OR insufficient_privilege THEN NULL;
  END;
  RAISE NOTICE 'OK 067: simulações isoladas';
END $$;

RESET ROLE;
ROLLBACK;
\echo ' 067 OK — simulações de campanha isoladas por tenant.'

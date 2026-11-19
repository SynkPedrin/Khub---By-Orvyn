-- =====================================================================
-- Agenda do Avec (db/077): teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/077_agenda_avec_sync_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão nenhuma jornada aparece;
--   2. A não lê, não altera e não apaga jornada de B;
--   3. A não grava jornada com tenant de B nem apontando profissional de B;
--   4. a chave externa é única por tenant (o mesmo externo_id em A e B convive)
--      e origem/externo_id andam juntos.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000077', 'TENANT_A_AVEC'),
  ('b2b2b2b2-0000-4000-8000-000000000077', 'TENANT_B_AVEC');

SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000077', true);
INSERT INTO profissionais (id, tenant_id, nome) VALUES
  ('9b000000-0000-4000-8000-00000000077b', 'b2b2b2b2-0000-4000-8000-000000000077', 'PROFISSIONAL_SECRETA_B');
INSERT INTO agenda_jornadas (tenant_id, profissional_id, data, ini_min, fim_min) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000077', '9b000000-0000-4000-8000-00000000077b', '2030-01-02', 480, 1080);
INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim, profissional_id, origem, externo_id) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000077', 'ATENDIMENTO_SECRETO_B', '2030-01-02 12:00Z', '2030-01-02 13:00Z',
   '9b000000-0000-4000-8000-00000000077b', 'avec', 'r:mesma-chave');

SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000077', true);
INSERT INTO profissionais (id, tenant_id, nome) VALUES
  ('9a000000-0000-4000-8000-00000000077a', 'a1a1a1a1-0000-4000-8000-000000000077', 'Marina');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
  ta CONSTANT uuid := 'a1a1a1a1-0000-4000-8000-000000000077';
  tb CONSTANT uuid := 'b2b2b2b2-0000-4000-8000-000000000077';
BEGIN
  -- (1) Sem tenant: nada.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM agenda_jornadas;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[jornadas sem tenant]: % linha(s)', n; END IF;

  -- (2) A não lê/altera/apaga jornada de B.
  PERFORM set_config('app.current_tenant_id', ta::text, true);
  SELECT count(*) INTO n FROM agenda_jornadas WHERE tenant_id = tb;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[jornadas]: A leu % linha(s) de B', n; END IF;
  UPDATE agenda_jornadas SET ini_min = 0 WHERE tenant_id = tb;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update jornadas]: A alterou jornada de B'; END IF;
  DELETE FROM agenda_jornadas WHERE tenant_id = tb;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete jornadas]: A apagou jornada de B'; END IF;
  SELECT count(*) INTO n FROM agenda_compromissos WHERE externo_id = 'r:mesma-chave';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agenda externa]: A leu compromisso do Avec de B'; END IF;

  -- (3) Escrita com tenant de B, ou apontando profissional de B, é barrada.
  BEGIN
    INSERT INTO agenda_jornadas (tenant_id, profissional_id, data, ini_min, fim_min)
      VALUES (tb, '9b000000-0000-4000-8000-00000000077b', '2030-01-03', 480, 1080);
    RAISE EXCEPTION 'VAZAMENTO[write jornadas]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agenda_jornadas (tenant_id, profissional_id, data, ini_min, fim_min)
      VALUES (ta, '9b000000-0000-4000-8000-00000000077b', '2030-01-03', 480, 1080);
    RAISE EXCEPTION 'VAZAMENTO[ref jornadas]: jornada de A usou profissional de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- (4) Mesma chave do Avec em outro tenant convive; no mesmo tenant, não.
  INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim, profissional_id, origem, externo_id)
    VALUES (ta, 'Corte', '2030-01-02 12:00Z', '2030-01-02 13:00Z', '9a000000-0000-4000-8000-00000000077a', 'avec', 'r:mesma-chave');
  BEGIN
    INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim, origem, externo_id)
      VALUES (ta, 'Duplicado', '2030-01-02 12:00Z', '2030-01-02 13:00Z', 'avec', 'r:mesma-chave');
    RAISE EXCEPTION 'INTEGRIDADE[externo_id]: chave do Avec duplicada no mesmo tenant';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim, origem)
      VALUES (ta, 'Sem chave', '2030-01-02 12:00Z', '2030-01-02 13:00Z', 'avec');
    RAISE EXCEPTION 'INTEGRIDADE[origem]: linha do Avec sem chave';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- Jornada de A (ok) e folga (ambos NULL) são aceitas; faixa invertida não.
  INSERT INTO agenda_jornadas (tenant_id, profissional_id, data, ini_min, fim_min)
    VALUES (ta, '9a000000-0000-4000-8000-00000000077a', '2030-01-02', 480, 1080),
           (ta, '9a000000-0000-4000-8000-00000000077a', '2030-01-03', NULL, NULL);
  BEGIN
    INSERT INTO agenda_jornadas (tenant_id, profissional_id, data, ini_min, fim_min)
      VALUES (ta, '9a000000-0000-4000-8000-00000000077a', '2030-01-04', 900, 600);
    RAISE EXCEPTION 'INTEGRIDADE[jornada]: faixa invertida aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK: agenda do Avec (db/077) isolada por tenant';
END $$;

ROLLBACK;

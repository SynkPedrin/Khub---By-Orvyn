-- =====================================================================
-- Nós do motor (db/056) — teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/056_automation_nodes_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. A não lê, não altera e não forja `workflow_round_robin` de B;
--   2. A não lê nem troca `deals.owner_id` de B;
--   3. sem tenant na sessão, nada é visível;
--   4. o UPSERT do rodízio é atômico e devolve 1, 2, 3...
-- (Ambientes ainda com papéis orvyn_*: trocar khub_app/khub_service abaixo.)
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000056', 'TENANT_A_056'),
  ('b2b2b2b2-0000-4000-8000-000000000056', 'TENANT_B_056');
INSERT INTO identities (id, email) VALUES ('1d000000-0000-4000-8000-000000000056', 'dono-056@teste.local');
INSERT INTO workflows (id, tenant_id, nome) VALUES
  ('7a000000-0000-4000-8000-00000000056a', 'a1a1a1a1-0000-4000-8000-000000000056', 'Fluxo A'),
  ('7b000000-0000-4000-8000-00000000056b', 'b2b2b2b2-0000-4000-8000-000000000056', 'Fluxo B');
INSERT INTO workflow_round_robin (tenant_id, workflow_id, node_id, contador) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000056', '7b000000-0000-4000-8000-00000000056b', 'rr', 41);
INSERT INTO pipelines (id, tenant_id, nome) VALUES
  ('5b000000-0000-4000-8000-00000000056b', 'b2b2b2b2-0000-4000-8000-000000000056', 'Funil B');
INSERT INTO stages (id, tenant_id, pipeline_id, nome, ordem) VALUES
  ('6b000000-0000-4000-8000-00000000056b', 'b2b2b2b2-0000-4000-8000-000000000056', '5b000000-0000-4000-8000-00000000056b', 'Etapa B', 0);
INSERT INTO deals (id, tenant_id, titulo, pipeline_id, stage_id, owner_id) VALUES
  ('de000000-0000-4000-8000-00000000056b', 'b2b2b2b2-0000-4000-8000-000000000056', 'NEGOCIO_SECRETO_B',
   '5b000000-0000-4000-8000-00000000056b', '6b000000-0000-4000-8000-00000000056b', '1d000000-0000-4000-8000-000000000056');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; c BIGINT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM workflow_round_robin;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_round_robin sem tenant]: % linha(s)', n; END IF;
  SELECT count(*) INTO n FROM deals WHERE owner_id IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[deals.owner_id sem tenant]: % linha(s)', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000056', true);
  SELECT count(*) INTO n FROM workflow_round_robin WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000056';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_round_robin]: A leu contador de B'; END IF;
  UPDATE workflow_round_robin SET contador = 0 WHERE workflow_id = '7b000000-0000-4000-8000-00000000056b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update workflow_round_robin]: A zerou contador de B'; END IF;
  BEGIN
    INSERT INTO workflow_round_robin (tenant_id, workflow_id, node_id) VALUES
      ('b2b2b2b2-0000-4000-8000-000000000056', '7b000000-0000-4000-8000-00000000056b', 'forjado');
    RAISE EXCEPTION 'VAZAMENTO[write workflow_round_robin]: A gravou no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  SELECT count(*) INTO n FROM deals WHERE titulo = 'NEGOCIO_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[deals]: A leu negócio de B'; END IF;
  UPDATE deals SET owner_id = NULL WHERE id = 'de000000-0000-4000-8000-00000000056b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update deals.owner_id]: A trocou o dono do negócio de B'; END IF;

  -- rodízio atômico no próprio tenant: 1, 2, 3
  FOR i IN 1..3 LOOP
    INSERT INTO workflow_round_robin (tenant_id, workflow_id, node_id, contador)
      VALUES ('a1a1a1a1-0000-4000-8000-000000000056', '7a000000-0000-4000-8000-00000000056a', 'rr', 1)
      ON CONFLICT (tenant_id, workflow_id, node_id) DO UPDATE SET contador = workflow_round_robin.contador + 1, updated_at = now()
      RETURNING contador INTO c;
    IF c <> i THEN RAISE EXCEPTION 'FALHA[rodízio]: esperava %, veio %', i, c; END IF;
  END LOOP;

  PERFORM set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000056', true);
  SELECT contador INTO c FROM workflow_round_robin WHERE node_id = 'rr';
  IF c <> 41 THEN RAISE EXCEPTION 'VAZAMENTO[rodízio]: contador de B mudou para %', c; END IF;

  RAISE NOTICE 'db/056 isolamento: PASS';
END $$;

ROLLBACK;

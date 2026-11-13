-- =====================================================================
-- Automações (db/050) — teste de isolamento cross-tenant + regressão BUG-029
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/050_automation_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. A não lê nem altera `workflows.webhook_segredo` de B;
--   2. A não lê nem altera `workflow_runs.grafo_teste` de B;
--   3. sem tenant na sessão, nada é visível;
--   4. BUG-029: contato criado com a coluna `origem` (cadastro manual) ou com
--      `campos_custom.lead_origem` (lead de anúncio) gera `contact.created`
--      com essa origem no outbox; sem nenhuma das duas, 'Manual'.
-- (Ambientes ainda com papéis orvyn_*: trocar khub_app/khub_service abaixo.)
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000050', 'TENANT_A_AUTO'),
  ('b2b2b2b2-0000-4000-8000-000000000050', 'TENANT_B_AUTO');
INSERT INTO workflows (id, tenant_id, nome, webhook_segredo) VALUES
  ('7a000000-0000-4000-8000-00000000050a', 'a1a1a1a1-0000-4000-8000-000000000050', 'Fluxo A', 'segredo-a'),
  ('7b000000-0000-4000-8000-00000000050b', 'b2b2b2b2-0000-4000-8000-000000000050', 'Fluxo B', 'SEGREDO_SECRETO_B');
INSERT INTO workflow_versions (id, tenant_id, workflow_id, versao) VALUES
  ('8a000000-0000-4000-8000-00000000050a', 'a1a1a1a1-0000-4000-8000-000000000050', '7a000000-0000-4000-8000-00000000050a', 1),
  ('8b000000-0000-4000-8000-00000000050b', 'b2b2b2b2-0000-4000-8000-000000000050', '7b000000-0000-4000-8000-00000000050b', 1);
INSERT INTO workflow_runs (id, tenant_id, workflow_id, version_id, gatilho, teste, grafo_teste) VALUES
  ('9a000000-0000-4000-8000-00000000050a', 'a1a1a1a1-0000-4000-8000-000000000050', '7a000000-0000-4000-8000-00000000050a', '8a000000-0000-4000-8000-00000000050a', 'teste', true, '{"nos":[],"arestas":[]}'),
  ('9b000000-0000-4000-8000-00000000050b', 'b2b2b2b2-0000-4000-8000-000000000050', '7b000000-0000-4000-8000-00000000050b', '8b000000-0000-4000-8000-00000000050b', 'teste', true, '{"nos":[],"arestas":[],"segredo":"GRAFO_SECRETO_B"}');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; o TEXT;
BEGIN
  -- sem tenant na sessão: nada aparece
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM workflows WHERE webhook_segredo IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflows sem tenant]: % segredo(s) visíveis', n; END IF;
  SELECT count(*) INTO n FROM workflow_runs WHERE grafo_teste IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_runs sem tenant]: % grafo(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000050', true);

  SELECT count(*) INTO n FROM workflows WHERE webhook_segredo = 'SEGREDO_SECRETO_B' OR tenant_id = 'b2b2b2b2-0000-4000-8000-000000000050';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflows.webhook_segredo]: A leu segredo de B'; END IF;
  SELECT count(*) INTO n FROM workflow_runs WHERE grafo_teste::text LIKE '%GRAFO_SECRETO_B%' OR tenant_id = 'b2b2b2b2-0000-4000-8000-000000000050';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_runs.grafo_teste]: A leu grafo de teste de B'; END IF;
  SELECT count(*) INTO n FROM workflows;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[workflows]: esperava 1 workflow de A, veio %', n; END IF;

  UPDATE workflows SET webhook_segredo = 'ROUBADO' WHERE id = '7b000000-0000-4000-8000-00000000050b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update workflows]: A trocou o segredo de B'; END IF;
  UPDATE workflow_runs SET grafo_teste = '{}' WHERE id = '9b000000-0000-4000-8000-00000000050b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update workflow_runs]: A alterou run de B'; END IF;

  BEGIN
    INSERT INTO workflows (tenant_id, nome, webhook_segredo) VALUES ('b2b2b2b2-0000-4000-8000-000000000050', 'FORJADO_EM_B', 'x');
    RAISE EXCEPTION 'VAZAMENTO[write workflows]: A gravou workflow no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- BUG-029: origem no outbox
  INSERT INTO contacts (id, tenant_id, nome, origem) VALUES ('ca000000-0000-4000-8000-00000000050a', 'a1a1a1a1-0000-4000-8000-000000000050', 'Manual com origem', 'Indicação');
  SELECT payload->>'origem' INTO o FROM outbox_events WHERE kind = 'contact.created' AND payload->>'id' = 'ca000000-0000-4000-8000-00000000050a';
  IF o IS DISTINCT FROM 'Indicação' THEN RAISE EXCEPTION 'BUG-029[coluna origem]: outbox trouxe %', o; END IF;

  INSERT INTO contacts (id, tenant_id, nome, campos_custom) VALUES ('ca000000-0000-4000-8000-00000000050b', 'a1a1a1a1-0000-4000-8000-000000000050', 'Lead de anúncio', '{"lead_origem":"Meta Ads"}');
  SELECT payload->>'origem' INTO o FROM outbox_events WHERE kind = 'contact.created' AND payload->>'id' = 'ca000000-0000-4000-8000-00000000050b';
  IF o IS DISTINCT FROM 'Meta Ads' THEN RAISE EXCEPTION 'BUG-029[lead_origem]: outbox trouxe %', o; END IF;

  INSERT INTO contacts (id, tenant_id, nome, origem) VALUES ('ca000000-0000-4000-8000-00000000050c', 'a1a1a1a1-0000-4000-8000-000000000050', 'Sem origem', '');
  SELECT payload->>'origem' INTO o FROM outbox_events WHERE kind = 'contact.created' AND payload->>'id' = 'ca000000-0000-4000-8000-00000000050c';
  IF o IS DISTINCT FROM 'Manual' THEN RAISE EXCEPTION 'BUG-029[fallback]: outbox trouxe %', o; END IF;

  -- o evento nasceu no tenant de A (RLS do outbox)
  PERFORM set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000050', true);
  SELECT count(*) INTO n FROM outbox_events WHERE payload->>'id' LIKE 'ca000000-0000-4000-8000-00000000050%';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[outbox_events]: B viu % evento(s) de A', n; END IF;

  RAISE NOTICE 'db/050 isolamento + BUG-029: PASS';
END $$;

ROLLBACK;

-- =====================================================================
-- Editor de automações (db/058) — teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/058_automations_editor_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. A não lê nem altera `workflows.pasta` de B;
--   2. a consulta de execuções por contato (a mesma do endpoint
--      `GET /runs?contactId=`) não devolve run de B, nem passando o
--      contact_id de B;
--   3. a agregação de estatística por nó (mesma do `GET .../stats`) não
--      conta passo de B, nem passando o workflow_id de B;
--   4. sem tenant na sessão, nada é visível;
--   5. o CHECK de tamanho da pasta recusa pasta vazia.
-- (Ambientes ainda com papéis orvyn_*: trocar khub_app/khub_service abaixo.)
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000058', 'TENANT_A_EDITOR'),
  ('b2b2b2b2-0000-4000-8000-000000000058', 'TENANT_B_EDITOR');
INSERT INTO contacts (id, tenant_id, nome) VALUES
  ('ca000000-0000-4000-8000-00000000058a', 'a1a1a1a1-0000-4000-8000-000000000058', 'Contato A'),
  ('cb000000-0000-4000-8000-00000000058b', 'b2b2b2b2-0000-4000-8000-000000000058', 'Contato B');
INSERT INTO workflows (id, tenant_id, nome, pasta) VALUES
  ('7a000000-0000-4000-8000-00000000058a', 'a1a1a1a1-0000-4000-8000-000000000058', 'Fluxo A', 'Vendas'),
  ('7b000000-0000-4000-8000-00000000058b', 'b2b2b2b2-0000-4000-8000-000000000058', 'Fluxo B', 'PASTA_SECRETA_B');
INSERT INTO workflow_versions (id, tenant_id, workflow_id, versao) VALUES
  ('8a000000-0000-4000-8000-00000000058a', 'a1a1a1a1-0000-4000-8000-000000000058', '7a000000-0000-4000-8000-00000000058a', 1),
  ('8b000000-0000-4000-8000-00000000058b', 'b2b2b2b2-0000-4000-8000-000000000058', '7b000000-0000-4000-8000-00000000058b', 1);
INSERT INTO workflow_runs (id, tenant_id, workflow_id, version_id, gatilho, status, no_atual, contact_id) VALUES
  ('9a000000-0000-4000-8000-00000000058a', 'a1a1a1a1-0000-4000-8000-000000000058', '7a000000-0000-4000-8000-00000000058a', '8a000000-0000-4000-8000-00000000058a', 'teste', 'esperando', 'n1', 'ca000000-0000-4000-8000-00000000058a'),
  ('9b000000-0000-4000-8000-00000000058b', 'b2b2b2b2-0000-4000-8000-000000000058', '7b000000-0000-4000-8000-00000000058b', '8b000000-0000-4000-8000-00000000058b', 'teste', 'esperando', 'n1', 'cb000000-0000-4000-8000-00000000058b');
INSERT INTO workflow_run_steps (tenant_id, run_id, no_id, tipo, status) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000058', '9a000000-0000-4000-8000-00000000058a', 'g', 'gatilho.contato_criado', 'ok'),
  ('b2b2b2b2-0000-4000-8000-000000000058', '9b000000-0000-4000-8000-00000000058b', 'g', 'gatilho.contato_criado', 'ok'),
  ('b2b2b2b2-0000-4000-8000-000000000058', '9b000000-0000-4000-8000-00000000058b', 'g', 'gatilho.contato_criado', 'falhou');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  -- sem tenant na sessão: nada aparece
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM workflows WHERE pasta IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflows.pasta sem tenant]: % visíveis', n; END IF;
  SELECT count(*) INTO n FROM workflow_runs WHERE contact_id IS NOT NULL;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_runs sem tenant]: % visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000058', true);

  -- 1. pasta
  SELECT count(*) INTO n FROM workflows WHERE pasta = 'PASTA_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflows.pasta]: A leu pasta de B'; END IF;
  SELECT count(*) INTO n FROM workflows WHERE pasta = 'Vendas';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[workflows.pasta]: A não vê a própria pasta (%)', n; END IF;
  UPDATE workflows SET pasta = 'ROUBADA' WHERE id = '7b000000-0000-4000-8000-00000000058b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update workflows.pasta]: A moveu fluxo de B'; END IF;

  -- 2. execuções por contato (consulta do endpoint)
  SELECT count(*) INTO n FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
   WHERE r.contact_id = 'cb000000-0000-4000-8000-00000000058b';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[runs por contato]: A viu % run(s) do contato de B', n; END IF;
  SELECT count(*) INTO n FROM workflow_runs r JOIN workflows w ON w.id = r.workflow_id
   WHERE r.contact_id = 'ca000000-0000-4000-8000-00000000058a';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[runs por contato]: esperava 1 run de A, veio %', n; END IF;

  -- cancelar run de B ("remover deste fluxo") não pega
  UPDATE workflow_runs SET status = 'cancelado' WHERE id = '9b000000-0000-4000-8000-00000000058b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[cancelar run]: A cancelou run de B'; END IF;

  -- 3. estatística por nó (consulta do endpoint)
  SELECT count(*) INTO n FROM workflow_run_steps s JOIN workflow_runs r ON r.id = s.run_id
   WHERE r.workflow_id = '7b000000-0000-4000-8000-00000000058b';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[stats]: A contou % passo(s) de B', n; END IF;
  SELECT count(*) INTO n FROM workflow_run_steps s JOIN workflow_runs r ON r.id = s.run_id
   WHERE r.workflow_id = '7a000000-0000-4000-8000-00000000058a';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[stats]: esperava 1 passo de A, veio %', n; END IF;

  -- 5. CHECK da pasta
  BEGIN
    UPDATE workflows SET pasta = '   ' WHERE id = '7a000000-0000-4000-8000-00000000058a';
    RAISE EXCEPTION 'FALHA[workflows_pasta_len]: aceitou pasta em branco';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'db/058 isolamento: PASS';
END $$;

ROLLBACK;

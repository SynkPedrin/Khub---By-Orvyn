-- =====================================================================
-- Gatilhos do motor (db/057) — teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/057_automation_triggers_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. A não lê, não altera e não forja `workflow_schedules` de B;
--   2. sem tenant na sessão, nada é visível;
--   3. cobrança que vira `paga` gera UM `payment.received` no outbox do
--      próprio tenant (reabrir e pagar de novo não duplica); cobrança que não
--      está paga não gera nada; B não enxerga o evento de A.
-- (Ambientes ainda com papéis orvyn_*: trocar khub_app/khub_service abaixo.)
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000057', 'TENANT_A_057'),
  ('b2b2b2b2-0000-4000-8000-000000000057', 'TENANT_B_057');
INSERT INTO workflows (id, tenant_id, nome) VALUES
  ('7a000000-0000-4000-8000-00000000057a', 'a1a1a1a1-0000-4000-8000-000000000057', 'Fluxo A'),
  ('7b000000-0000-4000-8000-00000000057b', 'b2b2b2b2-0000-4000-8000-000000000057', 'Fluxo B');
INSERT INTO workflow_versions (id, tenant_id, workflow_id, versao) VALUES
  ('8a000000-0000-4000-8000-00000000057a', 'a1a1a1a1-0000-4000-8000-000000000057', '7a000000-0000-4000-8000-00000000057a', 1),
  ('8b000000-0000-4000-8000-00000000057b', 'b2b2b2b2-0000-4000-8000-000000000057', '7b000000-0000-4000-8000-00000000057b', 1);
INSERT INTO workflow_schedules (tenant_id, workflow_id, version_id, node_id, tipo, proximo_em) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000057', '7b000000-0000-4000-8000-00000000057b', '8b000000-0000-4000-8000-00000000057b', 'AGENDA_SECRETA_B', 'agendado', now());

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM workflow_schedules;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_schedules sem tenant]: % linha(s)', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000057', true);
  SELECT count(*) INTO n FROM workflow_schedules WHERE node_id = 'AGENDA_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_schedules]: A leu agenda de B'; END IF;
  UPDATE workflow_schedules SET lease_until = now() + interval '1 day' WHERE node_id = 'AGENDA_SECRETA_B';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update workflow_schedules]: A travou agenda de B'; END IF;
  DELETE FROM workflow_schedules WHERE node_id = 'AGENDA_SECRETA_B';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete workflow_schedules]: A apagou agenda de B'; END IF;
  BEGIN
    INSERT INTO workflow_schedules (tenant_id, workflow_id, version_id, node_id, tipo, proximo_em) VALUES
      ('b2b2b2b2-0000-4000-8000-000000000057', '7b000000-0000-4000-8000-00000000057b', '8b000000-0000-4000-8000-00000000057b', 'forjado', 'agendado', now());
    RAISE EXCEPTION 'VAZAMENTO[write workflow_schedules]: A gravou no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- agenda do próprio tenant funciona
  INSERT INTO workflow_schedules (tenant_id, workflow_id, version_id, node_id, tipo, proximo_em) VALUES
    ('a1a1a1a1-0000-4000-8000-000000000057', '7a000000-0000-4000-8000-00000000057a', '8a000000-0000-4000-8000-00000000057a', 'g1', 'data_contato', now());

  -- pagamento recebido → outbox, uma vez só
  INSERT INTO financeiro_cobrancas (id, tenant_id, descricao, valor_centavos, status) VALUES
    ('cb000000-0000-4000-8000-00000000057a', 'a1a1a1a1-0000-4000-8000-000000000057', 'Consulta', 25000, 'enviada'),
    ('cb000000-0000-4000-8000-00000000057c', 'a1a1a1a1-0000-4000-8000-000000000057', 'Já nasceu paga', 1000, 'paga');
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'payment.received' AND payload->>'id' = 'cb000000-0000-4000-8000-00000000057a';
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[payment.received]: cobrança não paga gerou evento'; END IF;
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'payment.received' AND payload->>'id' = 'cb000000-0000-4000-8000-00000000057c';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[payment.received]: cobrança criada paga gerou % evento(s)', n; END IF;

  UPDATE financeiro_cobrancas SET status = 'paga', pago_em = now() WHERE id = 'cb000000-0000-4000-8000-00000000057a';
  UPDATE financeiro_cobrancas SET status = 'enviada' WHERE id = 'cb000000-0000-4000-8000-00000000057a';
  UPDATE financeiro_cobrancas SET status = 'paga' WHERE id = 'cb000000-0000-4000-8000-00000000057a';
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'payment.received' AND payload->>'id' = 'cb000000-0000-4000-8000-00000000057a'
    AND (payload->>'valorCentavos')::int = 25000;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[payment.received]: esperava 1 evento, veio %', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000057', true);
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'payment.received' AND payload->>'id' LIKE 'cb000000-0000-4000-8000-00000000057%';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[outbox payment.received]: B viu % evento(s) de A', n; END IF;
  SELECT count(*) INTO n FROM workflow_schedules;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[workflow_schedules]: B esperava 1 agenda própria, veio %', n; END IF;

  RAISE NOTICE 'db/057 isolamento + payment.received: PASS';
END $$;

ROLLBACK;

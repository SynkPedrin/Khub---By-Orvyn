-- =====================================================================
-- Disparos — teste de isolamento cross-tenant (db/061)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/061_broadcasts_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nada é visível (disparos e destinatários);
--   2. A não lê disparo nem destinatário de B;
--   3. A não altera nem apaga disparo/destinatário de B;
--   4. INSERT com tenant_id de B é barrado (WITH CHECK);
--   5. UPDATE que tenta mover um disparo de A para B é barrado.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000061', 'TENANT_A_DISPAROS'),
  ('b2b2b2b2-0000-4000-8000-000000000061', 'TENANT_B_DISPAROS');
INSERT INTO contacts (id, tenant_id, nome, telefone) VALUES
  ('ca000000-0000-4000-8000-00000000061a', 'a1a1a1a1-0000-4000-8000-000000000061', 'Ana A', '5511999990001'),
  ('cb000000-0000-4000-8000-00000000061b', 'b2b2b2b2-0000-4000-8000-000000000061', 'Bia B', '5511999990002');
INSERT INTO broadcasts (id, tenant_id, nome, canal, mensagem) VALUES
  ('da000000-0000-4000-8000-00000000061a', 'a1a1a1a1-0000-4000-8000-000000000061', 'Disparo A', 'whatsapp', 'oi'),
  ('db000000-0000-4000-8000-00000000061b', 'b2b2b2b2-0000-4000-8000-000000000061', 'DISPARO_SECRETO_B', 'whatsapp', 'segredo');
INSERT INTO broadcast_recipients (tenant_id, broadcast_id, contact_id, nome, destino) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000061', 'da000000-0000-4000-8000-00000000061a', 'ca000000-0000-4000-8000-00000000061a', 'Ana A', '5511999990001'),
  ('b2b2b2b2-0000-4000-8000-000000000061', 'db000000-0000-4000-8000-00000000061b', 'cb000000-0000-4000-8000-00000000061b', 'Bia B', '5511999990002');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM broadcasts;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[broadcasts sem tenant]: % linha(s)', n; END IF;
  SELECT count(*) INTO n FROM broadcast_recipients;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[broadcast_recipients sem tenant]: % linha(s)', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000061', true);

  SELECT count(*) INTO n FROM broadcasts WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000061' OR nome = 'DISPARO_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[broadcasts]: A leu % disparo(s) de B', n; END IF;
  SELECT count(*) INTO n FROM broadcasts;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[broadcasts]: esperava 1 disparo de A, veio %', n; END IF;
  SELECT count(*) INTO n FROM broadcast_recipients WHERE broadcast_id = 'db000000-0000-4000-8000-00000000061b' OR nome = 'Bia B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[broadcast_recipients]: A leu % destinatário(s) de B', n; END IF;

  UPDATE broadcasts SET status = 'cancelado' WHERE id = 'db000000-0000-4000-8000-00000000061b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update broadcasts]: A alterou disparo de B'; END IF;
  UPDATE broadcast_recipients SET status = 'enviado' WHERE broadcast_id = 'db000000-0000-4000-8000-00000000061b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update broadcast_recipients]: A alterou destinatário de B'; END IF;
  DELETE FROM broadcasts WHERE id = 'db000000-0000-4000-8000-00000000061b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete broadcasts]: A apagou disparo de B'; END IF;

  BEGIN
    INSERT INTO broadcasts (tenant_id, nome, canal) VALUES ('b2b2b2b2-0000-4000-8000-000000000061', 'FORJADO_EM_B', 'whatsapp');
    RAISE EXCEPTION 'VAZAMENTO[write broadcasts]: A gravou disparo no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO broadcast_recipients (tenant_id, broadcast_id, contact_id) VALUES
      ('b2b2b2b2-0000-4000-8000-000000000061', 'da000000-0000-4000-8000-00000000061a', 'ca000000-0000-4000-8000-00000000061a');
    RAISE EXCEPTION 'VAZAMENTO[write broadcast_recipients]: A gravou destinatário no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    UPDATE broadcasts SET tenant_id = 'b2b2b2b2-0000-4000-8000-000000000061' WHERE id = 'da000000-0000-4000-8000-00000000061a';
    RAISE EXCEPTION 'VAZAMENTO[move broadcasts]: A moveu disparo para B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS 061_broadcasts_isolation_test: 0 vazamentos';
END $$;

ROLLBACK;

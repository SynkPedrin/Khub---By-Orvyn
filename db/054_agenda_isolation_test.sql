-- =====================================================================
-- Agenda — teste de isolamento cross-tenant + outbox (db/054)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/054_agenda_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nenhum compromisso é visível;
--   2. A não lê, não altera e não apaga compromisso de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. compromisso de A apontando para contato de B é barrado (tenant_reference);
--   5. os eventos de outbox nascem no tenant certo e A não vê os de B;
--   6. status novo `faltou` vale e o legado `nao_compareceu` é recusado;
--   7. confirmar/faltar carimba confirmado_em/faltou_em e gera o evento.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000054', 'TENANT_A_AG'),
  ('b2b2b2b2-0000-4000-8000-000000000054', 'TENANT_B_AG');
INSERT INTO contacts (id, tenant_id, nome) VALUES
  ('ca000000-0000-4000-8000-00000000054a', 'a1a1a1a1-0000-4000-8000-000000000054', 'Contato A'),
  ('cb000000-0000-4000-8000-00000000054b', 'b2b2b2b2-0000-4000-8000-000000000054', 'CONTATO_SECRETO_B');
SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000054', true);
INSERT INTO agenda_compromissos (id, tenant_id, contact_id, titulo, inicio, fim) VALUES
  ('ab000000-0000-4000-8000-00000000054b', 'b2b2b2b2-0000-4000-8000-000000000054', 'cb000000-0000-4000-8000-00000000054b',
   'REUNIAO_SECRETA_B', now() + interval '2 days', now() + interval '2 days 1 hour');
SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000054', true);
INSERT INTO agenda_compromissos (id, tenant_id, contact_id, titulo, inicio, fim) VALUES
  ('aa000000-0000-4000-8000-00000000054a', 'a1a1a1a1-0000-4000-8000-000000000054', 'ca000000-0000-4000-8000-00000000054a',
   'Reunião A', now() + interval '1 day', now() + interval '1 day 1 hour');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; ts timestamptz;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM agenda_compromissos;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agenda sem tenant]: % linha(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000054', true);

  SELECT count(*) INTO n FROM agenda_compromissos WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000054' OR titulo = 'REUNIAO_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agenda]: tenant A leu % compromisso(s) de B', n; END IF;
  SELECT count(*) INTO n FROM agenda_compromissos;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[agenda]: esperava 1 compromisso de A, veio %', n; END IF;

  UPDATE agenda_compromissos SET status = 'cancelado' WHERE id = 'ab000000-0000-4000-8000-00000000054b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update agenda]: A alterou compromisso de B'; END IF;

  DELETE FROM agenda_compromissos WHERE id = 'ab000000-0000-4000-8000-00000000054b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete agenda]: A apagou compromisso de B'; END IF;

  BEGIN
    INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim)
      VALUES ('b2b2b2b2-0000-4000-8000-000000000054', 'FORJADO_EM_B', now(), now() + interval '1 hour');
    RAISE EXCEPTION 'VAZAMENTO[write agenda]: A gravou compromisso no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO agenda_compromissos (tenant_id, contact_id, titulo, inicio, fim)
      VALUES ('a1a1a1a1-0000-4000-8000-000000000054', 'cb000000-0000-4000-8000-00000000054b', 'Ref cruzada', now(), now() + interval '1 hour');
    RAISE EXCEPTION 'VAZAMENTO[ref agenda]: A apontou compromisso para contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- outbox: A vê só o seu appointment.created
  SELECT count(*) INTO n FROM outbox_events WHERE kind LIKE 'appointment.%';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[outbox agenda]: esperava 1 evento de A, veio %', n; END IF;
  SELECT count(*) INTO n FROM outbox_events WHERE payload->>'id' = 'ab000000-0000-4000-8000-00000000054b';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[outbox agenda]: A viu evento de B'; END IF;

  -- status legado recusado; novo aceito, com carimbo e evento
  BEGIN
    UPDATE agenda_compromissos SET status = 'nao_compareceu' WHERE id = 'aa000000-0000-4000-8000-00000000054a';
    RAISE EXCEPTION 'FALHA[status agenda]: nao_compareceu ainda aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  UPDATE agenda_compromissos SET status = 'confirmado' WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  SELECT confirmado_em INTO ts FROM agenda_compromissos WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  IF ts IS NULL THEN RAISE EXCEPTION 'FALHA[agenda]: confirmado_em não carimbado'; END IF;
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'appointment.confirmed';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[outbox agenda]: appointment.confirmed não gerado'; END IF;

  UPDATE agenda_compromissos SET status = 'faltou' WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  SELECT faltou_em INTO ts FROM agenda_compromissos WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  IF ts IS NULL THEN RAISE EXCEPTION 'FALHA[agenda]: faltou_em não carimbado'; END IF;
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'appointment.no_show';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[outbox agenda]: appointment.no_show não gerado'; END IF;

  -- lembrete: marcar gera reminder_due uma vez; reagendar zera o lembrete
  UPDATE agenda_compromissos SET lembrete_enviado_em = now() WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  SELECT count(*) INTO n FROM outbox_events WHERE kind = 'appointment.reminder_due';
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[outbox agenda]: appointment.reminder_due não gerado'; END IF;
  UPDATE agenda_compromissos SET inicio = inicio + interval '1 day', fim = fim + interval '1 day' WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  SELECT lembrete_enviado_em INTO ts FROM agenda_compromissos WHERE id = 'aa000000-0000-4000-8000-00000000054a';
  IF ts IS NOT NULL THEN RAISE EXCEPTION 'FALHA[agenda]: reagendar não zerou lembrete_enviado_em'; END IF;

  RAISE NOTICE 'OK agenda_compromissos: leitura, update, delete, insert, referência e outbox isolados';
END $$;

ROLLBACK;

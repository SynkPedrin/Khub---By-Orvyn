-- =====================================================================
-- Agendamento público — teste de isolamento cross-tenant (db/060)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/060_booking_pages_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão, nenhuma página/reserva é visível;
--   2. A não lê, não altera e não apaga página nem reserva de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. reserva de A apontando para compromisso/contato de B é barrada;
--   5. responsável que não é membro do tenant é recusado (fila de distribuição);
--   6. as funções públicas resolvem o dono certo (slug ativo e hash do token).
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000060', 'TENANT_A_BK'),
  ('b2b2b2b2-0000-4000-8000-000000000060', 'TENANT_B_BK');
INSERT INTO identities (id, email) VALUES
  ('1da00000-0000-4000-8000-00000000060a', 'membro-a-060@teste.khub'),
  ('1db00000-0000-4000-8000-00000000060b', 'membro-b-060@teste.khub');
INSERT INTO memberships (identity_id, tenant_id, role) VALUES
  ('1da00000-0000-4000-8000-00000000060a', 'a1a1a1a1-0000-4000-8000-000000000060', 'member'),
  ('1db00000-0000-4000-8000-00000000060b', 'b2b2b2b2-0000-4000-8000-000000000060', 'member');
INSERT INTO contacts (id, tenant_id, nome) VALUES
  ('ca000000-0000-4000-8000-00000000060a', 'a1a1a1a1-0000-4000-8000-000000000060', 'Contato A'),
  ('cb000000-0000-4000-8000-00000000060b', 'b2b2b2b2-0000-4000-8000-000000000060', 'CONTATO_SECRETO_B');
SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000060', true);
INSERT INTO booking_pages (id, tenant_id, slug, titulo, responsaveis) VALUES
  ('bb000000-0000-4000-8000-00000000060b', 'b2b2b2b2-0000-4000-8000-000000000060', 'pagina-secreta-b-060', 'PAGINA_SECRETA_B', ARRAY['1db00000-0000-4000-8000-00000000060b']::uuid[]);
INSERT INTO agenda_compromissos (id, tenant_id, contact_id, titulo, inicio, fim) VALUES
  ('ab000000-0000-4000-8000-00000000060b', 'b2b2b2b2-0000-4000-8000-000000000060', 'cb000000-0000-4000-8000-00000000060b',
   'REUNIAO_SECRETA_B', now() + interval '2 days', now() + interval '2 days 1 hour');
INSERT INTO booking_reservas (id, tenant_id, booking_page_id, compromisso_id, contact_id, token_hash) VALUES
  ('eeb00000-0000-4000-8000-00000000060b', 'b2b2b2b2-0000-4000-8000-000000000060', 'bb000000-0000-4000-8000-00000000060b',
   'ab000000-0000-4000-8000-00000000060b', 'cb000000-0000-4000-8000-00000000060b', repeat('b', 64));
SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000060', true);
INSERT INTO booking_pages (id, tenant_id, slug, titulo) VALUES
  ('ba000000-0000-4000-8000-00000000060a', 'a1a1a1a1-0000-4000-8000-000000000060', 'pagina-a-060', 'Página A');
INSERT INTO agenda_compromissos (id, tenant_id, contact_id, titulo, inicio, fim) VALUES
  ('aa000000-0000-4000-8000-00000000060a', 'a1a1a1a1-0000-4000-8000-000000000060', 'ca000000-0000-4000-8000-00000000060a',
   'Reunião A', now() + interval '1 day', now() + interval '1 day 1 hour');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t uuid;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM booking_pages;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[booking_pages sem tenant]: % linha(s)', n; END IF;
  SELECT count(*) INTO n FROM booking_reservas;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[booking_reservas sem tenant]: % linha(s)', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000060', true);
  SELECT count(*) INTO n FROM booking_pages WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000060' OR titulo = 'PAGINA_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[booking_pages]: A leu % página(s) de B', n; END IF;
  SELECT count(*) INTO n FROM booking_reservas;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[booking_reservas]: A leu % reserva(s) de B', n; END IF;

  UPDATE booking_pages SET titulo = 'HACK' WHERE id = 'bb000000-0000-4000-8000-00000000060b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update booking_pages]: A alterou página de B'; END IF;
  DELETE FROM booking_pages WHERE id = 'bb000000-0000-4000-8000-00000000060b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete booking_pages]: A apagou página de B'; END IF;

  BEGIN
    INSERT INTO booking_pages (tenant_id, slug, titulo) VALUES ('b2b2b2b2-0000-4000-8000-000000000060', 'forjada-em-b-060', 'FORJADA');
    RAISE EXCEPTION 'VAZAMENTO[write booking_pages]: A gravou página no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO booking_reservas (tenant_id, booking_page_id, compromisso_id, token_hash) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000060', 'ba000000-0000-4000-8000-00000000060a', 'ab000000-0000-4000-8000-00000000060b', repeat('c', 64));
    RAISE EXCEPTION 'VAZAMENTO[ref booking_reservas]: reserva de A apontou para compromisso de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO booking_reservas (tenant_id, booking_page_id, compromisso_id, contact_id, token_hash) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000060', 'ba000000-0000-4000-8000-00000000060a', 'aa000000-0000-4000-8000-00000000060a',
       'cb000000-0000-4000-8000-00000000060b', repeat('d', 64));
    RAISE EXCEPTION 'VAZAMENTO[ref booking_reservas]: reserva de A apontou para contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    UPDATE booking_pages SET responsaveis = ARRAY['1db00000-0000-4000-8000-00000000060b']::uuid[] WHERE id = 'ba000000-0000-4000-8000-00000000060a';
    RAISE EXCEPTION 'VAZAMENTO[responsaveis]: página de A recebeu membro de B na fila';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  UPDATE booking_pages SET responsaveis = ARRAY['1da00000-0000-4000-8000-00000000060a']::uuid[] WHERE id = 'ba000000-0000-4000-8000-00000000060a';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[responsaveis]: membro de A foi recusado'; END IF;

  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT tenant_id INTO t FROM resolve_booking_page_by_slug('pagina-secreta-b-060');
  IF t IS DISTINCT FROM 'b2b2b2b2-0000-4000-8000-000000000060'::uuid THEN RAISE EXCEPTION 'FALHA[resolve slug]: veio %', t; END IF;
  SELECT tenant_id INTO t FROM resolve_booking_reserva_by_token(repeat('b', 64));
  IF t IS DISTINCT FROM 'b2b2b2b2-0000-4000-8000-000000000060'::uuid THEN RAISE EXCEPTION 'FALHA[resolve token]: veio %', t; END IF;
  SELECT count(*) INTO n FROM resolve_booking_reserva_by_token(repeat('e', 64));
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[resolve token]: hash inexistente resolveu'; END IF;
  SELECT count(*) INTO n FROM booking_reservas;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[booking_reservas após resolve]: % linha(s)', n; END IF;

  RAISE NOTICE 'PASS 060 booking: isolamento, referências, responsáveis e resolução pública OK';
END $$;

ROLLBACK;

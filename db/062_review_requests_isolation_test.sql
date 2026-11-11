-- =====================================================================
-- Avaliações — teste de isolamento cross-tenant (db/062)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/062_review_requests_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão, nada é visível;
--   2. A não lê configuração nem pedido de B; não altera nem apaga;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. a função pública de roteamento devolve SÓ (tenant, pedido) do token
--      dado, e token desconhecido não devolve nada.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000062', 'TENANT_A_AVALIACOES'),
  ('b2b2b2b2-0000-4000-8000-000000000062', 'TENANT_B_AVALIACOES');
INSERT INTO contacts (id, tenant_id, nome, telefone) VALUES
  ('ca000000-0000-4000-8000-00000000062a', 'a1a1a1a1-0000-4000-8000-000000000062', 'Ana A', '5511999990001'),
  ('cb000000-0000-4000-8000-00000000062b', 'b2b2b2b2-0000-4000-8000-000000000062', 'Bia B', '5511999990002');
INSERT INTO review_settings (tenant_id, link, mensagem_padrao) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000062', 'https://g.page/a', 'Avalie A'),
  ('b2b2b2b2-0000-4000-8000-000000000062', 'https://g.page/segredo-b', 'SEGREDO_B');
INSERT INTO review_requests (id, tenant_id, contact_id, canal, link, token) VALUES
  ('ea000000-0000-4000-8000-00000000062a', 'a1a1a1a1-0000-4000-8000-000000000062', 'ca000000-0000-4000-8000-00000000062a', 'whatsapp', 'https://g.page/a', 'tokenAAAAAAAAAAAAAAAAA'),
  ('eb000000-0000-4000-8000-00000000062b', 'b2b2b2b2-0000-4000-8000-000000000062', 'cb000000-0000-4000-8000-00000000062b', 'whatsapp', 'https://g.page/segredo-b', 'tokenBBBBBBBBBBBBBBBBB');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t UUID; r UUID;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM review_requests;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[review_requests sem tenant]: % linha(s)', n; END IF;
  SELECT count(*) INTO n FROM review_settings;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[review_settings sem tenant]: % linha(s)', n; END IF;

  -- Roteamento público: só o par do token pedido.
  SELECT tenant_id, review_request_id INTO t, r FROM resolve_review_request_by_token('tokenBBBBBBBBBBBBBBBBB');
  IF t IS DISTINCT FROM 'b2b2b2b2-0000-4000-8000-000000000062'::uuid OR r IS DISTINCT FROM 'eb000000-0000-4000-8000-00000000062b'::uuid THEN
    RAISE EXCEPTION 'FALHA[resolve_review_request_by_token]: roteou errado';
  END IF;
  SELECT count(*) INTO n FROM resolve_review_request_by_token('naoexiste000000000000');
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[resolve_review_request_by_token]: token inexistente devolveu linha'; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000062', true);

  SELECT count(*) INTO n FROM review_settings WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000062' OR mensagem_padrao = 'SEGREDO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[review_settings]: A leu configuração de B'; END IF;
  SELECT count(*) INTO n FROM review_requests WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000062' OR token = 'tokenBBBBBBBBBBBBBBBBB';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[review_requests]: A leu % pedido(s) de B', n; END IF;
  SELECT count(*) INTO n FROM review_requests;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[review_requests]: esperava 1 pedido de A, veio %', n; END IF;

  UPDATE review_requests SET avaliacao_interna = 1 WHERE id = 'eb000000-0000-4000-8000-00000000062b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update review_requests]: A alterou pedido de B'; END IF;
  UPDATE review_settings SET link = 'https://forjado.example' WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000062';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update review_settings]: A alterou configuração de B'; END IF;
  DELETE FROM review_requests WHERE id = 'eb000000-0000-4000-8000-00000000062b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete review_requests]: A apagou pedido de B'; END IF;

  BEGIN
    INSERT INTO review_requests (tenant_id, contact_id, canal, link, token) VALUES
      ('b2b2b2b2-0000-4000-8000-000000000062', 'ca000000-0000-4000-8000-00000000062a', 'whatsapp', 'https://x.example', 'forjadoCCCCCCCCCCCCCC');
    RAISE EXCEPTION 'VAZAMENTO[write review_requests]: A gravou pedido no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO review_settings (tenant_id, link, mensagem_padrao) VALUES ('b2b2b2b2-0000-4000-8000-000000000062', 'https://x.example', 'x')
      ON CONFLICT (tenant_id) DO UPDATE SET link = EXCLUDED.link;
    RAISE EXCEPTION 'VAZAMENTO[write review_settings]: A gravou configuração no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS 062_review_requests_isolation_test: 0 vazamentos';
END $$;

ROLLBACK;

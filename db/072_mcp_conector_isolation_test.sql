-- =====================================================================
-- Conector MCP (db/072): teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/072_mcp_conector_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão nenhuma conexão/token aparece;
--   2. A não lê, não altera e não apaga conexões/tokens de B;
--   3. A não grava conexão com tenant de B (WITH CHECK) nem token de A
--      pendurado em conexão de B (gatilho);
--   4. o código de autorização é de uso único (segunda troca não devolve nada);
--   5. conexão revogada não autentica mais (acesso nem renovação);
--   6. token vencido não autentica.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000072', 'TENANT_A_MCP'),
  ('b2b2b2b2-0000-4000-8000-000000000072', 'TENANT_B_MCP');
INSERT INTO mcp_clientes (id, client_id, nome, redirect_uris) VALUES
  ('c0000000-0000-4000-8000-000000000072', 'cli_teste_072', 'Cliente de teste', ARRAY['https://exemplo.test/cb']);

SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000072', true);
INSERT INTO mcp_conexoes (id, tenant_id, identity_id, cliente_id, nome_cliente) VALUES
  ('1b000000-0000-4000-8000-00000000072b', 'b2b2b2b2-0000-4000-8000-000000000072', 'bbbbbbbb-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072', 'CONEXAO_SECRETA_B');
INSERT INTO mcp_tokens (tenant_id, conexao_id, tipo, hash, expira_em) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000072', '1b000000-0000-4000-8000-00000000072b', 'acesso', 'HASH_ACESSO_B', now() + interval '1 hour');

SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000072', true);
INSERT INTO mcp_conexoes (id, tenant_id, identity_id, cliente_id, nome_cliente) VALUES
  ('1a000000-0000-4000-8000-00000000072a', 'a1a1a1a1-0000-4000-8000-000000000072', 'aaaaaaaa-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072', 'Claude da A');
INSERT INTO mcp_tokens (tenant_id, conexao_id, tipo, hash, code_challenge, redirect_uri, expira_em) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000072', '1a000000-0000-4000-8000-00000000072a', 'codigo', 'HASH_CODIGO_A', 'desafio', 'https://exemplo.test/cb', now() + interval '5 minutes'),
  ('a1a1a1a1-0000-4000-8000-000000000072', '1a000000-0000-4000-8000-00000000072a', 'acesso', 'HASH_ACESSO_A', NULL, NULL, now() + interval '1 hour'),
  ('a1a1a1a1-0000-4000-8000-000000000072', '1a000000-0000-4000-8000-00000000072a', 'acesso', 'HASH_ACESSO_VENCIDO', NULL, NULL, now() - interval '1 minute'),
  ('a1a1a1a1-0000-4000-8000-000000000072', '1a000000-0000-4000-8000-00000000072a', 'renovacao', 'HASH_RENOVACAO_A', NULL, NULL, now() + interval '60 days');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t TEXT;
  ta CONSTANT uuid := 'a1a1a1a1-0000-4000-8000-000000000072';
  tb CONSTANT uuid := 'b2b2b2b2-0000-4000-8000-000000000072';
BEGIN
  -- (1) Sem tenant: nada.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT (SELECT count(*) FROM mcp_conexoes) + (SELECT count(*) FROM mcp_tokens) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[mcp sem tenant]: % linha(s)', n; END IF;

  -- (2) A não lê/altera/apaga nada de B.
  PERFORM set_config('app.current_tenant_id', ta::text, true);
  FOREACH t IN ARRAY ARRAY['mcp_conexoes','mcp_tokens'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', t, tb) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: A leu % linha(s) de B', t, n; END IF;
    EXECUTE format('UPDATE %I SET tenant_id = tenant_id WHERE tenant_id = %L', t, tb);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update %]: A alterou linha de B', t; END IF;
    EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', t, tb);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete %]: A apagou linha de B', t; END IF;
  END LOOP;

  -- (3a) WITH CHECK: A não cria conexão no tenant de B.
  BEGIN
    INSERT INTO mcp_conexoes (tenant_id, identity_id, cliente_id, nome_cliente)
      VALUES (tb, 'aaaaaaaa-0000-4000-8000-000000000072', 'c0000000-0000-4000-8000-000000000072', 'INVASAO');
    RAISE EXCEPTION 'VAZAMENTO[with check]: A criou conexão em B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  -- (3b) Gatilho: token de A não pendura em conexão de B.
  BEGIN
    INSERT INTO mcp_tokens (tenant_id, conexao_id, tipo, hash, expira_em)
      VALUES (ta, '1b000000-0000-4000-8000-00000000072b', 'acesso', 'HASH_INVASAO', now() + interval '1 hour');
    RAISE EXCEPTION 'VAZAMENTO[referencia]: token de A na conexão de B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- (4) Código de uso único.
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_CODIGO_A', 'codigo');
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[codigo]: primeira troca devolveu % linha(s)', n; END IF;
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_CODIGO_A', 'codigo');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[codigo]: código reutilizado'; END IF;
  -- tipo errado não autentica (código não vale como acesso)
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_RENOVACAO_A', 'acesso');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[tipo]: renovação aceita como acesso'; END IF;

  -- (6) Vencido não autentica.
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_ACESSO_VENCIDO', 'acesso');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[vencido]: token vencido autenticou'; END IF;

  -- (5) Revogada não autentica.
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_ACESSO_A', 'acesso');
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[acesso]: token válido recusado'; END IF;
  UPDATE mcp_conexoes SET revogada_em = now() WHERE id = '1a000000-0000-4000-8000-00000000072a';
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_ACESSO_A', 'acesso');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[revogada]: conexão revogada autenticou'; END IF;
  SELECT count(*) INTO n FROM mcp_resolver_token('HASH_RENOVACAO_A', 'renovacao');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[revogada]: renovação de conexão revogada'; END IF;

  RAISE NOTICE '072 OK — conector MCP isolado por tenant; código uso único; revogação e validade respeitadas.';
END $$;

ROLLBACK;

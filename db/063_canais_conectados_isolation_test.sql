-- =====================================================================
-- Canais conectados (db/063) — teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/063_canais_conectados_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nenhuma conexão é visível;
--   2. A não lê, não altera e não apaga a conexão de B (nem o token cifrado);
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. conversa de A apontando para conexão de B é barrada (tenant_reference_canal);
--   5. resolve_tenant_by_canal devolve SÓ o id do dono e ignora conexão desconectada;
--   6. a mesma conta de rede não pode ser conectada por dois tenants (UNIQUE).
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000063', 'TENANT_A_CANAIS'),
  ('b2b2b2b2-0000-4000-8000-000000000063', 'TENANT_B_CANAIS');
INSERT INTO channel_connections (id, tenant_id, rede, external_id, page_id, nome, credentials_encrypted) VALUES
  ('5a000000-0000-4000-8000-00000000063a', 'a1a1a1a1-0000-4000-8000-000000000063', 'instagram', 'IG_A_063', 'PAGE_A_063', 'Conta A', 'cifrado-A'),
  ('5b000000-0000-4000-8000-00000000063b', 'b2b2b2b2-0000-4000-8000-000000000063', 'instagram', 'IG_B_063', 'PAGE_B_063', 'CONTA_SECRETA_B', 'TOKEN_CIFRADO_B'),
  ('5c000000-0000-4000-8000-00000000063c', 'b2b2b2b2-0000-4000-8000-000000000063', 'youtube', 'YT_B_OFF_063', NULL, 'Canal B desligado', NULL);
UPDATE channel_connections SET status = 'desconectado' WHERE id = '5c000000-0000-4000-8000-00000000063c';
INSERT INTO conversations (id, tenant_id, nome, canal, tipo, externo_id, canal_conexao_id) VALUES
  ('7a000000-0000-4000-8000-00000000063a', 'a1a1a1a1-0000-4000-8000-000000000063', 'DM A', 'Instagram', 'dm', 'IGSID_A', '5a000000-0000-4000-8000-00000000063a');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t UUID;
BEGIN
  -- 1. sem tenant na sessão: nada aparece
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM channel_connections;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[channel_connections sem tenant]: % linha(s) visíveis', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000063', true);

  -- 2. leitura, update e delete de B
  SELECT count(*) INTO n FROM channel_connections WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000063';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[channel_connections]: A leu % conexão(ões) de B', n; END IF;
  SELECT count(*) INTO n FROM channel_connections WHERE credentials_encrypted = 'TOKEN_CIFRADO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[channel_connections]: A viu o token cifrado de B'; END IF;
  SELECT count(*) INTO n FROM channel_connections;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[channel_connections]: esperava 1 conexão de A, veio %', n; END IF;

  UPDATE channel_connections SET status = 'erro' WHERE id = '5b000000-0000-4000-8000-00000000063b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update channel_connections]: A alterou conexão de B'; END IF;
  DELETE FROM channel_connections WHERE id = '5b000000-0000-4000-8000-00000000063b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete channel_connections]: A apagou conexão de B'; END IF;

  -- 3. INSERT com tenant de B
  BEGIN
    INSERT INTO channel_connections (tenant_id, rede, external_id) VALUES ('b2b2b2b2-0000-4000-8000-000000000063', 'messenger', 'PAGE_X_063');
    RAISE EXCEPTION 'VAZAMENTO[insert channel_connections]: A gravou conexão em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- 4. conversa de A apontando para conexão de B
  BEGIN
    INSERT INTO conversations (tenant_id, nome, canal, canal_conexao_id)
      VALUES ('a1a1a1a1-0000-4000-8000-000000000063', 'X', 'Instagram', '5b000000-0000-4000-8000-00000000063b');
    RAISE EXCEPTION 'VAZAMENTO[conversations.canal_conexao_id]: conversa de A ligada à conexão de B';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'VAZAMENTO%' THEN RAISE; END IF;
  END;

  -- 5. roteamento: só o id, só conectadas
  t := resolve_tenant_by_canal('instagram', 'IG_B_063');
  IF t IS DISTINCT FROM 'b2b2b2b2-0000-4000-8000-000000000063'::uuid THEN RAISE EXCEPTION 'FALHA[resolve]: esperava B, veio %', t; END IF;
  t := resolve_tenant_by_canal('youtube', 'YT_B_OFF_063');
  IF t IS NOT NULL THEN RAISE EXCEPTION 'FALHA[resolve]: conexão desconectada ainda roteia'; END IF;
  t := resolve_tenant_by_canal('messenger', 'IG_B_063');
  IF t IS NOT NULL THEN RAISE EXCEPTION 'FALHA[resolve]: rede errada roteou'; END IF;
  -- a função não abre o RLS para a sessão
  SELECT count(*) INTO n FROM channel_connections WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000063';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[resolve]: depois do roteamento A passou a ver B'; END IF;
END $$;

-- 6. mesma conta de rede em dois tenants
SET LOCAL ROLE khub_service;
DO $$ BEGIN
  INSERT INTO channel_connections (tenant_id, rede, external_id) VALUES ('a1a1a1a1-0000-4000-8000-000000000063', 'instagram', 'IG_B_063');
  RAISE EXCEPTION 'FALHA[unique]: a conta de B foi conectada também em A';
EXCEPTION WHEN unique_violation THEN NULL;
END $$;

\echo '063 canais conectados: isolamento PASS'
ROLLBACK;

-- =====================================================================
-- Inbox (respostas rápidas, notas internas, notificações) — teste de
-- isolamento cross-tenant (db/055)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/055_inbox_atendimento_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A, para quick_replies,
-- conversation_notes e notifications:
--   1. sem tenant na sessão, nada é visível;
--   2. A não lê, não altera e não apaga linha de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. nota de A apontando para conversa de B é barrada (tenant_reference).
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000055', 'TENANT_A_INBOX'),
  ('b2b2b2b2-0000-4000-8000-000000000055', 'TENANT_B_INBOX');
INSERT INTO identities (id, email) VALUES
  ('1a000000-0000-4000-8000-00000000055a', 'a-inbox-055@teste.invalid'),
  ('1b000000-0000-4000-8000-00000000055b', 'b-inbox-055@teste.invalid');
INSERT INTO conversations (id, tenant_id, nome) VALUES
  ('7a000000-0000-4000-8000-00000000055a', 'a1a1a1a1-0000-4000-8000-000000000055', 'Conversa A'),
  ('7b000000-0000-4000-8000-00000000055b', 'b2b2b2b2-0000-4000-8000-000000000055', 'CONVERSA_SECRETA_B');
INSERT INTO quick_replies (id, tenant_id, atalho, titulo, corpo) VALUES
  ('8a000000-0000-4000-8000-00000000055a', 'a1a1a1a1-0000-4000-8000-000000000055', 'ola', 'Olá A', 'Oi {{contato.nome}}'),
  ('8b000000-0000-4000-8000-00000000055b', 'b2b2b2b2-0000-4000-8000-000000000055', 'ola', 'RESPOSTA_SECRETA_B', 'segredo de B');
INSERT INTO conversation_notes (id, tenant_id, conversation_id, autor_id, corpo) VALUES
  ('9a000000-0000-4000-8000-00000000055a', 'a1a1a1a1-0000-4000-8000-000000000055', '7a000000-0000-4000-8000-00000000055a', '1a000000-0000-4000-8000-00000000055a', 'nota A'),
  ('9b000000-0000-4000-8000-00000000055b', 'b2b2b2b2-0000-4000-8000-000000000055', '7b000000-0000-4000-8000-00000000055b', '1b000000-0000-4000-8000-00000000055b', 'NOTA_SECRETA_B');
INSERT INTO notifications (id, tenant_id, identity_id, tipo, titulo, url) VALUES
  ('6a000000-0000-4000-8000-00000000055a', 'a1a1a1a1-0000-4000-8000-000000000055', '1a000000-0000-4000-8000-00000000055a', 'mencao', 'Menção A', '/inbox?c=7a000000-0000-4000-8000-00000000055a'),
  ('6b000000-0000-4000-8000-00000000055b', 'b2b2b2b2-0000-4000-8000-000000000055', '1b000000-0000-4000-8000-00000000055b', 'mencao', 'NOTIF_SECRETA_B', '/inbox?c=7b000000-0000-4000-8000-00000000055b');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; tabela TEXT; id_b UUID;
BEGIN
  -- 1. sem tenant na sessão: nada aparece
  PERFORM set_config('app.current_tenant_id', '', true);
  FOREACH tabela IN ARRAY ARRAY['quick_replies', 'conversation_notes', 'notifications'] LOOP
    EXECUTE format('SELECT count(*) FROM %I', tabela) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[% sem tenant]: % linha(s) visíveis', tabela, n; END IF;
  END LOOP;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000055', true);

  -- 2. leitura, update e delete de B
  FOREACH tabela IN ARRAY ARRAY['quick_replies', 'conversation_notes', 'notifications'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', tabela, 'b2b2b2b2-0000-4000-8000-000000000055') INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: tenant A leu % linha(s) de B', tabela, n; END IF;
    EXECUTE format('SELECT count(*) FROM %I', tabela) INTO n;
    IF n <> 1 THEN RAISE EXCEPTION 'FALHA[%]: esperava 1 linha de A, veio %', tabela, n; END IF;
  END LOOP;

  UPDATE quick_replies SET titulo = 'ALTERADA' WHERE id = '8b000000-0000-4000-8000-00000000055b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update quick_replies]: A alterou resposta de B'; END IF;
  UPDATE conversation_notes SET corpo = 'ALTERADA' WHERE id = '9b000000-0000-4000-8000-00000000055b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update conversation_notes]: A alterou nota de B'; END IF;
  UPDATE notifications SET lida_em = now() WHERE id = '6b000000-0000-4000-8000-00000000055b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update notifications]: A marcou notificação de B'; END IF;

  DELETE FROM quick_replies WHERE id = '8b000000-0000-4000-8000-00000000055b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete quick_replies]: A apagou resposta de B'; END IF;
  DELETE FROM conversation_notes WHERE id = '9b000000-0000-4000-8000-00000000055b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete conversation_notes]: A apagou nota de B'; END IF;
  DELETE FROM notifications WHERE id = '6b000000-0000-4000-8000-00000000055b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete notifications]: A apagou notificação de B'; END IF;

  -- 3. escrita forjada no tenant B
  BEGIN
    INSERT INTO quick_replies (tenant_id, atalho, titulo, corpo) VALUES ('b2b2b2b2-0000-4000-8000-000000000055', 'forjada', 'FORJADA', 'x');
    RAISE EXCEPTION 'VAZAMENTO[write quick_replies]: A gravou no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO conversation_notes (tenant_id, conversation_id, corpo) VALUES ('b2b2b2b2-0000-4000-8000-000000000055', '7b000000-0000-4000-8000-00000000055b', 'FORJADA');
    RAISE EXCEPTION 'VAZAMENTO[write conversation_notes]: A gravou no tenant B';
  -- tenant_reference roda antes do WITH CHECK e já recusa (a conversa de B é invisível a A).
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO notifications (tenant_id, identity_id, tipo, titulo, url) VALUES ('b2b2b2b2-0000-4000-8000-000000000055', '1b000000-0000-4000-8000-00000000055b', 'mencao', 'FORJADA', '/inbox');
    RAISE EXCEPTION 'VAZAMENTO[write notifications]: A gravou no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- 4. nota de A pendurada em conversa de B
  BEGIN
    INSERT INTO conversation_notes (tenant_id, conversation_id, corpo) VALUES ('a1a1a1a1-0000-4000-8000-000000000055', '7b000000-0000-4000-8000-00000000055b', 'APONTA_CONVERSA_B');
    RAISE EXCEPTION 'VAZAMENTO[ref conversation_notes→conversations]: A referenciou conversa de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS: isolamento de quick_replies, conversation_notes e notifications (db/055)';
END $$;

ROLLBACK;

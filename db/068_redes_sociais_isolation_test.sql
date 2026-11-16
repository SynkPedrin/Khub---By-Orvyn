-- =====================================================================
-- Redes sociais (db/068): teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/068_redes_sociais_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS) no tenant A:
--   1. sem tenant na sessão, nenhuma publicação/foto é visível;
--   2. A não lê, não altera e não apaga publicação/foto de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. publicação/foto de A apontando para conexão de B é barrada (tenant_reference);
--   5. as funções do worker devolvem SÓ (tenant_id, id), nunca conteúdo;
--   6. a mesma conta não tem duas fotos no mesmo dia (UNIQUE).
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000068', 'TENANT_A_REDES'),
  ('b2b2b2b2-0000-4000-8000-000000000068', 'TENANT_B_REDES');
INSERT INTO channel_connections (id, tenant_id, rede, external_id, nome, credentials_encrypted) VALUES
  ('5a000000-0000-4000-8000-00000000068a', 'a1a1a1a1-0000-4000-8000-000000000068', 'tiktok', 'TT_A_068', 'Conta A', 'cifrado-A'),
  ('5b000000-0000-4000-8000-00000000068b', 'b2b2b2b2-0000-4000-8000-000000000068', 'tiktok', 'TT_B_068', 'CONTA_SECRETA_B', 'TOKEN_CIFRADO_B');
INSERT INTO redes_publicacoes (id, tenant_id, conexao_id, rede, formato, legenda, midia_url, agendado_para, confirmado_em) VALUES
  ('6a000000-0000-4000-8000-00000000068a', 'a1a1a1a1-0000-4000-8000-000000000068', '5a000000-0000-4000-8000-00000000068a', 'tiktok', 'video', 'post A', 'https://a.example/v.mp4', now() - interval '1 minute', now()),
  ('6b000000-0000-4000-8000-00000000068b', 'b2b2b2b2-0000-4000-8000-000000000068', '5b000000-0000-4000-8000-00000000068b', 'tiktok', 'video', 'LEGENDA_SECRETA_B', 'https://b.example/v.mp4', now() - interval '1 minute', now());
INSERT INTO redes_snapshots (id, tenant_id, conexao_id, rede, dia, seguidores) VALUES
  ('7a000000-0000-4000-8000-00000000068a', 'a1a1a1a1-0000-4000-8000-000000000068', '5a000000-0000-4000-8000-00000000068a', 'tiktok', current_date - 1, 100),
  ('7b000000-0000-4000-8000-00000000068b', 'b2b2b2b2-0000-4000-8000-000000000068', '5b000000-0000-4000-8000-00000000068b', 'tiktok', current_date - 1, 999);

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t TEXT; r RECORD;
BEGIN
  -- 1. sem tenant na sessão: nada aparece
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT (SELECT count(*) FROM redes_publicacoes) + (SELECT count(*) FROM redes_snapshots) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[redes sem tenant]: % linha(s) visíveis', n; END IF;

  -- 2. A não lê, não altera e não apaga B
  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000068', true);
  FOREACH t IN ARRAY ARRAY['redes_publicacoes', 'redes_snapshots'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000068') INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: A leu % linha(s) de B', t, n; END IF;
    EXECUTE format('SELECT count(*) FROM %I', t) INTO n;
    IF n <> 1 THEN RAISE EXCEPTION 'FALHA[%]: A deveria ver só a própria linha, viu %', t, n; END IF;
    EXECUTE format('UPDATE %I SET updated_at = now() WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000068');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update %]', t; END IF;
    EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000068');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete %]', t; END IF;
  END LOOP;

  -- 3. A não grava com tenant de B
  BEGIN
    INSERT INTO redes_publicacoes (tenant_id, conexao_id, rede, formato, midia_url, agendado_para, confirmado_em)
    VALUES ('b2b2b2b2-0000-4000-8000-000000000068', '5b000000-0000-4000-8000-00000000068b', 'tiktok', 'video', 'https://x.example/v.mp4', now(), now());
    RAISE EXCEPTION 'VAZAMENTO[write redes_publicacoes]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO redes_snapshots (tenant_id, conexao_id, rede, dia) VALUES ('b2b2b2b2-0000-4000-8000-000000000068', '5b000000-0000-4000-8000-00000000068b', 'tiktok', current_date);
    RAISE EXCEPTION 'VAZAMENTO[write redes_snapshots]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR foreign_key_violation THEN NULL;
  END;

  -- 4. Linha de A apontando para conexão de B
  BEGIN
    INSERT INTO redes_publicacoes (tenant_id, conexao_id, rede, formato, midia_url, agendado_para, confirmado_em)
    VALUES ('a1a1a1a1-0000-4000-8000-000000000068', '5b000000-0000-4000-8000-00000000068b', 'tiktok', 'video', 'https://x.example/v.mp4', now(), now());
    RAISE EXCEPTION 'VAZAMENTO[ref redes_publicacoes→channel_connections]: A apontou para conexão de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO redes_snapshots (tenant_id, conexao_id, rede, dia) VALUES ('a1a1a1a1-0000-4000-8000-000000000068', '5b000000-0000-4000-8000-00000000068b', 'tiktok', current_date);
    RAISE EXCEPTION 'VAZAMENTO[ref redes_snapshots→channel_connections]: A apontou para conexão de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE redes_publicacoes SET conexao_id = '5b000000-0000-4000-8000-00000000068b' WHERE id = '6a000000-0000-4000-8000-00000000068a';
    RAISE EXCEPTION 'VAZAMENTO[update ref redes_publicacoes]: A trocou a conexão para a de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- 6. uma foto por conta por dia
  BEGIN
    INSERT INTO redes_snapshots (tenant_id, conexao_id, rede, dia) VALUES ('a1a1a1a1-0000-4000-8000-000000000068', '5a000000-0000-4000-8000-00000000068a', 'tiktok', current_date - 1);
    RAISE EXCEPTION 'FALHA[redes_snapshots]: duas fotos no mesmo dia';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  RAISE NOTICE 'OK redes: publicações e fotos isoladas';
END $$;

-- 5. Funções do worker: só (tenant_id, id); acham trabalho dos dois tenants
--    sem expor legenda/URL (a assinatura não tem essas colunas).
DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM redes_publicacoes_pendentes(50)
   WHERE id IN ('6a000000-0000-4000-8000-00000000068a', '6b000000-0000-4000-8000-00000000068b');
  IF n <> 2 THEN RAISE EXCEPTION 'FALHA[redes_publicacoes_pendentes]: esperava 2 vencidas, veio %', n; END IF;
  SELECT count(*) INTO n FROM redes_conexoes_sem_snapshot(200)
   WHERE id IN ('5a000000-0000-4000-8000-00000000068a', '5b000000-0000-4000-8000-00000000068b');
  IF n <> 2 THEN RAISE EXCEPTION 'FALHA[redes_conexoes_sem_snapshot]: esperava 2 contas sem foto de hoje, veio %', n; END IF;
  SELECT count(*) INTO n FROM information_schema.routines r
    JOIN information_schema.parameters p ON p.specific_name = r.specific_name AND p.parameter_mode = 'OUT'
   WHERE r.routine_name IN ('redes_publicacoes_pendentes', 'redes_conexoes_sem_snapshot')
     AND p.parameter_name NOT IN ('tenant_id', 'id');
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[funções do worker]: devolvem % coluna(s) além de (tenant_id, id)', n; END IF;
  RAISE NOTICE 'OK redes: funções do worker só roteiam';
END $$;

RESET ROLE;
ROLLBACK;
\echo '============================================'
\echo ' 068 OK: publicações e fotos das redes isoladas.'
\echo '============================================'

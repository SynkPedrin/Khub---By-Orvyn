-- =====================================================================
-- Gestão financeira (db/070): teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/070_financeiro_gestao_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão nada aparece;
--   2. A não lê, não altera e não apaga categorias, lançamentos, comissões
--      e configuração de comissão de B;
--   3. A não grava linha com tenant de B (WITH CHECK);
--   4. A não aponta para categoria, contato, cobrança, compromisso ou
--      lançamento de B (tenant_reference);
--   5. responsável/comissionado precisa ser membro do tenant;
--   6. idempotência no banco: uma entrada por compromisso e por cobrança,
--      uma comissão por entrada, uma linha por chave de importação;
--   7. valor em centavos > 0 e comissão nunca maior que a base.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000070', 'TENANT_A_FIN'),
  ('b2b2b2b2-0000-4000-8000-000000000070', 'TENANT_B_FIN');
INSERT INTO identities (id, email) VALUES
  ('1da00000-0000-4000-8000-00000000070a', 'prof-a-070@teste.khub'),
  ('1db00000-0000-4000-8000-00000000070b', 'prof-b-070@teste.khub');
INSERT INTO memberships (identity_id, tenant_id, role) VALUES
  ('1da00000-0000-4000-8000-00000000070a', 'a1a1a1a1-0000-4000-8000-000000000070', 'member'),
  ('1db00000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', 'member');

-- Dados de B (gravados com o tenant de B na sessão: os gatilhos checam referências).
SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000070', true);
INSERT INTO contacts (id, tenant_id, nome) VALUES
  ('c0b00000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', 'CLIENTE_SECRETO_B');
INSERT INTO financeiro_cobrancas (id, tenant_id, descricao, valor_centavos, status) VALUES
  ('cbb00000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', 'COBRANCA_B', 5000, 'paga');
INSERT INTO agenda_compromissos (id, tenant_id, titulo, inicio, fim, valor_centavos) VALUES
  ('a9b00000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', 'ATENDIMENTO_B',
   now(), now() + interval '1 hour', 12000);
INSERT INTO financeiro_categorias (id, tenant_id, nome, tipo) VALUES
  ('cab00000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', 'CATEGORIA_SECRETA_B', 'entrada');
INSERT INTO financeiro_transacoes (id, tenant_id, tipo, categoria_id, descricao, valor_centavos, responsavel_id, compromisso_id, origem) VALUES
  ('7b000000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', 'entrada',
   'cab00000-0000-4000-8000-00000000070b', 'FATURAMENTO_SECRETO_B', 12000,
   '1db00000-0000-4000-8000-00000000070b', 'a9b00000-0000-4000-8000-00000000070b', 'agenda');
INSERT INTO equipe_comissoes (tenant_id, identity_id, cargo, comissao_percent) VALUES
  ('b2b2b2b2-0000-4000-8000-000000000070', '1db00000-0000-4000-8000-00000000070b', 'CARGO_SECRETO_B', 40);
INSERT INTO financeiro_comissoes (id, tenant_id, identity_id, transacao_id, base_centavos, percent, valor_centavos, competencia) VALUES
  ('c0c00000-0000-4000-8000-00000000070b', 'b2b2b2b2-0000-4000-8000-000000000070', '1db00000-0000-4000-8000-00000000070b',
   '7b000000-0000-4000-8000-00000000070b', 12000, 40, 4800, date_trunc('month', now())::date);

-- Dados de A.
SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000070', true);
INSERT INTO financeiro_categorias (id, tenant_id, nome, tipo) VALUES
  ('caa00000-0000-4000-8000-00000000070a', 'a1a1a1a1-0000-4000-8000-000000000070', 'Serviços', 'entrada');
INSERT INTO agenda_compromissos (id, tenant_id, titulo, inicio, fim, valor_centavos) VALUES
  ('a9a00000-0000-4000-8000-00000000070a', 'a1a1a1a1-0000-4000-8000-000000000070', 'Atendimento A',
   now(), now() + interval '1 hour', 10000);
INSERT INTO financeiro_transacoes (id, tenant_id, tipo, categoria_id, descricao, valor_centavos, responsavel_id, compromisso_id, origem, chave_importacao) VALUES
  ('7a000000-0000-4000-8000-00000000070a', 'a1a1a1a1-0000-4000-8000-000000000070', 'entrada',
   'caa00000-0000-4000-8000-00000000070a', 'Atendimento A', 10000,
   '1da00000-0000-4000-8000-00000000070a', 'a9a00000-0000-4000-8000-00000000070a', 'agenda', NULL),
  ('7a000000-0000-4000-8000-00000000071a', 'a1a1a1a1-0000-4000-8000-000000000070', 'entrada',
   NULL, 'Importado A', 500, NULL, NULL, 'importacao', 'v1:chave-teste#1');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t TEXT;
  ta CONSTANT uuid := 'a1a1a1a1-0000-4000-8000-000000000070';
  tb CONSTANT uuid := 'b2b2b2b2-0000-4000-8000-000000000070';
BEGIN
  -- (1) Sem tenant: nada.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT (SELECT count(*) FROM financeiro_categorias) + (SELECT count(*) FROM financeiro_transacoes)
       + (SELECT count(*) FROM equipe_comissoes) + (SELECT count(*) FROM financeiro_comissoes) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[financeiro sem tenant]: % linha(s)', n; END IF;

  -- (2) A não lê/altera/apaga nada de B.
  PERFORM set_config('app.current_tenant_id', ta::text, true);
  FOREACH t IN ARRAY ARRAY['financeiro_categorias', 'financeiro_transacoes', 'equipe_comissoes', 'financeiro_comissoes'] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', t, tb) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: A leu % linha(s) de B', t, n; END IF;
    EXECUTE format('UPDATE %I SET tenant_id = tenant_id WHERE tenant_id = %L', t, tb);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update %]: A alterou linha de B', t; END IF;
    EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', t, tb);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete %]: A apagou linha de B', t; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM financeiro_transacoes WHERE descricao = 'FATURAMENTO_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[financeiro_transacoes]: A leu o faturamento de B'; END IF;

  -- (3) Escrever com o tenant de B é barrado.
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos) VALUES (tb, 'saida', 'FORJADO', 100);
    RAISE EXCEPTION 'VAZAMENTO[write financeiro_transacoes]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_categorias (tenant_id, nome, tipo) VALUES (tb, 'FORJADA', 'saida');
    RAISE EXCEPTION 'VAZAMENTO[write financeiro_categorias]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (tb, '1db00000-0000-4000-8000-00000000070b', 100, 10, 10, date_trunc('month', now())::date);
    RAISE EXCEPTION 'VAZAMENTO[write financeiro_comissoes]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- (4) Referências para linhas de B são recusadas.
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, categoria_id)
      VALUES (ta, 'entrada', 'APONTA_CATEGORIA_B', 100, 'cab00000-0000-4000-8000-00000000070b');
    RAISE EXCEPTION 'VAZAMENTO[ref categoria]: A usou categoria de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, contact_id)
      VALUES (ta, 'entrada', 'APONTA_CONTATO_B', 100, 'c0b00000-0000-4000-8000-00000000070b');
    RAISE EXCEPTION 'VAZAMENTO[ref contato]: A apontou para contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, cobranca_id)
      VALUES (ta, 'entrada', 'APONTA_COBRANCA_B', 100, 'cbb00000-0000-4000-8000-00000000070b');
    RAISE EXCEPTION 'VAZAMENTO[ref cobranca]: A apontou para cobrança de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, compromisso_id)
      VALUES (ta, 'entrada', 'APONTA_COMPROMISSO_B', 100, 'a9b00000-0000-4000-8000-00000000070b');
    RAISE EXCEPTION 'VAZAMENTO[ref compromisso]: A apontou para atendimento de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, transacao_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, '1da00000-0000-4000-8000-00000000070a', '7b000000-0000-4000-8000-00000000070b', 100, 10, 10, date_trunc('month', now())::date);
    RAISE EXCEPTION 'VAZAMENTO[ref transacao]: comissão de A apontou para lançamento de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, pagamento_transacao_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, '1da00000-0000-4000-8000-00000000070a', '7b000000-0000-4000-8000-00000000070b', 100, 10, 10, date_trunc('month', now())::date);
    RAISE EXCEPTION 'VAZAMENTO[ref pagamento]: comissão de A apontou para pagamento de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- (5) Quem não é membro de A não recebe entrada nem comissão em A.
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, responsavel_id)
      VALUES (ta, 'entrada', 'RESP_DE_B', 100, '1db00000-0000-4000-8000-00000000070b');
    RAISE EXCEPTION 'FALHA[membro]: profissional de B recebeu entrada em A';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO equipe_comissoes (tenant_id, identity_id, comissao_percent) VALUES (ta, '1db00000-0000-4000-8000-00000000070b', 50);
    RAISE EXCEPTION 'FALHA[membro]: profissional de B configurado em A';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, '1db00000-0000-4000-8000-00000000070b', 100, 10, 10, date_trunc('month', now())::date);
    RAISE EXCEPTION 'FALHA[membro]: comissão em A para profissional de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- (6) Idempotência garantida pelo banco.
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, compromisso_id)
      VALUES (ta, 'entrada', 'SEGUNDA_ENTRADA', 10000, 'a9a00000-0000-4000-8000-00000000070a');
    RAISE EXCEPTION 'FALHA[idempotência]: duas entradas para o mesmo atendimento';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  INSERT INTO financeiro_comissoes (tenant_id, identity_id, transacao_id, base_centavos, percent, valor_centavos, competencia)
    VALUES (ta, '1da00000-0000-4000-8000-00000000070a', '7a000000-0000-4000-8000-00000000070a', 10000, 30, 3000, date_trunc('month', now())::date);
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, transacao_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, '1da00000-0000-4000-8000-00000000070a', '7a000000-0000-4000-8000-00000000070a', 10000, 30, 3000, date_trunc('month', now())::date);
    RAISE EXCEPTION 'FALHA[idempotência]: duas comissões para a mesma entrada';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, origem, chave_importacao)
      VALUES (ta, 'entrada', 'REIMPORTADO', 500, 'importacao', 'v1:chave-teste#1');
    RAISE EXCEPTION 'FALHA[idempotência]: mesma linha importada duas vezes';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- (7) Dinheiro coerente.
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos) VALUES (ta, 'saida', 'ZERO', 0);
    RAISE EXCEPTION 'FALHA[valor]: lançamento de valor zero aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, '1da00000-0000-4000-8000-00000000070a', 100, 50, 101, date_trunc('month', now())::date);
    RAISE EXCEPTION 'FALHA[comissão]: comissão maior que a base aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, identity_id, base_centavos, percent, valor_centavos, competencia, status)
      VALUES (ta, '1da00000-0000-4000-8000-00000000070a', 100, 50, 50, date_trunc('month', now())::date, 'paga');
    RAISE EXCEPTION 'FALHA[comissão]: paga sem data de pagamento aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'OK financeiro: categorias, lançamentos e comissões isolados; idempotência no banco';
END $$;

RESET ROLE;
ROLLBACK;
\echo '============================================'
\echo ' 070 OK: gestão financeira isolada por tenant.'
\echo '============================================'

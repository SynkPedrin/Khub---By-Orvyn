-- =====================================================================
-- Catálogo, estoque e importações (db/071): teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/071_catalogo_estoque_importacao_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão nada aparece;
--   2. A não lê, não altera e não apaga profissionais, serviços, produtos,
--      movimentos e importações de B;
--   3. A não grava linha com tenant de B (WITH CHECK);
--   4. A não aponta agenda, lançamento, comissão ou movimento para
--      profissional, serviço, produto ou importação de B;
--   5. idempotência no banco: um nome por tenant, um SKU por tenant, um
--      movimento por chave de importação;
--   6. comissão exige membro OU profissional; estoque tem sinal coerente.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000071', 'TENANT_A_CAT'),
  ('b2b2b2b2-0000-4000-8000-000000000071', 'TENANT_B_CAT');

-- Dados de B (com o tenant de B na sessão: os gatilhos checam referências).
SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000071', true);
INSERT INTO importacoes (id, tenant_id, entidade, arquivo_nome) VALUES
  ('1b000000-0000-4000-8000-00000000071b', 'b2b2b2b2-0000-4000-8000-000000000071', 'servicos', 'ARQUIVO_SECRETO_B.csv');
INSERT INTO profissionais (id, tenant_id, nome, comissao_percent) VALUES
  ('9b000000-0000-4000-8000-00000000071b', 'b2b2b2b2-0000-4000-8000-000000000071', 'PROFISSIONAL_SECRETA_B', 40);
INSERT INTO servicos (id, tenant_id, nome, preco_centavos) VALUES
  ('5b000000-0000-4000-8000-00000000071b', 'b2b2b2b2-0000-4000-8000-000000000071', 'SERVICO_SECRETO_B', 15000);
INSERT INTO produtos (id, tenant_id, nome, sku) VALUES
  ('4b000000-0000-4000-8000-00000000071b', 'b2b2b2b2-0000-4000-8000-000000000071', 'PRODUTO_SECRETO_B', 'SKU-B');
INSERT INTO estoque_movimentos (id, tenant_id, produto_id, tipo, delta, origem) VALUES
  ('3b000000-0000-4000-8000-00000000071b', 'b2b2b2b2-0000-4000-8000-000000000071', '4b000000-0000-4000-8000-00000000071b', 'entrada', 10, 'manual');
INSERT INTO financeiro_transacoes (id, tenant_id, tipo, descricao, valor_centavos, profissional_id) VALUES
  ('7b000000-0000-4000-8000-00000000071b', 'b2b2b2b2-0000-4000-8000-000000000071', 'entrada', 'LANCAMENTO_B', 15000, '9b000000-0000-4000-8000-00000000071b');

-- Dados de A.
SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000071', true);
INSERT INTO profissionais (id, tenant_id, nome, comissao_percent) VALUES
  ('9a000000-0000-4000-8000-00000000071a', 'a1a1a1a1-0000-4000-8000-000000000071', 'Marina', 30);
INSERT INTO servicos (id, tenant_id, nome, preco_centavos) VALUES
  ('5a000000-0000-4000-8000-00000000071a', 'a1a1a1a1-0000-4000-8000-000000000071', 'Corte', 8000);
INSERT INTO produtos (id, tenant_id, nome, sku) VALUES
  ('4a000000-0000-4000-8000-00000000071a', 'a1a1a1a1-0000-4000-8000-000000000071', 'Shampoo', 'SKU-A');
INSERT INTO estoque_movimentos (tenant_id, produto_id, tipo, delta, origem, chave_importacao) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000071', '4a000000-0000-4000-8000-00000000071a', 'entrada', 5, 'importacao', 'v1:mov#1');
INSERT INTO agenda_compromissos (id, tenant_id, titulo, inicio, fim, valor_centavos, servico_id, profissional_id) VALUES
  ('a9a00000-0000-4000-8000-00000000071a', 'a1a1a1a1-0000-4000-8000-000000000071', 'Corte da Ana',
   now(), now() + interval '1 hour', 8000, '5a000000-0000-4000-8000-00000000071a', '9a000000-0000-4000-8000-00000000071a');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t TEXT;
  ta CONSTANT uuid := 'a1a1a1a1-0000-4000-8000-000000000071';
  tb CONSTANT uuid := 'b2b2b2b2-0000-4000-8000-000000000071';
  tabelas CONSTANT text[] := ARRAY['importacoes','profissionais','servicos','produtos','estoque_movimentos'];
BEGIN
  -- (1) Sem tenant: nada.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT (SELECT count(*) FROM importacoes) + (SELECT count(*) FROM profissionais) + (SELECT count(*) FROM servicos)
       + (SELECT count(*) FROM produtos) + (SELECT count(*) FROM estoque_movimentos) INTO n;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[catalogo sem tenant]: % linha(s)', n; END IF;

  -- (2) A não lê/altera/apaga nada de B.
  PERFORM set_config('app.current_tenant_id', ta::text, true);
  FOREACH t IN ARRAY tabelas LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', t, tb) INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: A leu % linha(s) de B', t, n; END IF;
    EXECUTE format('UPDATE %I SET tenant_id = tenant_id WHERE tenant_id = %L', t, tb);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update %]: A alterou linha de B', t; END IF;
    EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', t, tb);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete %]: A apagou linha de B', t; END IF;
  END LOOP;
  SELECT count(*) INTO n FROM profissionais WHERE nome = 'PROFISSIONAL_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[profissionais]: A leu profissional de B'; END IF;
  SELECT count(*) INTO n FROM servicos WHERE nome = 'SERVICO_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[servicos]: A leu serviço de B'; END IF;

  -- (3) Escrever com o tenant de B é barrado.
  BEGIN
    INSERT INTO profissionais (tenant_id, nome) VALUES (tb, 'FORJADO');
    RAISE EXCEPTION 'VAZAMENTO[write profissionais]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO servicos (tenant_id, nome) VALUES (tb, 'FORJADO');
    RAISE EXCEPTION 'VAZAMENTO[write servicos]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO importacoes (tenant_id, entidade) VALUES (tb, 'servicos');
    RAISE EXCEPTION 'VAZAMENTO[write importacoes]: A gravou em B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- (4) Referências para linhas de B são recusadas.
  BEGIN
    INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim, profissional_id)
      VALUES (ta, 'APONTA_PROFISSIONAL_B', now(), now() + interval '1 hour', '9b000000-0000-4000-8000-00000000071b');
    RAISE EXCEPTION 'VAZAMENTO[ref profissional]: agenda de A usou profissional de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agenda_compromissos (tenant_id, titulo, inicio, fim, servico_id)
      VALUES (ta, 'APONTA_SERVICO_B', now(), now() + interval '1 hour', '5b000000-0000-4000-8000-00000000071b');
    RAISE EXCEPTION 'VAZAMENTO[ref servico]: agenda de A usou serviço de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_transacoes (tenant_id, tipo, descricao, valor_centavos, profissional_id)
      VALUES (ta, 'entrada', 'APONTA_PROFISSIONAL_B', 100, '9b000000-0000-4000-8000-00000000071b');
    RAISE EXCEPTION 'VAZAMENTO[ref profissional fin]: lançamento de A usou profissional de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, profissional_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, '9b000000-0000-4000-8000-00000000071b', 100, 10, 10, date_trunc('month', now())::date);
    RAISE EXCEPTION 'VAZAMENTO[ref profissional comissao]: comissão de A usou profissional de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO estoque_movimentos (tenant_id, produto_id, tipo, delta) VALUES (ta, '4b000000-0000-4000-8000-00000000071b', 'entrada', 1);
    RAISE EXCEPTION 'VAZAMENTO[ref produto]: movimento de A usou produto de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO servicos (tenant_id, nome, importacao_id) VALUES (ta, 'APONTA_IMPORTACAO_B', '1b000000-0000-4000-8000-00000000071b');
    RAISE EXCEPTION 'VAZAMENTO[ref importacao]: serviço de A usou importação de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- (5) Idempotência garantida pelo banco.
  BEGIN
    INSERT INTO profissionais (tenant_id, nome) VALUES (ta, '  marina ');
    RAISE EXCEPTION 'FALHA[unicidade]: profissional duplicado por nome';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO servicos (tenant_id, nome) VALUES (ta, 'CORTE');
    RAISE EXCEPTION 'FALHA[unicidade]: serviço duplicado por nome';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO produtos (tenant_id, nome, sku) VALUES (ta, 'Outro nome', 'sku-a');
    RAISE EXCEPTION 'FALHA[unicidade]: SKU duplicado';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO estoque_movimentos (tenant_id, produto_id, tipo, delta, origem, chave_importacao)
      VALUES (ta, '4a000000-0000-4000-8000-00000000071a', 'entrada', 5, 'importacao', 'v1:mov#1');
    RAISE EXCEPTION 'FALHA[idempotência]: mesmo movimento importado duas vezes';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- B pode ter o mesmo nome que A: a unicidade é POR tenant.
  PERFORM set_config('app.current_tenant_id', tb::text, true);
  INSERT INTO profissionais (tenant_id, nome) VALUES (tb, 'Marina');
  PERFORM set_config('app.current_tenant_id', ta::text, true);

  -- (6) Regras de integridade.
  BEGIN
    INSERT INTO financeiro_comissoes (tenant_id, base_centavos, percent, valor_centavos, competencia)
      VALUES (ta, 100, 10, 10, date_trunc('month', now())::date);
    RAISE EXCEPTION 'FALHA[destino]: comissão sem membro e sem profissional aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  INSERT INTO financeiro_comissoes (tenant_id, profissional_id, base_centavos, percent, valor_centavos, competencia)
    VALUES (ta, '9a000000-0000-4000-8000-00000000071a', 8000, 30, 2400, date_trunc('month', now())::date);
  BEGIN
    INSERT INTO estoque_movimentos (tenant_id, produto_id, tipo, delta) VALUES (ta, '4a000000-0000-4000-8000-00000000071a', 'saida', 3);
    RAISE EXCEPTION 'FALHA[sinal]: saída com delta positivo aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO estoque_movimentos (tenant_id, produto_id, tipo, delta) VALUES (ta, '4a000000-0000-4000-8000-00000000071a', 'ajuste', 0);
    RAISE EXCEPTION 'FALHA[sinal]: ajuste zero aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO servicos (tenant_id, nome, comissao_percent) VALUES (ta, 'Comissão absurda', 150);
    RAISE EXCEPTION 'FALHA[percentual]: comissão acima de 100%% aceita';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  -- saldo = soma dos deltas
  INSERT INTO estoque_movimentos (tenant_id, produto_id, tipo, delta) VALUES (ta, '4a000000-0000-4000-8000-00000000071a', 'saida', -2);
  SELECT COALESCE(SUM(delta), 0)::int INTO n FROM estoque_movimentos WHERE produto_id = '4a000000-0000-4000-8000-00000000071a';
  IF n <> 3 THEN RAISE EXCEPTION 'FALHA[saldo]: esperado 3, veio %', n; END IF;

  RAISE NOTICE 'OK: isolamento e integridade do catálogo/estoque/importações (db/071)';
END $$;

ROLLBACK;

-- =====================================================================
-- KHUB Agent Intelligence — teste de isolamento cross-tenant (db/034)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/034_agent_intelligence_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, atuando como khub_app (sem BYPASSRLS) no tenant A:
--   1. nenhuma das 16 tabelas novas mostra linha do tenant B;
--   2. UPDATE/DELETE em linha de B afetam 0 linhas;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. INSERT no tenant A apontando para agente/contato/conversa de B é
--      barrado pelo gatilho tenant_reference (FK sozinha não basta);
--   5. agent_rag_search_lexical nunca devolve chunk de B, e o filtro por
--      documentos do agente roda dentro do WHERE.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000001', 'TENANT_A_ISO'),
  ('b2b2b2b2-0000-4000-8000-000000000002', 'TENANT_B_ISO');

INSERT INTO contacts (id, tenant_id, nome, telefone) VALUES
  ('ca000000-0000-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-000000000001', 'Contato A', '5511900000001'),
  ('cb000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'CONTATO_SECRETO_B', '5511900000002');
INSERT INTO conversations (id, tenant_id, contact_id, nome) VALUES
  ('da000000-0000-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-000000000001', 'ca000000-0000-4000-8000-00000000000a', 'Conv A'),
  ('db000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-00000000000b', 'Conv B');
INSERT INTO messages (id, tenant_id, conversation_id, autor_tipo, corpo) VALUES
  ('ea000000-0000-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-000000000001', 'da000000-0000-4000-8000-00000000000a', 'contato', 'oi'),
  ('eb000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-00000000000b', 'contato', 'oi B');
INSERT INTO agents (id, tenant_id, nome, modelo, instrucoes) VALUES
  ('fa000000-0000-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-000000000001', 'Agente A', 'claude-opus-5-5', 'prompt A'),
  ('fb000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'AGENTE_B', 'claude-opus-5-5', 'PROMPT_SECRETO_B');
INSERT INTO agent_runs (id, tenant_id, agent_id, conversation_id, message_id, status) VALUES
  ('aa000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'db000000-0000-4000-8000-00000000000b', 'eb000000-0000-4000-8000-00000000000b', 'respondido');

-- Uma linha de B em CADA tabela nova.
INSERT INTO agent_versions (id, tenant_id, agent_id, numero, snapshot, notas) VALUES ('ab000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 1, '{"instrucoes":"PROMPT_SECRETO_B"}', 'SEGREDO_B');
INSERT INTO agent_intent_categories (tenant_id, chave, nome) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'segredo_b', 'SEGREDO_B');
INSERT INTO rag_documents (id, tenant_id, escopo, titulo, fonte, content_hash, status, texto_fonte) VALUES
  ('0b000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'tenant', 'DOC_B', 'texto', 'hash_iso_b', 'published', 'SEGREDO_B'),
  ('0a000000-0000-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-000000000001', 'tenant', 'DOC_A', 'texto', 'hash_iso_a', 'published', 'tabela de precos A');
INSERT INTO rag_chunks (document_id, tenant_id, escopo, ordem, conteudo, status) VALUES
  ('0b000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'tenant', 0, 'tabela de precos SEGREDO_B', 'published'),
  ('0a000000-0000-4000-8000-00000000000a', 'a1a1a1a1-0000-4000-8000-000000000001', 'tenant', 0, 'tabela de precos do tenant A', 'published');
INSERT INTO agent_knowledge_sources (tenant_id, agent_id, document_id, categoria) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', '0b000000-0000-4000-8000-00000000000b', 'SEGREDO_B');
INSERT INTO agent_customer_profiles (tenant_id, contact_id, resumo) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-00000000000b', 'SEGREDO_B');
INSERT INTO agent_profile_facts (tenant_id, contact_id, campo, valor, origem, status) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-00000000000b', 'orcamento', '"SEGREDO_B"', 'declarado', 'confirmado');
INSERT INTO agent_extractions (tenant_id, contact_id, campo, valor, origem, decisao) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-00000000000b', 'orcamento', '"SEGREDO_B"', 'declarado', 'aplicado');
INSERT INTO agent_memories (tenant_id, contact_id, camada, tipo, conteudo) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'cb000000-0000-4000-8000-00000000000b', 'longo', 'fato', 'SEGREDO_B');
INSERT INTO agent_delivery_queue (tenant_id, conversation_id, sequencia_id, ordem, total, texto, idempotency_key) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'db000000-0000-4000-8000-00000000000b', uuid_generate_v4(), 1, 1, 'SEGREDO_B', 'iso:b:1');
INSERT INTO agent_followup_rules (id, tenant_id, agent_id, nome, estrategia) VALUES ('ac000000-0000-4000-8000-00000000000b', 'b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'SEGREDO_B', 'sem_resposta');
INSERT INTO agent_followups (tenant_id, agent_id, rule_id, contact_id, conversation_id, ciclo_id, estrategia, tentativa, agendado_para, mensagem) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-00000000000b', 'cb000000-0000-4000-8000-00000000000b', 'db000000-0000-4000-8000-00000000000b', uuid_generate_v4(), 'sem_resposta', 1, now(), 'SEGREDO_B');
INSERT INTO agent_tool_executions (tenant_id, agent_id, ferramenta, status, erro) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'adicionar_tag', 'aguardando_aprovacao', 'SEGREDO_B');
INSERT INTO agent_learning_events (tenant_id, agent_id, tipo, chave) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'objecao', 'SEGREDO_B');
INSERT INTO agent_improvement_proposals (tenant_id, agent_id, tipo, chave, titulo, descricao) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'prompt', 'k', 'SEGREDO_B', 'SEGREDO_B');
INSERT INTO agent_eval_scenarios (tenant_id, agent_id, nome, mensagens) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'SEGREDO_B', '[]');
INSERT INTO agent_evaluations (tenant_id, agent_id, alvo, erro) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'rascunho', 'SEGREDO_B');
INSERT INTO agent_simulations (tenant_id, agent_id, perfil) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-00000000000b', 'SEGREDO_B');

-- ---------- ATUA COMO A ----------
SET LOCAL ROLE khub_app;
SELECT set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000001', true);

DO $$
DECLARE t TEXT; n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_versions', 'agent_intent_categories', 'agent_knowledge_sources', 'agent_customer_profiles',
    'agent_profile_facts', 'agent_extractions', 'agent_memories', 'agent_delivery_queue', 'agent_followup_rules',
    'agent_followups', 'agent_tool_executions', 'agent_learning_events', 'agent_improvement_proposals',
    'agent_eval_scenarios', 'agent_evaluations', 'agent_simulations'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000002') INTO n;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[%]: tenant A leu % linha(s) do tenant B', t, n; END IF;
    EXECUTE format('UPDATE %I SET tenant_id = tenant_id WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000002');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[write %]: tenant A alterou linha de B', t; END IF;
    EXECUTE format('DELETE FROM %I WHERE tenant_id = %L', t, 'b2b2b2b2-0000-4000-8000-000000000002');
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete %]: tenant A apagou linha de B', t; END IF;
  END LOOP;
  RAISE NOTICE 'OK: 16 tabelas novas isoladas (leitura, update, delete)';
END $$;

DO $$
DECLARE n INT;
BEGIN
  SELECT count(*) INTO n FROM rag_documents WHERE texto_fonte = 'SEGREDO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[rag_documents.texto_fonte]: A leu o texto-fonte de B'; END IF;

  -- WITH CHECK: gravar no tenant B
  BEGIN
    INSERT INTO agent_memories (tenant_id, camada, tipo, conteudo) VALUES ('b2b2b2b2-0000-4000-8000-000000000002', 'longo', 'fato', 'INTRUSO');
    RAISE EXCEPTION 'VAZAMENTO[write agent_memories]: A gravou memória no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- Gatilho de referência: linha de A apontando para objetos de B
  BEGIN
    INSERT INTO agent_profile_facts (tenant_id, contact_id, campo, valor, origem) VALUES ('a1a1a1a1-0000-4000-8000-000000000001', 'cb000000-0000-4000-8000-00000000000b', 'orcamento', '"x"', 'declarado');
    RAISE EXCEPTION 'VAZAMENTO[ref agent_profile_facts→contacts]: A referenciou contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agent_knowledge_sources (tenant_id, agent_id, document_id) VALUES ('a1a1a1a1-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-00000000000a', '0b000000-0000-4000-8000-00000000000b');
    RAISE EXCEPTION 'VAZAMENTO[ref agent_knowledge_sources→rag_documents]: A vinculou documento de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agent_delivery_queue (tenant_id, agent_id, conversation_id, sequencia_id, ordem, total, texto, idempotency_key) VALUES ('a1a1a1a1-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-00000000000b', 'da000000-0000-4000-8000-00000000000a', uuid_generate_v4(), 1, 1, 'x', 'iso:a:x');
    RAISE EXCEPTION 'VAZAMENTO[ref agent_delivery_queue→agents]: A usou agente de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO agent_followups (tenant_id, agent_id, rule_id, contact_id, conversation_id, ciclo_id, estrategia, tentativa, agendado_para) VALUES ('a1a1a1a1-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-00000000000b', 'ca000000-0000-4000-8000-00000000000a', 'da000000-0000-4000-8000-00000000000a', uuid_generate_v4(), 'sem_resposta', 1, now());
    RAISE EXCEPTION 'VAZAMENTO[ref agent_followups→agent_followup_rules]: A usou regra de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  BEGIN
    UPDATE agents SET versao_publicada_id = 'ab000000-0000-4000-8000-00000000000b' WHERE id = 'fa000000-0000-4000-8000-00000000000a';
    RAISE EXCEPTION 'VAZAMENTO[ref agents→agent_versions]: A publicou versão de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- Busca do agente: nunca chunk de B; filtro por documento dentro do WHERE.
  SELECT count(*) INTO n FROM agent_rag_search_lexical('tabela precos', NULL, NULL, ARRAY['tenant'], NULL, 30) s WHERE s.conteudo LIKE '%SEGREDO_B%';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agent_rag_search_lexical]: A recuperou chunk de B'; END IF;
  SELECT count(*) INTO n FROM agent_rag_search_lexical('tabela precos', NULL, NULL, ARRAY['tenant'], NULL, 30);
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[agent_rag_search_lexical]: esperava 1 chunk de A, veio %', n; END IF;
  SELECT count(*) INTO n FROM agent_rag_search_lexical('tabela precos', NULL, NULL, ARRAY['tenant'], ARRAY['0b000000-0000-4000-8000-00000000000b']::uuid[], 30);
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agent_rag_search_lexical]: pedir documento de B devolveu algo'; END IF;
  SELECT count(*) INTO n FROM agent_rag_search_lexical('tabela precos', NULL, NULL, ARRAY['tenant'], ARRAY['00000000-0000-0000-0000-000000000000']::uuid[], 30);
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[filtro]: lista de documentos sem match devolveu chunk'; END IF;

  RAISE NOTICE 'OK: escrita cruzada barrada, referências cruzadas barradas, busca do agente isolada';
END $$;

ROLLBACK;

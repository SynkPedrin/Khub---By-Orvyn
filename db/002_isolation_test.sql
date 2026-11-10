-- =====================================================================
-- KHUB · Nyro IA — Teste de isolamento cross-tenant do RAG (R0.2)
-- BLOQUEANTE no CI. Em qualquer vazamento faz RAISE EXCEPTION -> exit != 0.
--
-- Rodar:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002_isolation_test.sql
-- O runner deve ser superuser OU membro de khub_service e khub_app
-- (no Postgres do docker-compose o usuário 'postgres' já é superuser).
--
-- O teste semeia dados como khub_service (BYPASSRLS), depois atua como
-- khub_app (NOBYPASSRLS) com app.current_tenant_id = A e prova que:
--   1. A NÃO enxerga documentos/chunks do tenant B (vazamento = incidente LGPD)
--   2. A enxerga o próprio tenant + as bases compartilhadas (global)
--   3. A busca híbrida (rag_search_hybrid) nunca retorna chunk de B
--   4. A não consegue gravar documento no escopo de B (WITH CHECK)
-- Ao final: ROLLBACK — não deixa resíduo no banco.
-- =====================================================================

\set ON_ERROR_STOP on

BEGIN;

-- IDs fixos para asserção determinística
\set tenant_a '11111111-1111-1111-1111-111111111111'
\set tenant_b '22222222-2222-2222-2222-222222222222'

-- ---------- SEED (como serviço, ignora RLS) ----------
SET LOCAL ROLE khub_service;

INSERT INTO tenants (id, nome) VALUES
  (:'tenant_a', 'Clinica A'),
  (:'tenant_b', 'Escritorio B');

-- Documentos: 1 do tenant A, 1 do tenant B, 1 global
INSERT INTO rag_documents (tenant_id, escopo, nicho, subespecialidade, titulo, fonte, content_hash, status)
VALUES
  (:'tenant_a', 'tenant', 'medico',   NULL, 'DOC_A',      'upload_cliente', 'hash_a',   'published'),
  (:'tenant_b', 'tenant', 'juridico', NULL, 'DOC_B',      'upload_cliente', 'hash_b',   'published'),
  (NULL,        'global', NULL,       NULL, 'DOC_GLOBAL', 'playbook_interno','hash_g',  'published');

-- Chunks correspondentes (embedding NULL de propósito: o teste exercita o
-- filtro de isolamento pela via léxica, sem depender de vetores válidos)
INSERT INTO rag_chunks (document_id, tenant_id, escopo, nicho, subespecialidade, ordem, conteudo, status)
SELECT id, tenant_id, escopo, nicho, subespecialidade, 0,
       CASE titulo
         WHEN 'DOC_A'      THEN 'protocolo interno alfa confidencial do tenant A'
         WHEN 'DOC_B'      THEN 'protocolo interno bravo confidencial do tenant B'
         ELSE                   'protocolo global publico compartilhado'
       END,
       'published'
FROM rag_documents
WHERE titulo IN ('DOC_A','DOC_B','DOC_GLOBAL');

-- seed de tabelas de auth/tenant (audit_logs, webhook_events) — criadas no 004
INSERT INTO audit_logs (tenant_id, actor_type, acao) VALUES (:'tenant_a', 'humano', 'acao A'), (:'tenant_b', 'humano', 'acao B');
INSERT INTO webhook_events (tenant_id, provider, event_id) VALUES (:'tenant_a', 'stripe', 'evt_A'), (:'tenant_b', 'stripe', 'evt_B');
-- integrações de anúncios (criadas no 005)
INSERT INTO integrations (tenant_id, provider, status) VALUES (:'tenant_a', 'meta', 'connected'), (:'tenant_b', 'meta', 'connected');
-- instância STEVO do tenant B, para provar o roteamento do webhook (migration 008)
INSERT INTO integrations (tenant_id, provider, status, external_business_id, credentials_encrypted)
VALUES (:'tenant_b', 'stevo', 'connected', 'instancia_do_B', 'SEGREDO_DE_B');

-- Billing da plataforma (migration 028): assinatura do B, com stripe_customer_id secreto
INSERT INTO subscriptions (tenant_id, plano, status, stripe_customer_id, stripe_subscription_id)
VALUES (:'tenant_b', 'growth', 'ativa', 'cus_SEGREDO_DO_B', 'sub_SEGREDO_DO_B');

-- CRM F2 (migration 009): empresas, tarefas, notas e páginas do B
INSERT INTO companies (id, tenant_id, nome, dominio)
VALUES ('cccccccc-0000-4000-8000-00000000000b', :'tenant_b', 'Empresa Secreta do B', 'segredo-b.com');
INSERT INTO tasks (tenant_id, titulo, company_id)
VALUES (:'tenant_b', 'TAREFA_SECRETA_DO_B', 'cccccccc-0000-4000-8000-00000000000b');
INSERT INTO notes (tenant_id, corpo, company_id)
VALUES (:'tenant_b', 'NOTA_SECRETA_DO_B', 'cccccccc-0000-4000-8000-00000000000b');
INSERT INTO meta_pages (tenant_id, integration_id, page_id, page_nome)
SELECT :'tenant_b', id, 'PAGE_DO_B', 'Página do B' FROM integrations WHERE tenant_id = :'tenant_b' AND provider = 'meta' LIMIT 1;

-- Automações (migration 010): workflow do B com versão, run, log e DLQ
INSERT INTO workflows (id, tenant_id, nome, status)
VALUES ('ffffffff-0000-4000-8000-00000000000b', :'tenant_b', 'WORKFLOW_SECRETO_DO_B', 'ativo');
INSERT INTO workflow_versions (id, tenant_id, workflow_id, versao, grafo, publicado_em)
VALUES ('ffffffff-1111-4000-8000-00000000000b', :'tenant_b', 'ffffffff-0000-4000-8000-00000000000b', 1,
        '{"nos":[{"id":"g","tipo":"gatilho.contato_criado","posicao":{"x":0,"y":0},"config":{}}],"arestas":[]}'::jsonb, now());
UPDATE workflows SET versao_ativa_id = 'ffffffff-1111-4000-8000-00000000000b' WHERE id = 'ffffffff-0000-4000-8000-00000000000b';
INSERT INTO workflow_runs (id, tenant_id, workflow_id, version_id, gatilho, estado)
VALUES ('ffffffff-2222-4000-8000-00000000000b', :'tenant_b', 'ffffffff-0000-4000-8000-00000000000b', 'ffffffff-1111-4000-8000-00000000000b',
        'gatilho.contato_criado', '{"segredo":"ESTADO_SECRETO_DO_B"}'::jsonb);
INSERT INTO workflow_run_steps (tenant_id, run_id, no_id, tipo, status, saida)
VALUES (:'tenant_b', 'ffffffff-2222-4000-8000-00000000000b', 'n1', 'acao.enviar_sms', 'ok', '{"texto":"MENSAGEM_SECRETA_DO_B"}'::jsonb);
INSERT INTO workflow_dlq (tenant_id, run_id, no_id, tipo, erro)
VALUES (:'tenant_b', 'ffffffff-2222-4000-8000-00000000000b', 'n1', 'acao.enviar_sms', 'ERRO_SECRETO_DO_B');

-- Nyro (migration 013): conversa, mensagem, ação pendente, memória e uso do B.
-- O conteúdo da conversa da Nyro tem dado sensível do cliente — vazar aqui é
-- tão grave quanto vazar o CRM.
INSERT INTO nyro_conversations (id, tenant_id, titulo)
VALUES ('aaaaaaaa-0000-4000-8000-00000000000b', :'tenant_b', 'CONVERSA_SECRETA_DO_B');
INSERT INTO nyro_messages (tenant_id, conversation_id, papel, conteudo)
VALUES (:'tenant_b', 'aaaaaaaa-0000-4000-8000-00000000000b', 'user', 'MENSAGEM_NYRO_SECRETA_DO_B');
INSERT INTO nyro_actions (tenant_id, conversation_id, tool, resumo, expira_em)
VALUES (:'tenant_b', 'aaaaaaaa-0000-4000-8000-00000000000b', 'enviar_mensagem', 'ACAO_SECRETA_DO_B', now() + interval '1 day');
INSERT INTO nyro_memory (tenant_id, chave, valor)
VALUES (:'tenant_b', 'segredo_b', 'MEMORIA_SECRETA_DO_B');
INSERT INTO ai_usage_events (tenant_id, agente, modelo, custo_usd)
VALUES (:'tenant_b', 'growth', 'claude-sonnet-5', 9.99);

INSERT INTO ad_insights (tenant_id, level, provider, external_ref_id, date, spend)
VALUES (:'tenant_a', 'account', 'meta', 'acc_A', current_date, 10), (:'tenant_b', 'account', 'meta', 'acc_B', current_date, 20);

-- Sprint AG (migration 030): agente, conversa em atendimento de IA, mensagem e run do B
INSERT INTO agents (id, tenant_id, nome, modelo, instrucoes)
VALUES ('ad000000-0000-4000-8000-00000000000b', :'tenant_b', 'AGENTE_SECRETO_DO_B', 'claude-opus-5-5', 'PROMPT_SECRETO_DO_B');
INSERT INTO conversations (id, tenant_id, nome, atendimento, agent_id)
VALUES ('ad000000-0000-4000-8000-0000000000cb', :'tenant_b', 'Conversa do B', 'ia', 'ad000000-0000-4000-8000-00000000000b');
INSERT INTO messages (id, tenant_id, conversation_id, autor_tipo, corpo)
-- autor 'humano': mensagem de contato dispararia o outbox (khub_service não grava outbox_events).
VALUES ('ad000000-0000-4000-8000-0000000000eb', :'tenant_b', 'ad000000-0000-4000-8000-0000000000cb', 'humano', 'MENSAGEM_DO_LEAD_DE_B');
INSERT INTO agent_runs (tenant_id, agent_id, conversation_id, message_id, status, motivo)
VALUES (:'tenant_b', 'ad000000-0000-4000-8000-00000000000b', 'ad000000-0000-4000-8000-0000000000cb', 'ad000000-0000-4000-8000-0000000000eb', 'respondido', 'RUN_SECRETO_DO_B');

-- ---------- ACT + ASSERT (como aplicação, tenant = A) ----------
SET LOCAL ROLE khub_app;
SET LOCAL app.current_tenant_id = :'tenant_a';

DO $$
DECLARE
  v_leak_docs   int;
  v_own_docs    int;
  v_global_docs int;
  v_leak_chunks int;
  v_fn_leak     int;
  v_fn_total    int;
BEGIN
  -- 1. Vazamento direto em rag_documents
  SELECT count(*) INTO v_leak_docs   FROM rag_documents WHERE titulo = 'DOC_B';
  IF v_leak_docs <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO[rag_documents]: tenant A leu % documento(s) do tenant B', v_leak_docs;
  END IF;

  -- 2. Próprio tenant + base global visíveis
  SELECT count(*) INTO v_own_docs    FROM rag_documents WHERE titulo = 'DOC_A';
  IF v_own_docs <> 1 THEN
    RAISE EXCEPTION 'REGRESSAO: tenant A nao enxerga o proprio documento (esperado 1, obtido %)', v_own_docs;
  END IF;

  SELECT count(*) INTO v_global_docs FROM rag_documents WHERE titulo = 'DOC_GLOBAL';
  IF v_global_docs <> 1 THEN
    RAISE EXCEPTION 'REGRESSAO: base global nao legivel pelo tenant A (esperado 1, obtido %)', v_global_docs;
  END IF;

  -- 3. Vazamento direto em rag_chunks
  SELECT count(*) INTO v_leak_chunks FROM rag_chunks WHERE conteudo LIKE '%bravo%';
  IF v_leak_chunks <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO[rag_chunks]: tenant A leu % chunk(s) do tenant B', v_leak_chunks;
  END IF;

  -- 4. Vazamento pela função de busca híbrida (a superfície real de ataque)
  SELECT count(*) FILTER (WHERE conteudo LIKE '%bravo%'),
         count(*)
    INTO v_fn_leak, v_fn_total
  FROM rag_search_hybrid(
         ('[' || array_to_string(array_fill(0::real, ARRAY[1024]), ',') || ']')::vector,
         'protocolo',
         'medico',
         NULL,
         ARRAY['tenant','sub','nicho','global'],
         50, 30, 60
       );
  IF v_fn_leak <> 0 THEN
    RAISE EXCEPTION 'VAZAMENTO[rag_search_hybrid]: busca do tenant A retornou % chunk(s) do tenant B', v_fn_leak;
  END IF;
  IF v_fn_total < 1 THEN
    RAISE EXCEPTION 'REGRESSAO: busca hibrida do tenant A nao retornou nada (esperava DOC_A e/ou DOC_GLOBAL)';
  END IF;

  RAISE NOTICE 'OK isolamento: leitura de A limpa (docs proprios=%, global=%, resultados de busca=%)',
    v_own_docs, v_global_docs, v_fn_total;
END $$;

-- 5. Escrita: tenant A não pode gravar documento no escopo do tenant B (WITH CHECK)
DO $$
BEGIN
  BEGIN
    INSERT INTO rag_documents (tenant_id, escopo, nicho, titulo, fonte, content_hash, status)
    VALUES ('22222222-2222-2222-2222-222222222222', 'tenant', 'juridico', 'DOC_B_FORJADO', 'upload_cliente', 'hash_forjado', 'published');
    RAISE EXCEPTION 'VAZAMENTO[write]: tenant A conseguiu inserir documento no tenant B';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'OK write-guard: insercao cross-tenant bloqueada pela RLS';
  END;
END $$;

-- 6. Isolamento das tabelas de auth/tenant (audit_logs, webhook_events)
DO $$
DECLARE v_audit int; v_wh int;
BEGIN
  SELECT count(*) INTO v_audit FROM audit_logs WHERE acao = 'acao B';
  IF v_audit <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[audit_logs]: tenant A leu % log(s) de B', v_audit; END IF;
  SELECT count(*) INTO v_wh FROM webhook_events WHERE event_id = 'evt_B';
  IF v_wh <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[webhook_events]: tenant A leu % evento(s) de B', v_wh; END IF;
  RAISE NOTICE 'OK isolamento auth: audit_logs e webhook_events isolados';
END $$;

-- 7. Isolamento das tabelas de integração (integrations, ad_insights)
DO $$
DECLARE v_int int; v_ins int;
BEGIN
  SELECT count(*) INTO v_int FROM integrations WHERE provider = 'meta' AND external_business_id IS NULL;
  IF v_int <> 1 THEN RAISE EXCEPTION 'VAZAMENTO[integrations]: tenant A vê % (esperado 1)', v_int; END IF;
  SELECT count(*) INTO v_ins FROM ad_insights WHERE external_ref_id = 'acc_B';
  IF v_ins <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[ad_insights]: tenant A leu % insight(s) de B', v_ins; END IF;
  RAISE NOTICE 'OK isolamento integrações: integrations e ad_insights isolados';
END $$;

-- 8. Roteamento do webhook do STEVO (migration 008): a função SECURITY DEFINER
--    devolve APENAS o tenant_id de roteamento — a linha (e o segredo) continuam
--    invisíveis para a app sem o tenant certo.
DO $$
DECLARE v_rot uuid; v_linhas int; v_segredo int;
BEGIN
  SELECT resolve_tenant_by_stevo_instance('instancia_do_B') INTO v_rot;
  IF v_rot IS DISTINCT FROM '22222222-2222-2222-2222-222222222222'::uuid THEN
    RAISE EXCEPTION 'ROTEAMENTO QUEBRADO: instancia_do_B resolveu para % (esperado tenant B)', v_rot;
  END IF;
  SELECT count(*) INTO v_linhas FROM integrations WHERE provider = 'stevo';
  IF v_linhas <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[stevo]: tenant A leu % integração(ões) de B', v_linhas; END IF;
  SELECT count(*) INTO v_segredo FROM integrations WHERE credentials_encrypted = 'SEGREDO_DE_B';
  IF v_segredo <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[stevo]: credencial de B legível por A'; END IF;
  RAISE NOTICE 'OK roteamento STEVO: só o tenant_id atravessa; a linha de B segue invisível';
END $$;

-- 9. CRM F2 (migration 009): empresas, tarefas, notas e páginas do B invisíveis para o A
DO $$
DECLARE v_emp int; v_tar int; v_not int; v_pag int;
BEGIN
  SELECT count(*) INTO v_emp FROM companies WHERE nome = 'Empresa Secreta do B';
  IF v_emp <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[companies]: tenant A leu % empresa(s) de B', v_emp; END IF;
  SELECT count(*) INTO v_tar FROM tasks WHERE titulo = 'TAREFA_SECRETA_DO_B';
  IF v_tar <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[tasks]: tenant A leu % tarefa(s) de B', v_tar; END IF;
  SELECT count(*) INTO v_not FROM notes WHERE corpo = 'NOTA_SECRETA_DO_B';
  IF v_not <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[notes]: tenant A leu % nota(s) de B', v_not; END IF;
  SELECT count(*) INTO v_pag FROM meta_pages WHERE page_id = 'PAGE_DO_B';
  IF v_pag <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[meta_pages]: tenant A leu % página(s) de B', v_pag; END IF;
  RAISE NOTICE 'OK isolamento CRM F2: companies, tasks, notes e meta_pages isolados';
END $$;

-- 10. Escrita cross-tenant nas tabelas novas também é barrada
DO $$
BEGIN
  BEGIN
    INSERT INTO companies (tenant_id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'EMPRESA_FORJADA_NO_B');
    RAISE EXCEPTION 'VAZAMENTO[write companies]: tenant A inseriu empresa no tenant B';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'OK write-guard F2: insercao cross-tenant em companies bloqueada';
  END;
END $$;

-- 11. Roteamento de Lead Ads (migration 009): só o tenant_id atravessa
DO $$
DECLARE v_rot uuid;
BEGIN
  SELECT resolve_tenant_by_meta_page('PAGE_DO_B') INTO v_rot;
  IF v_rot IS DISTINCT FROM '22222222-2222-2222-2222-222222222222'::uuid THEN
    RAISE EXCEPTION 'ROTEAMENTO QUEBRADO: PAGE_DO_B resolveu para % (esperado tenant B)', v_rot;
  END IF;
  RAISE NOTICE 'OK roteamento Meta: page->tenant resolve sem expor a linha';
END $$;

-- 12. Automações (migration 010): workflow, versão, run, log e DLQ do B invisíveis
--     O grafo do B é propriedade intelectual do cliente; o estado do run tem dado
--     de contato. Vazar aqui é tão grave quanto vazar o CRM.
DO $$
DECLARE v_wf int; v_ver int; v_run int; v_step int; v_dlq int;
BEGIN
  SELECT count(*) INTO v_wf FROM workflows WHERE nome = 'WORKFLOW_SECRETO_DO_B';
  IF v_wf <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflows]: tenant A leu % workflow(s) de B', v_wf; END IF;
  SELECT count(*) INTO v_ver FROM workflow_versions WHERE workflow_id = 'ffffffff-0000-4000-8000-00000000000b';
  IF v_ver <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_versions]: tenant A leu o GRAFO de B'; END IF;
  SELECT count(*) INTO v_run FROM workflow_runs WHERE estado::text LIKE '%ESTADO_SECRETO_DO_B%';
  IF v_run <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_runs]: tenant A leu o estado de execução de B'; END IF;
  SELECT count(*) INTO v_step FROM workflow_run_steps WHERE saida::text LIKE '%MENSAGEM_SECRETA_DO_B%';
  IF v_step <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_run_steps]: tenant A leu o log nó-a-nó de B'; END IF;
  SELECT count(*) INTO v_dlq FROM workflow_dlq WHERE erro = 'ERRO_SECRETO_DO_B';
  IF v_dlq <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[workflow_dlq]: tenant A leu o DLQ de B'; END IF;
  RAISE NOTICE 'OK isolamento automações: workflows, versões, runs, steps e DLQ isolados';
END $$;

-- 13. Escrita cross-tenant em workflows também é barrada
DO $$
BEGIN
  BEGIN
    INSERT INTO workflows (tenant_id, nome) VALUES ('22222222-2222-2222-2222-222222222222', 'WORKFLOW_FORJADO_NO_B');
    RAISE EXCEPTION 'VAZAMENTO[write workflows]: tenant A criou workflow no tenant B';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'OK write-guard automações: insercao cross-tenant bloqueada';
  END;
END $$;

-- 14. Nyro (migration 013): conversa, mensagem, ação, memória e custo do B invisíveis
DO $$
DECLARE v_conv int; v_msg int; v_act int; v_mem int; v_uso int;
BEGIN
  SELECT count(*) INTO v_conv FROM nyro_conversations WHERE titulo = 'CONVERSA_SECRETA_DO_B';
  IF v_conv <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[nyro_conversations]: tenant A leu conversa da Nyro de B'; END IF;
  SELECT count(*) INTO v_msg FROM nyro_messages WHERE conteudo = 'MENSAGEM_NYRO_SECRETA_DO_B';
  IF v_msg <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[nyro_messages]: tenant A leu mensagem da Nyro de B'; END IF;
  SELECT count(*) INTO v_act FROM nyro_actions WHERE resumo = 'ACAO_SECRETA_DO_B';
  IF v_act <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[nyro_actions]: tenant A leu ação pendente de B'; END IF;
  SELECT count(*) INTO v_mem FROM nyro_memory WHERE valor = 'MEMORIA_SECRETA_DO_B';
  IF v_mem <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[nyro_memory]: tenant A leu a memória da conta de B'; END IF;
  SELECT count(*) INTO v_uso FROM ai_usage_events WHERE custo_usd = 9.99;
  IF v_uso <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[ai_usage_events]: tenant A leu o custo de IA de B'; END IF;
  RAISE NOTICE 'OK isolamento Nyro: conversas, mensagens, ações, memória e custo isolados';
END $$;

-- 15. PARTIÇÕES (BUG-014): a RLS da tabela-pai NÃO protege a partição acessada
--     direto. Sem policy na partição, `SELECT * FROM ad_insights_default` devolve
--     linha de todo mundo — e a app deixa de ser 2ª camada para virar a única.
DO $$
DECLARE v_part int; v_sem_rls int;
BEGIN
  SELECT count(*) INTO v_part FROM ad_insights_default WHERE external_ref_id = 'acc_B';
  IF v_part <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[partição]: tenant A leu % linha(s) de B lendo ad_insights_default direto', v_part; END IF;

  -- guarda para partição FUTURA nascer sem policy (o `default` cobre o range novo)
  SELECT count(*) INTO v_sem_rls
  FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid JOIN pg_class pai ON pai.oid = i.inhparent
  WHERE pai.relname = 'ad_insights' AND c.relkind IN ('r','p') AND NOT c.relrowsecurity;
  IF v_sem_rls <> 0 THEN RAISE EXCEPTION 'RISCO: % partição(ões) de ad_insights sem RLS — rodar db/014', v_sem_rls; END IF;

  RAISE NOTICE 'OK partições: RLS aplicada e sem vazamento pela partição';
END $$;

-- 16. BILLING DA PLATAFORMA (migration 028): stripe_customer_id é dado
--     sensível (identifica a conta de pagamento do tenant na Stripe) — vazar
--     é tão grave quanto vazar uma credencial de integração.
DO $$
DECLARE v_sub int; v_write int;
BEGIN
  SELECT count(*) INTO v_sub FROM subscriptions WHERE stripe_customer_id = 'cus_SEGREDO_DO_B';
  IF v_sub <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[subscriptions]: tenant A leu % assinatura(s) de B', v_sub; END IF;

  UPDATE subscriptions SET plano = 'scale' WHERE stripe_customer_id = 'cus_SEGREDO_DO_B';
  GET DIAGNOSTICS v_write = ROW_COUNT;
  IF v_write <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[write subscriptions]: tenant A alterou a assinatura de B'; END IF;
  RAISE NOTICE 'OK write-guard billing: UPDATE cross-tenant em subscriptions não afetou nenhuma linha';

  RAISE NOTICE 'OK isolamento billing: subscriptions isolada (stripe_customer_id de B invisível para A)';
END $$;

-- 17. AGENTES (migration 030 · Sprint AG): o prompt e o histórico de execução
--     do agente de B são dado do cliente — vazar o prompt é vazar o playbook
--     comercial; vazar o run é vazar conversa com lead.
DO $$
DECLARE v_ag int; v_run int; v_upd int;
BEGIN
  SELECT count(*) INTO v_ag FROM agents WHERE nome = 'AGENTE_SECRETO_DO_B' OR instrucoes = 'PROMPT_SECRETO_DO_B';
  IF v_ag <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agents]: tenant A leu o agente (prompt) de B'; END IF;
  SELECT count(*) INTO v_run FROM agent_runs WHERE motivo = 'RUN_SECRETO_DO_B';
  IF v_run <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[agent_runs]: tenant A leu execução de agente de B'; END IF;

  UPDATE agents SET status = 'pausado' WHERE id = 'ad000000-0000-4000-8000-00000000000b';
  GET DIAGNOSTICS v_upd = ROW_COUNT;
  IF v_upd <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[write agents]: tenant A pausou o agente de B'; END IF;

  -- Escrever agente no tenant B: barrado pelo WITH CHECK da policy.
  BEGIN
    INSERT INTO agents (tenant_id, nome, modelo) VALUES ('22222222-2222-2222-2222-222222222222', 'INTRUSO', 'claude-opus-5-5');
    RAISE EXCEPTION 'VAZAMENTO[write agents]: tenant A criou agente no tenant B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- Apontar uma conversa de A para o agente de B: barrado pelo tenant_reference.
  BEGIN
    INSERT INTO conversations (tenant_id, nome, atendimento, agent_id)
    VALUES ('11111111-1111-1111-1111-111111111111', 'Conversa de A', 'ia', 'ad000000-0000-4000-8000-00000000000b');
    RAISE EXCEPTION 'VAZAMENTO[ref agents]: conversa de A aceitou o agente de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  RAISE NOTICE 'OK isolamento agentes: agents/agent_runs isolados; escrita e referência cross-tenant barradas';
END $$;

-- 18. Escrita de chunks do RAG (db/033 · BUG-022): A indexa a PRÓPRIA base;
--     não grava chunk no tenant B, na base global, nem pendurado em documento de B.
DO $$
DECLARE v_doc_a uuid; v_doc_b uuid; v_doc_g uuid; v_n int;
BEGIN
  SELECT id INTO v_doc_a FROM rag_documents WHERE titulo = 'DOC_A';
  SELECT document_id INTO v_doc_g FROM rag_chunks WHERE conteudo LIKE '%global publico%';
  RESET ROLE;  -- só para descobrir o id do documento de B (invisível a A)
  SELECT id INTO v_doc_b FROM rag_documents WHERE titulo = 'DOC_B';
  SET LOCAL ROLE khub_app;

  INSERT INTO rag_chunks (document_id, tenant_id, escopo, nicho, ordem, conteudo, status)
  VALUES (v_doc_a, '11111111-1111-1111-1111-111111111111', 'tenant', 'medico', 1, 'chunk novo de A', 'published');

  BEGIN
    INSERT INTO rag_chunks (document_id, tenant_id, escopo, nicho, ordem, conteudo, status)
    VALUES (v_doc_b, '22222222-2222-2222-2222-222222222222', 'tenant', 'juridico', 9, 'FORJADO_EM_B', 'published');
    RAISE EXCEPTION 'VAZAMENTO[write rag_chunks]: tenant A gravou chunk no tenant B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO rag_chunks (document_id, tenant_id, escopo, nicho, ordem, conteudo, status)
    VALUES (v_doc_b, '11111111-1111-1111-1111-111111111111', 'tenant', 'medico', 9, 'PENDURADO_NO_DOC_DE_B', 'published');
    RAISE EXCEPTION 'VAZAMENTO[write rag_chunks]: chunk de A aceito no documento de B';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  BEGIN
    INSERT INTO rag_chunks (document_id, tenant_id, escopo, ordem, conteudo, status)
    VALUES (v_doc_g, NULL, 'global', 9, 'FORJADO_NA_GLOBAL', 'published');
    RAISE EXCEPTION 'VAZAMENTO[write rag_chunks]: tenant A gravou na base global';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  DELETE FROM rag_chunks WHERE escopo = 'global' OR conteudo LIKE '%bravo%';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete rag_chunks]: tenant A apagou % chunk(s) alheio(s)', v_n; END IF;

  RAISE NOTICE 'OK RAG write: A indexa a propria base; escrita em B, na global e em doc de B barradas';
END $$;

RESET ROLE;
ROLLBACK;  -- teste não deixa resíduo

\echo '============================================'
\echo ' R0.2 OK — nenhum vazamento cross-tenant.'
\echo '============================================'

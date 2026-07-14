-- =====================================================================
-- ORVYN · Nyro IA — Teste de isolamento cross-tenant do RAG (R0.2)
-- BLOQUEANTE no CI. Em qualquer vazamento faz RAISE EXCEPTION -> exit != 0.
--
-- Rodar:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002_isolation_test.sql
-- O runner deve ser superuser OU membro de orvyn_service e orvyn_app
-- (no Postgres do docker-compose o usuário 'postgres' já é superuser).
--
-- O teste semeia dados como orvyn_service (BYPASSRLS), depois atua como
-- orvyn_app (NOBYPASSRLS) com app.current_tenant_id = A e prova que:
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
SET LOCAL ROLE orvyn_service;

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

-- ---------- ACT + ASSERT (como aplicação, tenant = A) ----------
SET LOCAL ROLE orvyn_app;
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

RESET ROLE;
ROLLBACK;  -- teste não deixa resíduo

\echo '============================================'
\echo ' R0.2 OK — nenhum vazamento cross-tenant.'
\echo '============================================'

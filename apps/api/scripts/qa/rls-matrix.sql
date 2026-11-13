-- QA Sprint 0: matriz de isolamento RLS. Rodar COMO khub_app (NOBYPASSRLS), nunca superuser.
-- Self-cleaning (ROLLBACK). Falha (exit != 0) se houver qualquer vazamento ou se um controle positivo falhar.
--   PGPASSWORD=... psql -h 127.0.0.1 -p 55440 -U khub_app -d orvyn_qa -v ON_ERROR_STOP=1 -f rls-matrix.sql
BEGIN;
CREATE TEMP TABLE qa_rows (tbl text, tenant text, id uuid);
CREATE TEMP TABLE qa_result (tbl text, test text, ok boolean, detail text);

DO $$
DECLARE
  t record; tenants text[] := ARRAY['A1','A2','B1']; ids jsonb := '{}'::jsonb; tid uuid; k text; rid uuid;
  pl uuid; st uuid; cv uuid; integ uuid; n int;
  tbls text[] := ARRAY['contacts','deals','conversations','messages','workflows','crm_tags','agenda_compromissos','outbox_events','financeiro_cobrancas','tasks','notes','meta_pages','pipelines'];
  tb text; other text; cnt int; blocked boolean; why text;
BEGIN
  -- tenants (khub_app tem INSERT em tenants)
  FOREACH k IN ARRAY tenants LOOP
    INSERT INTO tenants(nome) VALUES ('QA-'||k) RETURNING id INTO tid;
    ids := ids || jsonb_build_object(k, tid);
  END LOOP;

  -- seeds por tenant, SEMPRE com o contexto do próprio tenant (como a aplicação faz)
  FOREACH k IN ARRAY tenants LOOP
    tid := (ids->>k)::uuid;
    PERFORM set_config('app.current_tenant_id', tid::text, true);
    INSERT INTO contacts(tenant_id,nome) VALUES (tid,'c-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('contacts',k,rid);
    INSERT INTO pipelines(tenant_id,nome) VALUES (tid,'p-'||k) RETURNING id INTO pl; INSERT INTO qa_rows VALUES ('pipelines',k,pl);
    INSERT INTO stages(tenant_id,pipeline_id,nome,ordem) VALUES (tid,pl,'s-'||k,1) RETURNING id INTO st;
    INSERT INTO deals(tenant_id,titulo,pipeline_id,stage_id) VALUES (tid,'d-'||k,pl,st) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('deals',k,rid);
    INSERT INTO conversations(tenant_id,nome) VALUES (tid,'cv-'||k) RETURNING id INTO cv; INSERT INTO qa_rows VALUES ('conversations',k,cv);
    INSERT INTO messages(tenant_id,conversation_id,corpo) VALUES (tid,cv,'m-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('messages',k,rid);
    INSERT INTO workflows(tenant_id,nome) VALUES (tid,'w-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('workflows',k,rid);
    INSERT INTO crm_tags(tenant_id,name) VALUES (tid,'t-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('crm_tags',k,rid);
    INSERT INTO agenda_compromissos(tenant_id,titulo,inicio,fim) VALUES (tid,'a-'||k,now(),now()+interval '1 hour') RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('agenda_compromissos',k,rid);
    INSERT INTO outbox_events(tenant_id,kind,payload,dedupe_key) VALUES (tid,'qa.test','{}'::jsonb,'qa-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('outbox_events',k,rid);
    INSERT INTO financeiro_cobrancas(tenant_id,descricao,valor_centavos) VALUES (tid,'f-'||k,100) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('financeiro_cobrancas',k,rid);
    INSERT INTO tasks(tenant_id,titulo) VALUES (tid,'tk-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('tasks',k,rid);
    INSERT INTO notes(tenant_id,corpo) VALUES (tid,'n-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('notes',k,rid);
    INSERT INTO integrations(tenant_id,provider) VALUES (tid,'meta') RETURNING id INTO integ;
    INSERT INTO meta_pages(tenant_id,integration_id,page_id) VALUES (tid,integ,'pg-qa-'||k) RETURNING id INTO rid; INSERT INTO qa_rows VALUES ('meta_pages',k,rid);
  END LOOP;

  -- testes
  FOREACH tb IN ARRAY tbls LOOP
    -- controle positivo: A1 enxerga a própria linha
    PERFORM set_config('app.current_tenant_id', ids->>'A1', true);
    EXECUTE format('SELECT count(*) FROM %I WHERE id=(SELECT id FROM qa_rows WHERE tbl=%L AND tenant=%L)', tb, tb, 'A1') INTO cnt;
    INSERT INTO qa_result VALUES (tb,'controle positivo (próprio tenant lê)', cnt=1, 'count='||cnt);

    FOREACH other IN ARRAY ARRAY['A2','B1'] LOOP
      PERFORM set_config('app.current_tenant_id', ids->>other, true);
      EXECUTE format('SELECT count(*) FROM %I WHERE id=(SELECT id FROM qa_rows WHERE tbl=%L AND tenant=%L)', tb, tb, 'A1') INTO cnt;
      INSERT INTO qa_result VALUES (tb,'SELECT cruzado '||other||'->A1', cnt=0, 'count='||cnt);
      why := '';
      BEGIN
        EXECUTE format('UPDATE %I SET tenant_id=tenant_id WHERE id=(SELECT id FROM qa_rows WHERE tbl=%L AND tenant=%L)', tb, tb, 'A1');
        GET DIAGNOSTICS cnt = ROW_COUNT;
      EXCEPTION WHEN insufficient_privilege THEN cnt := 0; why := ' (bloqueado por GRANT)'; END;
      INSERT INTO qa_result VALUES (tb,'UPDATE cruzado '||other||'->A1', cnt=0, 'rows='||cnt||why);
      why := '';
      BEGIN
        EXECUTE format('DELETE FROM %I WHERE id=(SELECT id FROM qa_rows WHERE tbl=%L AND tenant=%L)', tb, tb, 'A1');
        GET DIAGNOSTICS cnt = ROW_COUNT;
      EXCEPTION WHEN insufficient_privilege THEN cnt := 0; why := ' (bloqueado por GRANT)'; END;
      INSERT INTO qa_result VALUES (tb,'DELETE cruzado '||other||'->A1', cnt=0, 'rows='||cnt||why);
    END LOOP;

    -- sem contexto de tenant: nada visível
    PERFORM set_config('app.current_tenant_id', '', true);
    EXECUTE format('SELECT count(*) FROM %I', tb) INTO cnt;
    INSERT INTO qa_result VALUES (tb,'SELECT sem contexto', cnt=0, 'count='||cnt);

    -- controle positivo final: a linha de A1 ainda existe (nenhum DELETE cruzado passou)
    PERFORM set_config('app.current_tenant_id', ids->>'A1', true);
    EXECUTE format('SELECT count(*) FROM %I WHERE id=(SELECT id FROM qa_rows WHERE tbl=%L AND tenant=%L)', tb, tb, 'A1') INTO cnt;
    INSERT INTO qa_result VALUES (tb,'linha de A1 intacta após ataques', cnt=1, 'count='||cnt);
  END LOOP;

  -- INSERT com tenant_id alheio (WITH CHECK): contexto B1, linha marcada como A1
  PERFORM set_config('app.current_tenant_id', ids->>'B1', true);
  tid := (ids->>'A1')::uuid;
  blocked := false; BEGIN INSERT INTO contacts(tenant_id,nome) VALUES (tid,'invasor'); EXCEPTION WHEN OTHERS THEN blocked := true; END;
  INSERT INTO qa_result VALUES ('contacts','INSERT B1 com tenant_id=A1 bloqueado', blocked, '');
  blocked := false; BEGIN INSERT INTO crm_tags(tenant_id,name) VALUES (tid,'invasor'); EXCEPTION WHEN OTHERS THEN blocked := true; END;
  INSERT INTO qa_result VALUES ('crm_tags','INSERT B1 com tenant_id=A1 bloqueado', blocked, '');
  blocked := false; BEGIN INSERT INTO outbox_events(tenant_id,kind,payload,dedupe_key) VALUES (tid,'qa.invasor','{}'::jsonb,'inv'); EXCEPTION WHEN OTHERS THEN blocked := true; END;
  INSERT INTO qa_result VALUES ('outbox_events','INSERT B1 com tenant_id=A1 bloqueado', blocked, '');
  blocked := false; BEGIN INSERT INTO financeiro_cobrancas(tenant_id,descricao,valor_centavos) VALUES (tid,'invasor',1); EXCEPTION WHEN OTHERS THEN blocked := true; END;
  INSERT INTO qa_result VALUES ('financeiro_cobrancas','INSERT B1 com tenant_id=A1 bloqueado', blocked, '');
  -- UPDATE tentando MOVER linha própria para outro tenant (WITH CHECK)
  blocked := false; BEGIN UPDATE contacts SET tenant_id=tid WHERE id=(SELECT id FROM qa_rows WHERE tbl='contacts' AND tenant='B1'); EXCEPTION WHEN OTHERS THEN blocked := true; END;
  INSERT INTO qa_result VALUES ('contacts','UPDATE move linha de B1 para A1 bloqueado', blocked, '');
END $$;

SELECT tbl, test, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS resultado, detail FROM qa_result WHERE NOT ok ORDER BY tbl, test;
SELECT count(*) FILTER (WHERE ok) AS pass, count(*) FILTER (WHERE NOT ok) AS fail, count(*) AS total FROM qa_result;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM qa_result WHERE NOT ok) THEN RAISE EXCEPTION 'RLS MATRIX: vazamento ou controle positivo falhou'; END IF; END $$;
ROLLBACK;

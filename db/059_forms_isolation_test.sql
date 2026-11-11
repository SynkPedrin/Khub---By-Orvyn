-- =====================================================================
-- Formulários — teste de isolamento cross-tenant (db/059)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/059_forms_isolation_test.sql
-- (o migrador ignora arquivos *_test.sql). Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão, nenhum form/envio é visível;
--   2. A não lê, não altera e não apaga form nem envio de B;
--   3. INSERT com tenant_id de B é barrado (WITH CHECK);
--   4. form de A apontando para etapa de B, e envio de A apontando para
--      contato/form de B, são barrados (tenant_reference);
--   5. resolve_form_by_slug devolve o tenant DONO do slug e ignora form inativo;
--   6. slug é único entre tenants (A não sequestra a URL de B).
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000059', 'TENANT_A_FORM'),
  ('b2b2b2b2-0000-4000-8000-000000000059', 'TENANT_B_FORM');
INSERT INTO contacts (id, tenant_id, nome) VALUES
  ('ca000000-0000-4000-8000-00000000059a', 'a1a1a1a1-0000-4000-8000-000000000059', 'Contato A'),
  ('cb000000-0000-4000-8000-00000000059b', 'b2b2b2b2-0000-4000-8000-000000000059', 'CONTATO_SECRETO_B');
INSERT INTO pipelines (id, tenant_id, nome) VALUES
  ('fb000000-0000-4000-8000-00000000059b', 'b2b2b2b2-0000-4000-8000-000000000059', 'Funil B');
INSERT INTO stages (id, tenant_id, pipeline_id, nome, ordem) VALUES
  ('eb000000-0000-4000-8000-00000000059b', 'b2b2b2b2-0000-4000-8000-000000000059', 'fb000000-0000-4000-8000-00000000059b', 'Etapa B', 0);
INSERT INTO forms (id, tenant_id, nome, slug) VALUES
  ('f0b00000-0000-4000-8000-00000000059b', 'b2b2b2b2-0000-4000-8000-000000000059', 'FORM_SECRETO_B', 'form-secreto-b-059'),
  ('f0b00000-0000-4000-8000-00000000059c', 'b2b2b2b2-0000-4000-8000-000000000059', 'Inativo B', 'form-inativo-b-059');
UPDATE forms SET ativo = false WHERE id = 'f0b00000-0000-4000-8000-00000000059c';
INSERT INTO forms (id, tenant_id, nome, slug) VALUES
  ('f0a00000-0000-4000-8000-00000000059a', 'a1a1a1a1-0000-4000-8000-000000000059', 'Form A', 'form-a-059');
INSERT INTO form_submissions (id, tenant_id, form_id, contact_id, respostas) VALUES
  ('5b000000-0000-4000-8000-00000000059b', 'b2b2b2b2-0000-4000-8000-000000000059', 'f0b00000-0000-4000-8000-00000000059b',
   'cb000000-0000-4000-8000-00000000059b', '{"email":"segredo@b.com"}'),
  ('5a000000-0000-4000-8000-00000000059a', 'a1a1a1a1-0000-4000-8000-000000000059', 'f0a00000-0000-4000-8000-00000000059a',
   'ca000000-0000-4000-8000-00000000059a', '{"email":"a@a.com"}');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t uuid;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM forms;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[forms sem tenant]: % linha(s)', n; END IF;
  SELECT count(*) INTO n FROM form_submissions;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[form_submissions sem tenant]: % linha(s)', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000059', true);
  SELECT count(*) INTO n FROM forms WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000059' OR nome = 'FORM_SECRETO_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[forms]: A leu % form(s) de B', n; END IF;
  SELECT count(*) INTO n FROM form_submissions WHERE respostas::text LIKE '%segredo@b.com%';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[form_submissions]: A leu % envio(s) de B', n; END IF;
  SELECT count(*) INTO n FROM form_submissions;
  IF n <> 1 THEN RAISE EXCEPTION 'FALHA[form_submissions]: esperava 1 envio de A, veio %', n; END IF;

  UPDATE forms SET nome = 'HACK' WHERE id = 'f0b00000-0000-4000-8000-00000000059b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update forms]: A alterou form de B'; END IF;
  DELETE FROM form_submissions WHERE id = '5b000000-0000-4000-8000-00000000059b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete form_submissions]: A apagou envio de B'; END IF;

  BEGIN
    INSERT INTO forms (tenant_id, nome, slug) VALUES ('b2b2b2b2-0000-4000-8000-000000000059', 'FORJADO', 'forjado-em-b-059');
    RAISE EXCEPTION 'VAZAMENTO[write forms]: A gravou form no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO forms (tenant_id, nome, slug, stage_id) VALUES ('a1a1a1a1-0000-4000-8000-000000000059', 'Ref', 'ref-cruzada-059', 'eb000000-0000-4000-8000-00000000059b');
    RAISE EXCEPTION 'VAZAMENTO[ref forms]: form de A apontou para etapa de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO form_submissions (tenant_id, form_id, contact_id) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000059', 'f0a00000-0000-4000-8000-00000000059a', 'cb000000-0000-4000-8000-00000000059b');
    RAISE EXCEPTION 'VAZAMENTO[ref form_submissions]: envio de A apontou para contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO form_submissions (tenant_id, form_id) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000059', 'f0b00000-0000-4000-8000-00000000059b');
    RAISE EXCEPTION 'VAZAMENTO[ref form_submissions]: envio de A apontou para form de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO forms (tenant_id, nome, slug) VALUES ('a1a1a1a1-0000-4000-8000-000000000059', 'Sequestro', 'form-secreto-b-059');
    RAISE EXCEPTION 'FALHA[slug]: A reutilizou o slug de B';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- Resolução pública: sem tenant na sessão, a função acha o dono certo.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT tenant_id INTO t FROM resolve_form_by_slug('form-secreto-b-059');
  IF t IS DISTINCT FROM 'b2b2b2b2-0000-4000-8000-000000000059'::uuid THEN RAISE EXCEPTION 'FALHA[resolve]: slug de B resolveu para %', t; END IF;
  SELECT count(*) INTO n FROM resolve_form_by_slug('form-inativo-b-059');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[resolve]: form inativo resolveu'; END IF;
  SELECT count(*) INTO n FROM resolve_form_by_slug('nao-existe-059');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[resolve]: slug inexistente resolveu'; END IF;
  -- A função não abre a tabela: sem tenant, forms continua invisível.
  SELECT count(*) INTO n FROM forms;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[forms após resolve]: % linha(s)', n; END IF;

  RAISE NOTICE 'PASS 059 forms: isolamento, referências, slug e resolução pública OK';
END $$;

ROLLBACK;

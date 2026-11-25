-- 084: corrige o acesso a links_rastreados (db/080).
--
-- A 080 concedia a orvyn_app/orvyn_service, papéis renomeados para khub_* na
-- db/035. Em produção a tabela foi criada sem GRANT para khub_app (papel de
-- runtime da API): a aba "Links rastreados" respondia erro e a busca de link na
-- primeira mensagem de contato novo não tinha permissão.
--
-- Idempotente: concede só aos papéis que existem. Não toca em dados.
DO $$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON links_rastreados TO %I', r);
  END IF;
 END LOOP;
END $$;

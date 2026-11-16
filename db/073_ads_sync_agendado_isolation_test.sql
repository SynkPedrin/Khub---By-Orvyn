-- =====================================================================
-- Sync agendado de anúncios (db/073): teste de isolamento cross-tenant
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/073_ads_sync_agendado_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. sem tenant na sessão, SELECT direto em integrations não vê nada (RLS intacta);
--   2. ads_integracoes_para_sync enxerga cross-tenant SÓ o necessário:
--      conectadas COM credencial (pendente e sem credencial ficam de fora);
--   3. provider fora da lista pedida não aparece.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000073', 'TENANT_A_ADSYNC'),
  ('b2b2b2b2-0000-4000-8000-000000000073', 'TENANT_B_ADSYNC');
INSERT INTO integrations (tenant_id, provider, status, credentials_encrypted) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000073', 'meta', 'connected', 'enc-ok-a'),
  ('b2b2b2b2-0000-4000-8000-000000000073', 'meta', 'connected', 'enc-ok-b'),
  ('a1a1a1a1-0000-4000-8000-000000000073', 'meta', 'pending', 'enc-pendente'),
  ('b2b2b2b2-0000-4000-8000-000000000073', 'meta', 'connected', NULL);

SET LOCAL ROLE khub_app;
DO $$ DECLARE n int; BEGIN
  -- (1) RLS intacta: sem tenant, nada de SELECT direto.
  SELECT count(*) INTO n FROM integrations;
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[rls]: SELECT direto vazou % linha(s) sem tenant', n; END IF;

  -- (2) A função devolve exatamente as 2 aptas (conectadas com credencial), cross-tenant.
  SELECT count(*) INTO n FROM ads_integracoes_para_sync(ARRAY['meta']);
  IF n <> 2 THEN RAISE EXCEPTION 'FALHA[aptas]: esperava 2 integrações aptas, veio %', n; END IF;
  SELECT count(*) INTO n FROM ads_integracoes_para_sync(ARRAY['meta'])
   WHERE tenant_id NOT IN ('a1a1a1a1-0000-4000-8000-000000000073', 'b2b2b2b2-0000-4000-8000-000000000073');
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[escopo]: vazou integração de fora do cenário'; END IF;

  -- (3) Provider fora da lista não aparece.
  SELECT count(*) INTO n FROM ads_integracoes_para_sync(ARRAY['google_ads']);
  IF n <> 0 THEN RAISE EXCEPTION 'FALHA[provider]: filtro de provider ignorado'; END IF;

  RAISE NOTICE '073 OK — agendador enxerga só (tenant, integração) aptas; RLS de integrations intacta.';
END $$;

ROLLBACK;

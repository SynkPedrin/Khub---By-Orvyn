-- 073_ads_sync_agendado.sql — sync periódico de anúncios (agendador 6h no worker).
--
-- O agendador roda para TODOS os tenants de uma vez, sem app.current_tenant_id
-- na sessão. Como khub_app é NOBYPASSRLS, um SELECT direto em `integrations`
-- sem tenant devolve 0 linhas — não dá para descobrir o que sincronizar.
--
-- Solução (mesmo padrão de 008/019/024/072): UMA função SECURITY DEFINER que
-- expõe SOMENTE (tenant_id, integration_id) das integrações conectadas com
-- credencial — nenhum dado de negócio atravessa. Depois o worker entra em
-- withTenant(tenantId) por integração e tudo volta a passar pela RLS.
-- Idempotente.

BEGIN;

CREATE OR REPLACE FUNCTION ads_integracoes_para_sync(p_providers TEXT[])
RETURNS TABLE (tenant_id UUID, integration_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.tenant_id, i.id
  FROM integrations i
  WHERE i.provider = ANY(p_providers)
    AND i.status = 'connected'
    AND i.credentials_encrypted IS NOT NULL;
$$;

-- Papéis: `khub_*` no QA/produção, `orvyn_*` no dev (mesmo padrão da db/070/072).
DO $$ DECLARE r text; dono text; BEGIN
  SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service', 'orvyn_service')
   ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
  IF dono IS NULL THEN RAISE EXCEPTION 'papel de serviço ausente (db/000)'; END IF;
  EXECUTE format('ALTER FUNCTION ads_integracoes_para_sync(TEXT[]) OWNER TO %I', dono);
  REVOKE ALL ON FUNCTION ads_integracoes_para_sync(TEXT[]) FROM PUBLIC;

  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION ads_integracoes_para_sync(TEXT[]) TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

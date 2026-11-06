-- =====================================================================
-- 032_stevo_api_routing.sql — roteamento do webhook de CONTA da Stevo (API de
-- gestão, https://openapi.stevo.chat/v1): instância Stevo → tenant.
--
-- Mesmo padrão de 008 (stevo) e 024 (evolution). O webhook de conta é público
-- e chega sem tenant; a app roda como orvyn_app (NOBYPASSRLS), então sem esta
-- função não há como achar o dono da instância. A função SECURITY DEFINER
-- devolve SOMENTE o tenant_id — nenhum dado de negócio atravessa. Depois disso
-- a app entra em withTenant(tenantId) e a RLS volta a valer.
--
-- Vínculo = linha em `integrations` com provider 'stevo_api' e
-- external_business_id = id (uuid) da instância na Stevo. Status:
--   connected | disconnected  → vínculo ativo (eventos roteados)
--   revoked                   → vínculo desfeito (eventos ignorados)
--
-- ADITIVA e idempotente. Rollback:
--   DROP FUNCTION IF EXISTS resolve_tenant_by_stevo_api_instance(TEXT);
--   DROP INDEX IF EXISTS uq_stevo_api_instance_ativa;
-- =====================================================================

BEGIN;

-- Uma instância Stevo pertence a UM tenant enquanto o vínculo estiver ativo
-- (evita entregar a conversa de um cliente no inbox de outro).
CREATE UNIQUE INDEX IF NOT EXISTS uq_stevo_api_instance_ativa
  ON integrations (external_business_id)
  WHERE provider = 'stevo_api' AND status <> 'revoked' AND external_business_id IS NOT NULL;

CREATE OR REPLACE FUNCTION resolve_tenant_by_stevo_api_instance(p_instance TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.tenant_id
  FROM integrations i
  WHERE i.provider = 'stevo_api'
    AND i.status <> 'revoked'
    AND i.external_business_id = p_instance
  LIMIT 1;
$$;

ALTER FUNCTION resolve_tenant_by_stevo_api_instance(TEXT) OWNER TO orvyn_service;
REVOKE ALL ON FUNCTION resolve_tenant_by_stevo_api_instance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_stevo_api_instance(TEXT) TO orvyn_app;

COMMIT;

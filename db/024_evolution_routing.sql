-- 024_evolution_routing.sql — roteamento do webhook da Evolution API: instância → tenant.
-- Mesmo padrão de 008_stevo_routing.sql, para o provider 'evolution'. O webhook é
-- PÚBLICO e chega sem tenant; a app roda como orvyn_app (NOBYPASSRLS), então um
-- SELECT em `integrations` sem app.current_tenant_id devolve 0 linhas — não dá
-- para descobrir o dono da instância sem esta função.
--
-- Solução: função SECURITY DEFINER (owner = orvyn_service, BYPASSRLS) que expõe
-- SOMENTE o tenant_id de roteamento — nenhum dado de negócio atravessa. Depois
-- disso a app entra em withTenant(tenantId) e tudo volta a passar pela RLS.
-- Idempotente.

-- Uma instância Evolution conectada pertence a um único tenant (evita webhook
-- ambíguo entre dois tenants usando o mesmo nome de instância).
CREATE UNIQUE INDEX IF NOT EXISTS uq_evolution_instance_conectada
  ON integrations (external_business_id)
  WHERE provider = 'evolution' AND status = 'connected' AND external_business_id IS NOT NULL;

CREATE OR REPLACE FUNCTION resolve_tenant_by_evolution_instance(p_instance TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.tenant_id
  FROM integrations i
  WHERE i.provider = 'evolution'
    AND i.status = 'connected'
    AND i.external_business_id = p_instance
  LIMIT 1;
$$;

ALTER FUNCTION resolve_tenant_by_evolution_instance(TEXT) OWNER TO orvyn_service;
REVOKE ALL ON FUNCTION resolve_tenant_by_evolution_instance(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_tenant_by_evolution_instance(TEXT) TO orvyn_app;

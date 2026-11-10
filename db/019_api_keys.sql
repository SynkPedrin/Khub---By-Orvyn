-- 019_api_keys.sql — Private Integrations (chaves de API reais).
-- Um sistema externo autentica na API REST do Orvyn com uma chave própria,
-- escopada ao tenant. Guardamos só o HASH (sha256) — a chave em claro aparece
-- uma única vez, na criação. CRUD passa pela RLS do tenant (list/criar/revogar).
--
-- Desafio de RLS: a autenticação precisa DESCOBRIR o tenant a partir do hash,
-- antes de existir contexto de tenant. Fazer isso sob RLS com orvyn_app é
-- impossível (nenhum tenant setado). Resolvemos com UMA função SECURITY DEFINER,
-- dona = orvyn_service (BYPASSRLS), que só devolve (tenant_id, id) da chave ativa
-- que casa com o hash — nada além disso vaza. É o único caminho cross-tenant.
--
-- Aplicar:  node scripts/apply-sql.mjs db/019_api_keys.sql

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,                 -- exibição: "orv_live_ab12cd…"
  key_hash      TEXT NOT NULL UNIQUE,          -- sha256(hex) da chave completa
  scopes        TEXT[] NOT NULL DEFAULT '{*}', -- reservado p/ escopo fino (futuro)
  created_by    UUID,                          -- identity que criou
  last_used_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys (tenant_id);
-- ==SPLIT==
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
-- ==SPLIT==
ALTER TABLE api_keys FORCE  ROW LEVEL SECURITY;
-- ==SPLIT==
DROP POLICY IF EXISTS tenant_rw ON api_keys;
-- ==SPLIT==
CREATE POLICY tenant_rw ON api_keys FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- ==SPLIT==
GRANT SELECT, INSERT, UPDATE, DELETE ON api_keys TO orvyn_app, orvyn_service;
-- ==SPLIT==
-- Autenticação: devolve (tenant_id, id) da chave ativa que casa com o hash e
-- carimba last_used_at. SECURITY DEFINER + dona orvyn_service = bypassa RLS de
-- forma controlada, expondo só o par necessário para autenticar.
CREATE OR REPLACE FUNCTION auth_lookup_api_key(p_hash TEXT)
RETURNS TABLE (tenant_id UUID, key_id UUID)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  UPDATE api_keys
     SET last_used_at = now()
   WHERE key_hash = p_hash AND revoked_at IS NULL
  RETURNING tenant_id, id;
$fn$;
-- ==SPLIT==
ALTER FUNCTION auth_lookup_api_key(TEXT) OWNER TO orvyn_service;
-- ==SPLIT==
REVOKE ALL ON FUNCTION auth_lookup_api_key(TEXT) FROM PUBLIC;
-- ==SPLIT==
GRANT EXECUTE ON FUNCTION auth_lookup_api_key(TEXT) TO orvyn_app, orvyn_service;

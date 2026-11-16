-- 072_mcp_conector.sql — Conector MCP (Claude e ChatGPT) com OAuth 2.1 (ADR-0049).
--
-- Claude.ai e ChatGPT só conectam servidor MCP remoto por OAuth (com cadastro
-- dinâmico de cliente, RFC 7591, e PKCE). Três tabelas:
--
--  * mcp_clientes  — os aplicativos que se cadastraram (Claude, ChatGPT…). É um
--    registro da PLATAFORMA, não do tenant: o cadastro acontece antes de alguém
--    entrar na conta. Não guarda dado de cliente nenhum (nome do app + URLs de
--    retorno). Segredo, quando existe, só o hash.
--  * mcp_conexoes  — "o Claude do fulano pode agir na subconta X". Nasce quando
--    um dono/admin aprova na tela de consentimento. Revogar aqui derruba tudo.
--  * mcp_tokens    — código de autorização (5 min, uso único), token de acesso
--    (1 h) e de renovação (60 dias, rotativo). Só o hash (sha256).
--
-- RLS: conexões e tokens são do tenant (policy tenant_rw padrão). O servidor MCP
-- recebe só o token e precisa descobrir o tenant ANTES de ter contexto — mesmo
-- desafio da db/019 (api_keys), mesma solução: UMA função SECURITY DEFINER que
-- devolve só o necessário para autenticar.
--
-- Aplicar: cd apps/api && pnpm db:migrate

BEGIN;

CREATE TABLE IF NOT EXISTS mcp_clientes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id      TEXT NOT NULL UNIQUE,
  segredo_hash   TEXT,                           -- null = cliente público (PKCE)
  nome           TEXT NOT NULL,
  redirect_uris  TEXT[] NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS mcp_conexoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_id     UUID NOT NULL,                 -- quem autorizou; o MCP age como essa pessoa
  cliente_id      UUID NOT NULL REFERENCES mcp_clientes(id) ON DELETE CASCADE,
  nome_cliente    TEXT NOT NULL,
  escopos         TEXT[] NOT NULL DEFAULT '{khub}',
  ultimo_uso_em   TIMESTAMPTZ,
  revogada_em     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_conexoes_tenant ON mcp_conexoes (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS mcp_tokens (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexao_id      UUID NOT NULL REFERENCES mcp_conexoes(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('codigo', 'acesso', 'renovacao')),
  hash            TEXT NOT NULL UNIQUE,          -- sha256(hex) do token
  code_challenge  TEXT,                          -- PKCE S256 (só no código)
  redirect_uri    TEXT,                          -- só no código
  expira_em       TIMESTAMPTZ NOT NULL,
  usado_em        TIMESTAMPTZ,                   -- código/renovação são de uso único
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_conexao ON mcp_tokens (tenant_id, conexao_id);
CREATE INDEX IF NOT EXISTS idx_mcp_tokens_expira ON mcp_tokens (expira_em);

-- -------------------- RLS (padrão do projeto) -------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['mcp_conexoes','mcp_tokens'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_rw ON %I FOR ALL
         USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- O token pertence à conexão do MESMO tenant (defesa além da RLS).
CREATE OR REPLACE FUNCTION mcp_token_mesmo_tenant() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mcp_conexoes c WHERE c.id = NEW.conexao_id AND c.tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'conexão MCP de outro tenant' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS mcp_token_mesmo_tenant ON mcp_tokens;
CREATE TRIGGER mcp_token_mesmo_tenant BEFORE INSERT OR UPDATE ON mcp_tokens
  FOR EACH ROW EXECUTE FUNCTION mcp_token_mesmo_tenant();

-- Autenticação do MCP: recebe o hash e o tipo, devolve a conexão ativa.
-- Código e renovação são CONSUMIDOS aqui (uso único, atômico: duas trocas
-- simultâneas do mesmo código → só uma recebe linha). Acesso só é lido, e o
-- uso da conexão é carimbado no máximo uma vez por minuto.
CREATE OR REPLACE FUNCTION mcp_resolver_token(p_hash TEXT, p_tipo TEXT)
RETURNS TABLE (tenant_id UUID, conexao_id UUID, identity_id UUID, cliente_id UUID,
               code_challenge TEXT, redirect_uri TEXT, escopos TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF p_tipo IN ('codigo', 'renovacao') THEN
    RETURN QUERY
      WITH usado AS (
        UPDATE mcp_tokens t SET usado_em = now()
         WHERE t.hash = p_hash AND t.tipo = p_tipo AND t.usado_em IS NULL AND t.expira_em > now()
        RETURNING t.tenant_id, t.conexao_id, t.code_challenge, t.redirect_uri
      )
      SELECT u.tenant_id, u.conexao_id, c.identity_id, c.cliente_id, u.code_challenge, u.redirect_uri, c.escopos
        FROM usado u JOIN mcp_conexoes c ON c.id = u.conexao_id AND c.tenant_id = u.tenant_id
       WHERE c.revogada_em IS NULL;
  ELSIF p_tipo = 'acesso' THEN
    RETURN QUERY
      SELECT t.tenant_id, t.conexao_id, c.identity_id, c.cliente_id, NULL::TEXT, NULL::TEXT, c.escopos
        FROM mcp_tokens t JOIN mcp_conexoes c ON c.id = t.conexao_id AND c.tenant_id = t.tenant_id
       WHERE t.hash = p_hash AND t.tipo = 'acesso' AND t.expira_em > now() AND c.revogada_em IS NULL;
    UPDATE mcp_conexoes c SET ultimo_uso_em = now()
     WHERE c.id = (SELECT t.conexao_id FROM mcp_tokens t WHERE t.hash = p_hash AND t.tipo = 'acesso')
       AND (c.ultimo_uso_em IS NULL OR c.ultimo_uso_em < now() - interval '1 minute');
  END IF;
END $fn$;

-- Faxina: tokens vencidos há mais de 1 dia (chamada pelo próprio serviço).
CREATE OR REPLACE FUNCTION mcp_limpar_tokens() RETURNS INTEGER
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH apagados AS (DELETE FROM mcp_tokens WHERE expira_em < now() - interval '1 day' RETURNING 1)
  SELECT count(*)::int FROM apagados;
$fn$;

-- Papéis: `khub_*` no QA/produção, `orvyn_*` no dev (mesmo padrão da db/070).
DO $$ DECLARE r text; dono text; BEGIN
  SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service', 'orvyn_service')
   ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
  IF dono IS NULL THEN RAISE EXCEPTION 'papel de serviço ausente (db/000)'; END IF;
  EXECUTE format('ALTER FUNCTION mcp_resolver_token(TEXT, TEXT) OWNER TO %I', dono);
  EXECUTE format('ALTER FUNCTION mcp_limpar_tokens() OWNER TO %I', dono);
  REVOKE ALL ON FUNCTION mcp_resolver_token(TEXT, TEXT) FROM PUBLIC;
  REVOKE ALL ON FUNCTION mcp_limpar_tokens() FROM PUBLIC;

  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      -- cadastro de cliente: só ler e inserir (nunca alterar/apagar pela app)
      EXECUTE format('GRANT SELECT, INSERT ON mcp_clientes TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_conexoes TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON mcp_tokens TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION mcp_resolver_token(TEXT, TEXT) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION mcp_limpar_tokens() TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

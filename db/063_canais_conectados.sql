-- =====================================================================
-- 063_canais_conectados.sql — Conversas omnichannel: canais conectados por
-- rede (Instagram, Messenger, YouTube, TikTok) dentro de Conversas
--
-- Contexto (pedido do product owner, 2026-11-11): o Inbox real ganha o
-- desenho do mockup da LP (4 colunas, contagem por canal/status/etiqueta) e o
-- usuário conecta as redes dele de dentro de Conversas.
--
--  1. `channel_connections`: uma linha por conta de rede conectada pelo
--     tenant (página do Facebook = Messenger; conta profissional do Instagram
--     vinculada a uma página = Instagram; canal do YouTube). O token da conta
--     fica CIFRADO (AES-256-GCM, `CryptoService`, INTEGRATIONS_ENCRYPTION_KEY);
--     a API nunca devolve `credentials_encrypted`.
--     O WhatsApp NÃO entra aqui: continua em `integrations` (Stevo/Evolution,
--     ADR-0031/0032), sem reescrita.
--     `UNIQUE (rede, external_id)`: uma conta de rede pertence a um único
--     tenant. É o que permite ao webhook (público, sem tenant) achar o dono.
--  2. `resolve_tenant_by_canal(rede, external_id)`: SECURITY DEFINER, só o id
--     de roteamento atravessa (mesmo desenho de resolve_tenant_by_meta_page,
--     db/009). Só conexões com status 'conectado' roteiam.
--  3. `conversations.tipo` ('dm' | 'comentario'), `externo_id` (IGSID/PSID da
--     DM, ou id do comentário raiz) e `canal_conexao_id`: a mesma tabela de
--     conversas recebe DM e comentário, com o canal certo. Índice único
--     parcial (tenant, canal, externo_id) impede conversa duplicada por
--     reentrega do webhook ou por sincronização repetida.
--  4. `contexto_externo` (jsonb): de onde veio o comentário (post/mídia/vídeo)
--     para a tela mostrar "comentou no vídeo X". Nunca token.
--
-- Idempotência da ENTRADA: `webhook_events (provider, event_id)` com
-- provider `canal:<rede>` e event_id `<tenant>:<mid|comment_id>` (mesmo
-- padrão do WhatsApp). Nenhuma coluna nova em `messages`.
--
-- ADITIVA: uma tabela nova, colunas nulas/default em `conversations`.
-- Nenhuma linha existente muda (tipo nasce 'dm' para as conversas atuais).
--
-- Rollback (manual):
--   BEGIN;
--   DROP INDEX IF EXISTS conversations_externo_uq;
--   DROP INDEX IF EXISTS idx_conversations_canal_status;
--   DROP TRIGGER IF EXISTS tenant_reference_canal ON conversations;
--   ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_tipo_chk;
--   ALTER TABLE conversations DROP COLUMN IF EXISTS contexto_externo,
--     DROP COLUMN IF EXISTS canal_conexao_id, DROP COLUMN IF EXISTS externo_id,
--     DROP COLUMN IF EXISTS tipo;
--   DROP FUNCTION IF EXISTS resolve_tenant_by_canal(TEXT, TEXT);
--   DROP TABLE IF EXISTS channel_connections;
--   DELETE FROM schema_migrations WHERE filename = 'db/063_canais_conectados.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- 1. Conexões de canal ------------------------------------------------------
CREATE TABLE IF NOT EXISTS channel_connections (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rede                   TEXT NOT NULL,
  -- Id da conta na rede: page id (Messenger), IG user id (Instagram),
  -- channel id (YouTube). Roteia o webhook.
  external_id            TEXT NOT NULL,
  -- Página do Facebook vinculada (Instagram e Messenger): usada para
  -- assinar o webhook (`/{page-id}/subscribed_apps`) e enviar.
  page_id                TEXT NULL,
  nome                   TEXT NOT NULL DEFAULT '',
  status                 TEXT NOT NULL DEFAULT 'conectado',
  credentials_encrypted  TEXT NULL,
  scopes                 TEXT[] NOT NULL DEFAULT '{}',
  connected_by           UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  erro                   TEXT NULL,
  ultima_sync_at         TIMESTAMPTZ NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT channel_connections_rede_chk   CHECK (rede IN ('instagram', 'messenger', 'youtube', 'tiktok')),
  CONSTRAINT channel_connections_status_chk CHECK (status IN ('conectado', 'desconectado', 'erro')),
  CONSTRAINT channel_connections_nome_chk   CHECK (length(nome) <= 200),
  CONSTRAINT channel_connections_ext_uq     UNIQUE (rede, external_id)
);
CREATE INDEX IF NOT EXISTS idx_channel_connections_tenant ON channel_connections (tenant_id, rede);

ALTER TABLE channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_connections FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON channel_connections;
CREATE POLICY tenant_rw ON channel_connections FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 2. Roteamento do webhook (sem tenant) ---------------------------------------
CREATE OR REPLACE FUNCTION resolve_tenant_by_canal(p_rede TEXT, p_external_id TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.tenant_id FROM channel_connections c
   WHERE c.rede = p_rede AND c.external_id = p_external_id AND c.status = 'conectado'
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION resolve_tenant_by_canal(TEXT, TEXT) FROM PUBLIC;

-- 3. Conversa: tipo, id externo e conexão ------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS tipo             TEXT NOT NULL DEFAULT 'dm',
  ADD COLUMN IF NOT EXISTS externo_id       TEXT NULL,
  ADD COLUMN IF NOT EXISTS canal_conexao_id UUID NULL REFERENCES channel_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contexto_externo JSONB NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_tipo_chk') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_tipo_chk CHECK (tipo IN ('dm', 'comentario'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS conversations_externo_uq
  ON conversations (tenant_id, canal, externo_id) WHERE externo_id IS NOT NULL;
-- Contagens por canal/status da coluna "Canais" (endpoint leve de contagens).
CREATE INDEX IF NOT EXISTS idx_conversations_canal_status ON conversations (tenant_id, canal, status);

-- Conexão de OUTRO tenant é recusada no banco, não só na API (db/022).
-- O nome da função mudou no rebrand (db/035): usa a que existir.
DO $$
DECLARE fn TEXT;
BEGIN
  SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference_canal ON conversations';
  EXECUTE format('CREATE TRIGGER tenant_reference_canal BEFORE INSERT OR UPDATE OF canal_conexao_id ON conversations
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'canal_conexao_id', 'channel_connections');
END $$;

-- Papéis: `khub_*` no QA/produção, ainda `orvyn_*` no DEV: roda nos dois.
-- Dono da função de roteamento = papel de serviço (lê além do RLS).
DO $$ DECLARE r text; dono text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON channel_connections TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_tenant_by_canal(TEXT, TEXT) TO %I', r);
    END IF;
  END LOOP;
  SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service', 'orvyn_service')
   ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
  IF dono IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION resolve_tenant_by_canal(TEXT, TEXT) OWNER TO %I', dono);
  END IF;
END $$;

COMMIT;

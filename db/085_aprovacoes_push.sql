-- 085_aprovacoes_push.sql — Aprovações do cliente (artes e roteiros) + Web Push do app mobile (PWA).
--
-- 1. `aprovacoes`: peça (rascunho até `enviada_em`) que a equipe manda para o cliente aprovar (arte,
--    roteiro, vídeo por link). Status: pendente → aprovado | ajustes | recusado.
--    Pedir ajuste e reenviar volta para `pendente` com `versao + 1`.
-- 2. `aprovacao_arquivos`: imagens/PDF da peça, no próprio banco (bytea, até
--    4 MB cada). A produção não tem S3; o front comprime a imagem antes.
-- 3. `aprovacao_comentarios`: histórico (comentário do cliente e da equipe,
--    com a ação que o gerou: aprovado, ajustes, recusado, reenviado).
-- 4. `push_subscriptions`: aparelhos que aceitaram notificação no app mobile.
--    Uma linha por (tenant, endpoint). Endpoint que o provedor recusar com
--    404/410 é apagado pela API.
-- 5. `notifications.tipo` ganha `aprovacao_pendente` e `aprovacao_respondida`.
--
-- Tudo com RLS por tenant (mesmo padrão de db/055).
--
-- Rollback:
--   DROP TABLE IF EXISTS push_subscriptions, aprovacao_comentarios, aprovacao_arquivos, aprovacoes;
--   e reaplicar o CHECK de notifications de db/061.

BEGIN;

CREATE TABLE IF NOT EXISTS aprovacoes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('arte', 'roteiro', 'video', 'outro')),
  titulo         TEXT NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  descricao      TEXT NULL CHECK (descricao IS NULL OR char_length(descricao) <= 2000),
  -- Texto do roteiro (ou copy longa).
  conteudo       TEXT NULL CHECK (conteudo IS NULL OR char_length(conteudo) <= 20000),
  legenda        TEXT NULL CHECK (legenda IS NULL OR char_length(legenda) <= 5000),
  -- Vídeo/Canva/Drive: só https.
  link_externo   TEXT NULL CHECK (link_externo IS NULL OR (char_length(link_externo) <= 1000 AND link_externo ~ '^https://')),
  canal          TEXT NULL CHECK (canal IS NULL OR char_length(canal) <= 60),
  publicar_em    TIMESTAMPTZ NULL,
  prazo_em       TIMESTAMPTZ NULL,
  status         TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'ajustes', 'recusado')),
  versao         INT NOT NULL DEFAULT 1 CHECK (versao >= 1),
  -- NULL = rascunho da equipe (o cliente ainda não vê). Enviar notifica o cliente.
  enviada_em     TIMESTAMPTZ NULL,
  criado_por     UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  respondido_por UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  respondido_em  TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aprovacoes_tenant_status ON aprovacoes (tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS aprovacao_arquivos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aprovacao_id  UUID NOT NULL REFERENCES aprovacoes(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 200),
  mime          TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  tamanho       INT NOT NULL CHECK (tamanho BETWEEN 1 AND 4194304),
  dados         BYTEA NOT NULL,
  ordem         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aprovacao_arquivos_aprovacao ON aprovacao_arquivos (aprovacao_id, ordem);

CREATE TABLE IF NOT EXISTS aprovacao_comentarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  aprovacao_id  UUID NOT NULL REFERENCES aprovacoes(id) ON DELETE CASCADE,
  autor_id      UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  autor_nome    TEXT NOT NULL DEFAULT '' CHECK (char_length(autor_nome) <= 200),
  texto         TEXT NOT NULL DEFAULT '' CHECK (char_length(texto) <= 2000),
  acao          TEXT NULL CHECK (acao IS NULL OR acao IN ('aprovado', 'ajustes', 'recusado', 'reenviado')),
  versao        INT NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_aprovacao_comentarios_aprovacao ON aprovacao_comentarios (aprovacao_id, created_at);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_id   UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL CHECK (endpoint ~ '^https://' AND char_length(endpoint) <= 2000),
  p256dh        TEXT NOT NULL CHECK (char_length(p256dh) <= 300),
  auth          TEXT NOT NULL CHECK (char_length(auth) <= 100),
  user_agent    TEXT NULL CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  usado_em      TIMESTAMPTZ NULL,
  CONSTRAINT uq_push_subscriptions_endpoint UNIQUE (tenant_id, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_identity ON push_subscriptions (tenant_id, identity_id);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['aprovacoes', 'aprovacao_arquivos', 'aprovacao_comentarios', 'push_subscriptions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

-- Arquivo/comentário de aprovação de OUTRO tenant é recusado no banco (db/022).
DROP TRIGGER IF EXISTS tenant_reference ON aprovacao_arquivos;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON aprovacao_arquivos
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('aprovacao_id', 'aprovacoes');
DROP TRIGGER IF EXISTS tenant_reference ON aprovacao_comentarios;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON aprovacao_comentarios
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('aprovacao_id', 'aprovacoes');

-- Papéis: `khub_*` no QA/produção, ainda `orvyn_*` no DEV — roda nos dois.
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON aprovacoes, aprovacao_arquivos, aprovacao_comentarios, push_subscriptions TO %I', r);
    END IF;
  END LOOP;
END $$;

-- Avisos persistidos novos. Só AMPLIA a lista de db/061.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_tipo_chk;
ALTER TABLE notifications ADD CONSTRAINT notifications_tipo_chk
  CHECK (tipo IN ('mencao', 'disparo_aprovacao', 'avaliacao_negativa', 'aprovacao_pendente', 'aprovacao_respondida'));

COMMIT;

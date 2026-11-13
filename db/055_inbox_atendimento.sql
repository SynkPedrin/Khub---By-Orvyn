-- =====================================================================
-- 055_inbox_atendimento.sql — Inbox no nível do GHL (Q2.5) + central de
-- notificações (Q2.6)
--
-- Contexto:
--  1. Mídia de saída: a mensagem passa a carregar o anexo (`messages.anexo`,
--     jsonb: tipo, mime, nome, tamanho, legenda, storage_key). O arquivo mora
--     no storage S3-compatible; a URL NUNCA é gravada (é assinada e expira),
--     só a chave do objeto. Sem storage, arquivos pequenos vão em base64 direto
--     ao provedor que aceita (Evolution) e o anexo fica sem `storage_key`.
--  2. Respostas rápidas (`quick_replies`): atalho "/" no composer, corpo com
--     variáveis {{contato.nome}} resolvidas na inserção.
--  3. Notas internas (`conversation_notes`): tabela PRÓPRIA, não uma coluna em
--     `messages`. Motivo: `messages` alimenta o provedor, o gatilho de outbox
--     (automações), o histórico que vai ao prompt do agente de IA, a prévia da
--     conversa e o export LGPD do contato. Uma flag `interna` teria de ser
--     lembrada em cada um desses caminhos, e esquecer em UM vaza a nota da
--     equipe para o cliente ou para o LLM. Em tabela separada, nenhum desses
--     caminhos consegue enxergá-la por acidente.
--  4. Notificações persistidas (`notifications`): até aqui o sino era só
--     derivado (não lidas + integração quebrada). @menção numa nota precisa de
--     destinatário e de "lida", que não dá para derivar.
--
-- ADITIVA: uma coluna nula nova em `messages` e três tabelas novas. Nenhuma
-- linha existente muda.
--
-- Rollback (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS notifications;
--   DROP TABLE IF EXISTS conversation_notes;
--   DROP TABLE IF EXISTS quick_replies;
--   ALTER TABLE messages DROP COLUMN IF EXISTS anexo;
--   DELETE FROM schema_migrations WHERE filename = 'db/055_inbox_atendimento.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- 1. Anexo da mensagem ------------------------------------------------------
ALTER TABLE messages ADD COLUMN IF NOT EXISTS anexo JSONB NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_anexo_chk') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_anexo_chk
      CHECK (anexo IS NULL OR (jsonb_typeof(anexo) = 'object' AND anexo->>'tipo' IN ('imagem', 'documento', 'audio')));
  END IF;
END $$;

-- 2. Respostas rápidas -------------------------------------------------------
CREATE TABLE IF NOT EXISTS quick_replies (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  atalho      TEXT NOT NULL,
  titulo      TEXT NOT NULL,
  corpo       TEXT NOT NULL,
  criado_por  UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quick_replies_atalho_chk CHECK (atalho ~ '^[a-z0-9][a-z0-9_-]{0,31}$'),
  CONSTRAINT quick_replies_titulo_chk CHECK (length(titulo) BETWEEN 1 AND 80),
  CONSTRAINT quick_replies_corpo_chk  CHECK (length(corpo) BETWEEN 1 AND 4000)
);
CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_atalho_uq ON quick_replies (tenant_id, atalho);

ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_replies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON quick_replies;
CREATE POLICY tenant_rw ON quick_replies FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- 3. Notas internas da conversa ---------------------------------------------
CREATE TABLE IF NOT EXISTS conversation_notes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  autor_id         UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  corpo            TEXT NOT NULL,
  mencoes          UUID[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT conversation_notes_corpo_chk CHECK (length(corpo) BETWEEN 1 AND 4000),
  CONSTRAINT conversation_notes_mencoes_chk CHECK (cardinality(mencoes) <= 20)
);
CREATE INDEX IF NOT EXISTS idx_conversation_notes_conv ON conversation_notes (tenant_id, conversation_id, created_at);

ALTER TABLE conversation_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON conversation_notes;
CREATE POLICY tenant_rw ON conversation_notes FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Conversa de OUTRO tenant é recusada no banco, não só na API (db/022).
DROP TRIGGER IF EXISTS tenant_reference ON conversation_notes;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON conversation_notes
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('conversation_id', 'conversations');

-- 4. Notificações persistidas -------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Destinatário (identities.id). A API filtra por ele; o RLS garante o tenant.
  identity_id  UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL,
  titulo       TEXT NOT NULL,
  detalhe      TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL,
  entidade     TEXT NULL,
  entidade_id  UUID NULL,
  lida_em      TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT notifications_tipo_chk   CHECK (tipo IN ('mencao')),
  CONSTRAINT notifications_titulo_chk CHECK (length(titulo) BETWEEN 1 AND 200),
  CONSTRAINT notifications_detalhe_chk CHECK (length(detalhe) <= 500),
  -- Só caminho interno do app: nunca um link externo vindo de dado do usuário.
  CONSTRAINT notifications_url_chk    CHECK (url ~ '^/[^/]')
);
CREATE INDEX IF NOT EXISTS idx_notifications_destino ON notifications (tenant_id, identity_id, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON notifications;
CREATE POLICY tenant_rw ON notifications FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Papéis: `khub_*` no QA/produção, ainda `orvyn_*` no DEV — roda nos dois.
DO $$ DECLARE r text; t text; BEGIN
  FOREACH t IN ARRAY ARRAY['quick_replies', 'conversation_notes', 'notifications'] LOOP
    FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

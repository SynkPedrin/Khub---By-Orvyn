-- =====================================================================
-- 062_review_requests.sql — pedido de avaliação (Google ou outro)
--
-- Contexto (Q4.4): o tenant configura o link de avaliação e a mensagem
-- padrão; a equipe pede avaliação no perfil do contato e as automações usam
-- o nó `acao.pedir_avaliacao`. Cada pedido tem um link curto rastreável
-- (`/r/:token`) que registra o clique e redireciona. Com o "filtro de
-- satisfação" ligado, a página pergunta a nota antes: nota >= mínima vai ao
-- link público; abaixo dela abre um formulário de feedback interno e a
-- equipe (owner/admin) é notificada.
--
-- A página `/r/:token` é PÚBLICA e chega sem tenant. Como em 011/032, a
-- função SECURITY DEFINER devolve SÓ o par de roteamento (tenant, pedido);
-- depois a API entra em withTenant e a RLS volta a valer.
--
-- Depende de 061 (que já ampliou notifications.tipo com 'avaliacao_negativa').
-- ADITIVA: tabelas e função novas.
--
-- Rollback (manual):
--   BEGIN;
--   DROP FUNCTION IF EXISTS resolve_review_request_by_token(TEXT);
--   DROP TABLE IF EXISTS review_requests;
--   DROP TABLE IF EXISTS review_settings;
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS review_settings (
  tenant_id          UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  plataforma         TEXT NOT NULL DEFAULT 'google' CHECK (plataforma IN ('google', 'outro')),
  link               TEXT NOT NULL CHECK (link ~ '^https://' AND char_length(link) <= 500),
  mensagem_padrao    TEXT NOT NULL CHECK (char_length(mensagem_padrao) BETWEEN 1 AND 1000),
  assunto_email      TEXT NOT NULL DEFAULT 'Como foi sua experiência?' CHECK (char_length(assunto_email) BETWEEN 1 AND 200),
  filtro_satisfacao  BOOLEAN NOT NULL DEFAULT false,
  nota_minima        SMALLINT NOT NULL DEFAULT 4 CHECK (nota_minima BETWEEN 2 AND 5),
  updated_by         UUID,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS review_requests (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id         UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  canal              TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  -- Destino congelado no envio: trocar o link nas configurações não muda
  -- para onde um pedido antigo leva.
  link               TEXT NOT NULL CHECK (link ~ '^https://'),
  token              TEXT NOT NULL CHECK (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  status             TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'enviado', 'falhou', 'config_required')),
  origem             TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual', 'automacao')),
  idempotency_key    TEXT CHECK (idempotency_key IS NULL OR char_length(idempotency_key) <= 200),
  message_id         UUID,
  erro               TEXT CHECK (erro IS NULL OR char_length(erro) <= 500),
  filtro_satisfacao  BOOLEAN NOT NULL DEFAULT false,
  nota_minima        SMALLINT NOT NULL DEFAULT 4,
  enviado_em         TIMESTAMPTZ,
  clicado_em         TIMESTAMPTZ,
  cliques            INT NOT NULL DEFAULT 0,
  avaliacao_interna  SMALLINT CHECK (avaliacao_interna IS NULL OR avaliacao_interna BETWEEN 1 AND 5),
  avaliado_em        TIMESTAMPTZ,
  comentario         TEXT CHECK (comentario IS NULL OR char_length(comentario) <= 2000),
  redirecionado      BOOLEAN NOT NULL DEFAULT false,
  criado_por         UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_review_requests_token ON review_requests (token);
-- Retry do nó de automação não manda dois pedidos.
CREATE UNIQUE INDEX IF NOT EXISTS uq_review_requests_idem ON review_requests (tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_review_requests_lista ON review_requests (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_requests_contato ON review_requests (tenant_id, contact_id, created_at DESC);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['review_settings', 'review_requests'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

DO $$ DECLARE r text; t text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['review_settings', 'review_requests'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Roteamento do link público: token -> (tenant, pedido). Nada de negócio atravessa.
CREATE OR REPLACE FUNCTION resolve_review_request_by_token(p_token TEXT)
RETURNS TABLE (tenant_id UUID, review_request_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.tenant_id, r.id
  FROM review_requests r
  WHERE r.token = p_token
  LIMIT 1;
$$;

-- Dono = papel de serviço (BYPASSRLS), com o nome do ambiente (khub_* no QA, orvyn_* no DEV).
DO $$ DECLARE dono text; r text; BEGIN
  SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service', 'orvyn_service') ORDER BY rolname = 'khub_service' DESC LIMIT 1;
  IF dono IS NULL THEN RAISE EXCEPTION 'papel de serviço (khub_service/orvyn_service) ausente'; END IF;
  EXECUTE format('ALTER FUNCTION resolve_review_request_by_token(TEXT) OWNER TO %I', dono);
  REVOKE ALL ON FUNCTION resolve_review_request_by_token(TEXT) FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['khub_app','orvyn_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_review_request_by_token(TEXT) TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- =====================================================================
-- 060_booking_pages.sql — Agendamento público (Q4.2, paridade com o
-- Calendar booking widget do GHL)
--
-- Contexto: o tenant configura páginas de agendamento (/agenda/paginas) e
-- publica em /b/<slug>. O visitante escolhe dia e horário livres (calculados
-- sobre os compromissos reais da agenda, antecedência e janela), informa os
-- dados e o compromisso nasce pela AgendaService (prevenção de choque com
-- lock transacional, eventos normais da agenda via trigger da 054).
--
-- Tabelas:
--   booking_pages     configuração da página (duração, intervalo, horários por
--                     dia da semana, fuso, responsáveis com round-robin/fixo).
--   booking_reservas  vínculo reserva ↔ compromisso ↔ contato, com o hash do
--                     token do link de gerenciamento (remarcar/cancelar).
--
-- Rota PÚBLICA sem sessão: tenant sai do slug (`resolve_booking_page_by_slug`)
-- ou do hash do token (`resolve_booking_reserva_by_token`), ambas SECURITY
-- DEFINER (padrão da db/011). O token em claro nunca é gravado: só sha256.
--
-- Roda no QA (papéis khub_*) e no DEV (papéis orvyn_*).
--
-- Rollback (manual):
--   BEGIN;
--   DROP FUNCTION IF EXISTS resolve_booking_reserva_by_token(TEXT);
--   DROP FUNCTION IF EXISTS resolve_booking_page_by_slug(TEXT);
--   DROP TABLE IF EXISTS booking_reservas;
--   DROP TABLE IF EXISTS booking_pages;
--   DELETE FROM schema_migrations WHERE filename = 'db/060_booking_pages.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS booking_pages (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slug                    TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{2,62}[a-z0-9]$'),
  titulo                  TEXT NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 120),
  descricao               TEXT NULL CHECK (descricao IS NULL OR char_length(descricao) <= 2000),
  duracao_min             INTEGER NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 5 AND 480),
  -- Folga entre compromissos (antes e depois), em minutos.
  intervalo_min           INTEGER NOT NULL DEFAULT 0 CHECK (intervalo_min BETWEEN 0 AND 240),
  antecedencia_min_horas  INTEGER NOT NULL DEFAULT 2 CHECK (antecedencia_min_horas BETWEEN 0 AND 720),
  janela_dias             INTEGER NOT NULL DEFAULT 30 CHECK (janela_dias BETWEEN 1 AND 180),
  -- {"1":[{"de":"09:00","ate":"12:00"}], ...} chave = dia da semana (0 = domingo).
  horarios                JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(horarios) = 'object'),
  fuso                    TEXT NOT NULL DEFAULT 'America/Sao_Paulo' CHECK (char_length(fuso) BETWEEN 1 AND 64),
  responsaveis            UUID[] NOT NULL DEFAULT '{}',
  distribuicao            TEXT NOT NULL DEFAULT 'round_robin' CHECK (distribuicao IN ('round_robin','fixo')),
  -- Próximo da fila do round-robin (índice em `responsaveis`).
  rr_cursor               INTEGER NOT NULL DEFAULT 0 CHECK (rr_cursor >= 0),
  local                   TEXT NULL CHECK (local IS NULL OR char_length(local) <= 300),
  tipo                    TEXT NOT NULL DEFAULT 'reuniao' CHECK (tipo IN ('reuniao','call','demo','visita','followup','outro')),
  perguntas               JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(perguntas) = 'array'),
  confirmacao_automatica  BOOLEAN NOT NULL DEFAULT FALSE,
  estilo                  JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(estilo) = 'object'),
  ativo                   BOOLEAN NOT NULL DEFAULT TRUE,
  created_by              UUID NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_pages_tenant ON booking_pages (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS booking_reservas (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_page_id  UUID NOT NULL REFERENCES booking_pages(id) ON DELETE CASCADE,
  compromisso_id   UUID NOT NULL REFERENCES agenda_compromissos(id) ON DELETE CASCADE,
  contact_id       UUID NULL REFERENCES contacts(id) ON DELETE CASCADE,
  token_hash       TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  respostas        JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(respostas) = 'object'),
  utm              JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(utm) = 'object'),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_reservas_page ON booking_reservas (tenant_id, booking_page_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_reservas_compromisso ON booking_reservas (compromisso_id);

DO $$ DECLARE t text; r text; BEGIN
  FOREACH t IN ARRAY ARRAY['booking_pages','booking_reservas'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
    FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END IF;
    END LOOP;
  END LOOP;
END $$;

DO $$
DECLARE fn text;
BEGIN
 SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference','orvyn_check_tenant_reference')
  ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
 IF fn IS NOT NULL THEN
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON booking_reservas';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON booking_reservas FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L)',
    fn, 'booking_page_id', 'booking_pages', 'compromisso_id', 'agenda_compromissos', 'contact_id', 'contacts');
 END IF;
END $$;

-- Responsáveis precisam ser membros do tenant (identities são globais; um
-- uuid de outra conta não pode entrar na fila de distribuição).
CREATE OR REPLACE FUNCTION khub_booking_check_responsaveis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r uuid;
BEGIN
 FOREACH r IN ARRAY COALESCE(NEW.responsaveis, '{}') LOOP
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.identity_id = r AND m.tenant_id = NEW.tenant_id) THEN
   RAISE EXCEPTION 'responsável não é membro desta conta' USING ERRCODE = '23503';
  END IF;
 END LOOP;
 IF cardinality(NEW.responsaveis) > 0 AND NEW.rr_cursor >= cardinality(NEW.responsaveis) THEN
  NEW.rr_cursor := 0;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS khub_booking_responsaveis ON booking_pages;
CREATE TRIGGER khub_booking_responsaveis BEFORE INSERT OR UPDATE ON booking_pages
  FOR EACH ROW EXECUTE FUNCTION khub_booking_check_responsaveis();

CREATE OR REPLACE FUNCTION resolve_booking_page_by_slug(p_slug TEXT)
RETURNS TABLE (tenant_id UUID, page_id UUID, tenant_nome TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tenant_id, p.id, t.nome
  FROM booking_pages p JOIN tenants t ON t.id = p.tenant_id
  WHERE p.slug = p_slug AND p.ativo
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION resolve_booking_reserva_by_token(p_hash TEXT)
RETURNS TABLE (tenant_id UUID, reserva_id UUID, tenant_nome TEXT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.tenant_id, r.id, t.nome
  FROM booking_reservas r JOIN tenants t ON t.id = r.tenant_id
  WHERE r.token_hash = p_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_booking_page_by_slug(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_booking_reserva_by_token(TEXT) FROM PUBLIC;
DO $$
DECLARE dono text; r text; f text;
BEGIN
 SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service','orvyn_service')
  ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
 FOREACH f IN ARRAY ARRAY['resolve_booking_page_by_slug(TEXT)','resolve_booking_reserva_by_token(TEXT)'] LOOP
  IF dono IS NOT NULL THEN EXECUTE format('ALTER FUNCTION %s OWNER TO %I', f, dono); END IF;
  FOREACH r IN ARRAY ARRAY['khub_app','orvyn_app'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', f, r);
   END IF;
  END LOOP;
 END LOOP;
END $$;

COMMIT;

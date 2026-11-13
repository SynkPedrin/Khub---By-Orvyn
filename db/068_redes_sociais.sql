-- =====================================================================
-- 068_redes_sociais.sql — Gestão de redes sociais por subconta (tenant):
-- Instagram, TikTok e YouTube.
--
-- As CONTAS e os TOKENS continuam em `channel_connections` (db/063), cifrados
-- com CryptoService. Esta migração só cria o que não existe lá:
--
--  1. `redes_publicacoes`: fila de publicações (agora ou agendadas). Cada linha
--     nasce CONFIRMADA por uma pessoa (`confirmado_em` NOT NULL): a tela pede
--     confirmação explícita antes de criar. Quem publica é SÓ o processo
--     worker (`KHUB_PROCESS_ROLE=worker`), no tique de 60 s.
--     status: agendado → publicando → processando → publicado | erro;
--             agendado → cancelado (pela pessoa).
--  2. `redes_snapshots`: uma foto por conta por dia (seguidores, publicações,
--     visualizações e curtidas totais quando a rede informa). O TikTok não tem
--     histórico de seguidores na API: o gráfico de crescimento sai daqui.
--  3. `redes_publicacoes_pendentes(limite)` e `redes_conexoes_sem_snapshot(limite)`:
--     SECURITY DEFINER, devolvem SÓ (tenant_id, id) para o worker achar o
--     trabalho sem varrer tenant por tenant. Nenhum dado de negócio atravessa.
--
-- Dado de negócio: tenant_id NOT NULL + RLS FORCE + tenant_rw. Referência à
-- conexão de OUTRO tenant é recusada no banco (khub_check_tenant_reference).
--
-- ADITIVA: só objetos novos.
--
-- Rollback (manual):
--   BEGIN;
--   DROP FUNCTION IF EXISTS redes_publicacoes_pendentes(INT);
--   DROP FUNCTION IF EXISTS redes_conexoes_sem_snapshot(INT);
--   DROP TABLE IF EXISTS redes_snapshots;
--   DROP TABLE IF EXISTS redes_publicacoes;
--   DELETE FROM schema_migrations WHERE filename = 'db/068_redes_sociais.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- 1. Publicações ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redes_publicacoes (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexao_id              UUID NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  rede                    TEXT NOT NULL,
  formato                 TEXT NOT NULL,
  titulo                  TEXT NULL,
  legenda                 TEXT NOT NULL DEFAULT '',
  -- URL pública da mídia (a rede busca o arquivo nela; o YouTube recebe o envio do worker).
  midia_url               TEXT NOT NULL,
  -- TikTok: privacy_level escolhido pela pessoa; YouTube: privacyStatus.
  privacidade             TEXT NULL,
  opcoes                  JSONB NOT NULL DEFAULT '{}'::jsonb,
  agendado_para           TIMESTAMPTZ NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'agendado',
  tentativas              INT NOT NULL DEFAULT 0,
  -- Id intermediário na rede: contêiner do Instagram, publish_id do TikTok.
  externo_id              TEXT NULL,
  -- Id final do post/vídeo publicado e o link dele.
  post_id                 TEXT NULL,
  permalink               TEXT NULL,
  erro                    TEXT NULL,
  proxima_verificacao_em  TIMESTAMPTZ NULL,
  publicado_em            TIMESTAMPTZ NULL,
  confirmado_por          UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  confirmado_em           TIMESTAMPTZ NOT NULL,
  criado_por              UUID NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT redes_pub_rede_chk     CHECK (rede IN ('instagram', 'tiktok', 'youtube')),
  CONSTRAINT redes_pub_formato_chk  CHECK (formato IN ('imagem', 'reels', 'video')),
  CONSTRAINT redes_pub_status_chk   CHECK (status IN ('agendado', 'publicando', 'processando', 'publicado', 'erro', 'cancelado')),
  CONSTRAINT redes_pub_titulo_chk   CHECK (titulo IS NULL OR length(titulo) <= 100),
  CONSTRAINT redes_pub_legenda_chk  CHECK (length(legenda) <= 5000),
  CONSTRAINT redes_pub_url_chk      CHECK (length(midia_url) BETWEEN 8 AND 2048),
  CONSTRAINT redes_pub_erro_chk     CHECK (erro IS NULL OR length(erro) <= 600)
);
CREATE INDEX IF NOT EXISTS idx_redes_pub_tenant     ON redes_publicacoes (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_redes_pub_vencidas   ON redes_publicacoes (agendado_para) WHERE status = 'agendado';
CREATE INDEX IF NOT EXISTS idx_redes_pub_verificar  ON redes_publicacoes (proxima_verificacao_em) WHERE status IN ('processando', 'publicando');

-- 2. Fotos diárias da conta ---------------------------------------------------
CREATE TABLE IF NOT EXISTS redes_snapshots (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conexao_id     UUID NOT NULL REFERENCES channel_connections(id) ON DELETE CASCADE,
  rede           TEXT NOT NULL,
  dia            DATE NOT NULL,
  seguidores     BIGINT NULL,
  publicacoes    BIGINT NULL,
  visualizacoes  BIGINT NULL,
  curtidas       BIGINT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT redes_snap_rede_chk CHECK (rede IN ('instagram', 'tiktok', 'youtube')),
  CONSTRAINT redes_snap_dia_uq   UNIQUE (conexao_id, dia)
);
CREATE INDEX IF NOT EXISTS idx_redes_snap_tenant ON redes_snapshots (tenant_id, conexao_id, dia DESC);

-- RLS -----------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['redes_publicacoes', 'redes_snapshots']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;

-- Conexão de OUTRO tenant é recusada no banco. O nome da função mudou no
-- rebrand (db/035): usa a que existir (mesmo desenho de db/063).
DO $$
DECLARE fn TEXT; t TEXT;
BEGIN
  SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  FOREACH t IN ARRAY ARRAY['redes_publicacoes', 'redes_snapshots']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_reference ON %I', t);
    EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE OF conexao_id, tenant_id ON %I
      FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', t, fn, 'conexao_id', 'channel_connections');
  END LOOP;
END $$;

-- 3. Trabalho do worker (sem tenant na sessão) ---------------------------------
-- Publicações vencidas, em verificação, ou presas em 'publicando' (o serviço
-- marca as presas como erro sem repetir: repetir poderia publicar duas vezes).
CREATE OR REPLACE FUNCTION redes_publicacoes_pendentes(p_limite INT)
RETURNS TABLE (tenant_id UUID, id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.tenant_id, p.id FROM redes_publicacoes p
   WHERE (p.status = 'agendado' AND p.agendado_para <= now())
      OR (p.status = 'processando' AND coalesce(p.proxima_verificacao_em, now()) <= now())
      OR (p.status = 'publicando' AND p.updated_at < now() - interval '30 minutes')
   ORDER BY p.agendado_para
   LIMIT greatest(1, least(p_limite, 200));
$$;
REVOKE ALL ON FUNCTION redes_publicacoes_pendentes(INT) FROM PUBLIC;

-- Contas de rede social conectadas sem a foto do dia (UTC).
CREATE OR REPLACE FUNCTION redes_conexoes_sem_snapshot(p_limite INT)
RETURNS TABLE (tenant_id UUID, id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.tenant_id, c.id FROM channel_connections c
   WHERE c.rede IN ('instagram', 'tiktok', 'youtube')
     AND c.status = 'conectado'
     AND c.credentials_encrypted IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM redes_snapshots s
        WHERE s.conexao_id = c.id AND s.dia = (now() AT TIME ZONE 'UTC')::date
     )
   ORDER BY c.id
   LIMIT greatest(1, least(p_limite, 200));
$$;
REVOKE ALL ON FUNCTION redes_conexoes_sem_snapshot(INT) FROM PUBLIC;

-- Papéis: `khub_*` no QA/produção, ainda `orvyn_*` no DEV: roda nos dois (db/063).
-- Dono das funções = papel de serviço (lê além do RLS).
DO $$ DECLARE r text; dono text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON redes_publicacoes TO %I', r);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON redes_snapshots TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION redes_publicacoes_pendentes(INT) TO %I', r);
      EXECUTE format('GRANT EXECUTE ON FUNCTION redes_conexoes_sem_snapshot(INT) TO %I', r);
    END IF;
  END LOOP;
  SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service', 'orvyn_service')
   ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
  IF dono IS NOT NULL THEN
    EXECUTE format('ALTER FUNCTION redes_publicacoes_pendentes(INT) OWNER TO %I', dono);
    EXECUTE format('ALTER FUNCTION redes_conexoes_sem_snapshot(INT) OWNER TO %I', dono);
  END IF;
END $$;

COMMIT;

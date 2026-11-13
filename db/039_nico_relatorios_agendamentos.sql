-- =====================================================================
-- 039_nico_relatorios_agendamentos.sql — relatórios e rotinas da NICO
-- ADR-0044
--
-- ADITIVA: só cria tabelas novas.
--   nico_relatorios    — relatórios gerados pela NICO (chat ou rotina), em
--                        Markdown. A tela exporta .md e PDF (impressão).
--   nico_agendamentos  — rotinas: "toda segunda às 8h analise as campanhas
--                        e me mande o relatório". O worker executa quando
--                        `proximo_em` vence e grava o relatório + notificação.
-- Dado de negócio: tenant_id NOT NULL + RLS FORCE + tenant_rw.
--
-- Rollback (manual):
--   BEGIN; DROP TABLE IF EXISTS nico_relatorios; DROP TABLE IF EXISTS nico_agendamentos; COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS nico_agendamentos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titulo         TEXT NOT NULL,
  -- O que a NICO deve fazer em cada execução (linguagem natural).
  instrucao      TEXT NOT NULL,
  frequencia     TEXT NOT NULL,
  hora           TEXT NOT NULL DEFAULT '08:00',
  dia_semana     SMALLINT NULL,
  dia_mes        SMALLINT NULL,
  fuso           TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  ativo          BOOLEAN NOT NULL DEFAULT true,
  proximo_em     TIMESTAMPTZ NOT NULL,
  ultimo_em      TIMESTAMPTZ NULL,
  ultimo_status  TEXT NULL,
  ultimo_erro    TEXT NULL,
  -- Quem recebe a notificação (identities.id; validado como membro na API).
  destinatario_id UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  criado_por     UUID NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nico_ag_titulo_chk    CHECK (length(titulo) BETWEEN 1 AND 120),
  CONSTRAINT nico_ag_instrucao_chk CHECK (length(instrucao) BETWEEN 5 AND 2000),
  CONSTRAINT nico_ag_freq_chk      CHECK (frequencia IN ('diaria', 'semanal', 'mensal')),
  CONSTRAINT nico_ag_hora_chk      CHECK (hora ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  CONSTRAINT nico_ag_dsem_chk      CHECK (dia_semana IS NULL OR dia_semana BETWEEN 0 AND 6),
  CONSTRAINT nico_ag_dmes_chk      CHECK (dia_mes IS NULL OR dia_mes BETWEEN 1 AND 28),
  CONSTRAINT nico_ag_status_chk    CHECK (ultimo_status IS NULL OR ultimo_status IN ('ok', 'erro'))
);
CREATE INDEX IF NOT EXISTS idx_nico_ag_vencidos ON nico_agendamentos (proximo_em) WHERE ativo;
CREATE INDEX IF NOT EXISTS idx_nico_ag_tenant   ON nico_agendamentos (tenant_id, ativo);

CREATE TABLE IF NOT EXISTS nico_relatorios (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titulo           TEXT NOT NULL,
  tipo             TEXT NOT NULL DEFAULT 'livre',
  conteudo_md      TEXT NOT NULL,
  origem           TEXT NOT NULL DEFAULT 'chat',
  agendamento_id   UUID NULL REFERENCES nico_agendamentos(id) ON DELETE SET NULL,
  conversation_id  UUID NULL,
  criado_por       UUID NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nico_rel_titulo_chk   CHECK (length(titulo) BETWEEN 1 AND 160),
  CONSTRAINT nico_rel_conteudo_chk CHECK (length(conteudo_md) BETWEEN 1 AND 200000),
  CONSTRAINT nico_rel_tipo_chk     CHECK (tipo IN ('campanhas', 'benchmark', 'funil', 'automacoes', 'agentes', 'conteudo', 'financeiro', 'livre')),
  CONSTRAINT nico_rel_origem_chk   CHECK (origem IN ('chat', 'agendamento'))
);
CREATE INDEX IF NOT EXISTS idx_nico_rel_tenant ON nico_relatorios (tenant_id, created_at DESC);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nico_agendamentos', 'nico_relatorios']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO khub_app, khub_service', t);
  END LOOP;
END $$;

-- Relatório de rotina só aponta para rotina do MESMO tenant.
DROP TRIGGER IF EXISTS tenant_reference ON nico_relatorios;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON nico_relatorios
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('agendamento_id', 'nico_agendamentos');

COMMIT;

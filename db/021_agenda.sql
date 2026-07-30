-- 021_agenda.sql — Agenda: compromissos/agendamentos do tenant. Booking local e
-- real; a sincronização com Google Calendar é gated (config_required). RLS por tenant.
-- Aplicar:  node scripts/apply-sql.mjs db/021_agenda.sql

CREATE TABLE IF NOT EXISTS agenda_compromissos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID REFERENCES contacts(id) ON DELETE SET NULL,
  titulo          TEXT NOT NULL,
  inicio          TIMESTAMPTZ NOT NULL,
  fim             TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'agendado'
                    CHECK (status IN ('agendado','confirmado','concluido','cancelado','nao_compareceu')),
  local           TEXT,
  notas           TEXT,
  google_event_id TEXT,
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (fim > inicio)
);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_agenda_tenant_inicio ON agenda_compromissos (tenant_id, inicio);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_agenda_contato ON agenda_compromissos (tenant_id, contact_id);
-- ==SPLIT==
ALTER TABLE agenda_compromissos ENABLE ROW LEVEL SECURITY;
-- ==SPLIT==
ALTER TABLE agenda_compromissos FORCE  ROW LEVEL SECURITY;
-- ==SPLIT==
DROP POLICY IF EXISTS tenant_rw ON agenda_compromissos;
-- ==SPLIT==
CREATE POLICY tenant_rw ON agenda_compromissos FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- ==SPLIT==
GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_compromissos TO orvyn_app, orvyn_service;

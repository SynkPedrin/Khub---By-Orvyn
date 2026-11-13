-- =====================================================================
-- 054_agenda_status_gatilhos.sql — agenda profissional (Q2.4, RV-05.2,
-- RV-07.1, RV-07.2)
--
-- Contexto: a agenda real era uma lista por dia e o status de falta se chamava
-- `nao_compareceu`. Para a grade Dia/Semana/Mês, o filtro por responsável, a
-- cor por tipo e os gatilhos de automação (agendamento criado, confirmado,
-- faltou, cancelado e lembrete D-1), esta migração:
--   1. troca o status `nao_compareceu` por `faltou` (dados migrados) e garante
--      o conjunto agendado|confirmado|concluido|cancelado|faltou;
--   2. adiciona `tipo`, `responsavel_id`, `confirmado_em`, `faltou_em`,
--      `concluido_em`, `cancelado_em` e `lembrete_enviado_em`;
--   3. carimba os timestamps de status num BEFORE trigger próprio (vale para
--      qualquer caminho de escrita: API, agente de IA, SQL);
--   4. publica os eventos de domínio no outbox por um AFTER trigger PRÓPRIO
--      (`khub_agenda_outbox`). A função compartilhada `khub_domain_outbox`
--      NÃO é tocada (outra migração a altera);
--   5. liga a checagem de referência cross-tenant (`contact_id`) que faltava.
--
-- Eventos (kind no outbox_events):
--   appointment.created       INSERT
--   appointment.confirmed     status → confirmado
--   appointment.no_show       status → faltou
--   appointment.cancelled     status → cancelado
--   appointment.reminder_due  lembrete_enviado_em NULL → valor (varredura D-1
--                             feita pelo worker, AgendaService.dispararLembretes)
--
-- Roda no QA (papéis khub_*) e no DEV (papéis orvyn_* e funções orvyn_*).
--
-- Rollback (manual):
--   BEGIN;
--   DROP TRIGGER IF EXISTS khub_agenda_outbox ON agenda_compromissos;
--   DROP TRIGGER IF EXISTS khub_agenda_status_ts ON agenda_compromissos;
--   DROP TRIGGER IF EXISTS tenant_reference ON agenda_compromissos;
--   DROP FUNCTION IF EXISTS khub_agenda_outbox();
--   DROP FUNCTION IF EXISTS khub_agenda_status_ts();
--   DROP INDEX IF EXISTS idx_agenda_lembrete_pendente;
--   DROP INDEX IF EXISTS idx_agenda_responsavel;
--   ALTER TABLE agenda_compromissos DROP CONSTRAINT IF EXISTS agenda_compromissos_status_check;
--   UPDATE agenda_compromissos SET status = 'nao_compareceu' WHERE status = 'faltou';
--   ALTER TABLE agenda_compromissos ADD CONSTRAINT agenda_compromissos_status_check
--     CHECK (status IN ('agendado','confirmado','concluido','cancelado','nao_compareceu'));
--   ALTER TABLE agenda_compromissos DROP CONSTRAINT IF EXISTS agenda_compromissos_tipo_check;
--   ALTER TABLE agenda_compromissos
--     DROP COLUMN IF EXISTS tipo, DROP COLUMN IF EXISTS responsavel_id,
--     DROP COLUMN IF EXISTS confirmado_em, DROP COLUMN IF EXISTS faltou_em,
--     DROP COLUMN IF EXISTS concluido_em, DROP COLUMN IF EXISTS cancelado_em,
--     DROP COLUMN IF EXISTS lembrete_enviado_em;
--   DELETE FROM schema_migrations WHERE filename = 'db/054_agenda_status_gatilhos.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- 1. Colunas novas (nulas ou com default: nenhuma linha existente quebra).
ALTER TABLE agenda_compromissos
  ADD COLUMN IF NOT EXISTS tipo                TEXT NOT NULL DEFAULT 'reuniao',
  ADD COLUMN IF NOT EXISTS responsavel_id      UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmado_em       TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS faltou_em           TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS concluido_em        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS cancelado_em        TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS lembrete_enviado_em TIMESTAMPTZ NULL;

ALTER TABLE agenda_compromissos DROP CONSTRAINT IF EXISTS agenda_compromissos_tipo_check;
ALTER TABLE agenda_compromissos ADD CONSTRAINT agenda_compromissos_tipo_check
  CHECK (tipo IN ('reuniao','call','demo','visita','followup','outro'));

-- Quem já tinha responsável implícito (quem criou) passa a tê-lo explícito.
UPDATE agenda_compromissos a SET responsavel_id = a.created_by
 WHERE a.responsavel_id IS NULL AND a.created_by IS NOT NULL
   AND EXISTS (SELECT 1 FROM identities i WHERE i.id = a.created_by);

-- 2. Status: nao_compareceu → faltou (antes dos triggers: a migração de dado
--    não é evento de negócio e não pode disparar automação).
ALTER TABLE agenda_compromissos DROP CONSTRAINT IF EXISTS agenda_compromissos_status_check;
UPDATE agenda_compromissos SET status = 'faltou' WHERE status = 'nao_compareceu';
ALTER TABLE agenda_compromissos ADD CONSTRAINT agenda_compromissos_status_check
  CHECK (status IN ('agendado','confirmado','concluido','cancelado','faltou'));

CREATE INDEX IF NOT EXISTS idx_agenda_responsavel ON agenda_compromissos (tenant_id, responsavel_id, inicio);
-- Varredura do lembrete D-1: só os ativos ainda sem lembrete.
CREATE INDEX IF NOT EXISTS idx_agenda_lembrete_pendente ON agenda_compromissos (tenant_id, inicio)
  WHERE lembrete_enviado_em IS NULL AND status IN ('agendado','confirmado');

-- 3. Timestamps de status + reagendamento zera o lembrete.
CREATE OR REPLACE FUNCTION khub_agenda_status_ts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
  IF NEW.status = 'confirmado' THEN NEW.confirmado_em := COALESCE(NEW.confirmado_em, now()); END IF;
  IF NEW.status = 'faltou'     THEN NEW.faltou_em     := now(); END IF;
  IF NEW.status = 'concluido'  THEN NEW.concluido_em  := now(); END IF;
  IF NEW.status = 'cancelado'  THEN NEW.cancelado_em  := now(); END IF;
  -- Voltou para "agendado": os carimbos passam a não valer mais.
  IF NEW.status = 'agendado' THEN
   NEW.confirmado_em := NULL; NEW.faltou_em := NULL; NEW.concluido_em := NULL; NEW.cancelado_em := NULL;
  END IF;
 END IF;
 IF TG_OP = 'UPDATE' THEN
  -- Reagendou: o lembrete enviado era do horário antigo. Um novo sai na
  -- próxima varredura (se o novo horário estiver na janela D-1).
  IF NEW.inicio IS DISTINCT FROM OLD.inicio AND NEW.lembrete_enviado_em IS NOT DISTINCT FROM OLD.lembrete_enviado_em THEN
   NEW.lembrete_enviado_em := NULL;
  END IF;
  NEW.updated_at := now();
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS khub_agenda_status_ts ON agenda_compromissos;
CREATE TRIGGER khub_agenda_status_ts BEFORE INSERT OR UPDATE ON agenda_compromissos
  FOR EACH ROW EXECUTE FUNCTION khub_agenda_status_ts();

-- 4. Outbox próprio da agenda: evento e mudança de domínio no MESMO commit.
CREATE OR REPLACE FUNCTION khub_agenda_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; p jsonb;
BEGIN
 p := jsonb_build_object(
   'id', NEW.id, 'contactId', NEW.contact_id, 'responsavelId', NEW.responsavel_id,
   'tipo', NEW.tipo, 'status', NEW.status, 'inicio', NEW.inicio, 'fim', NEW.fim);
 IF TG_OP = 'INSERT' THEN
  INSERT INTO outbox_events(tenant_id, kind, payload, dedupe_key)
   VALUES (NEW.tenant_id, 'appointment.created', p, 'appointment.created:' || NEW.id::text);
 ELSE
  IF NEW.status IS DISTINCT FROM OLD.status THEN
   k := CASE NEW.status
          WHEN 'confirmado' THEN 'appointment.confirmed'
          WHEN 'faltou'     THEN 'appointment.no_show'
          WHEN 'cancelado'  THEN 'appointment.cancelled'
        END;
   IF k IS NOT NULL THEN
    INSERT INTO outbox_events(tenant_id, kind, payload, dedupe_key)
     VALUES (NEW.tenant_id, k, p || jsonb_build_object('statusAnterior', OLD.status), uuid_generate_v4()::text);
   END IF;
  END IF;
  IF OLD.lembrete_enviado_em IS NULL AND NEW.lembrete_enviado_em IS NOT NULL THEN
   INSERT INTO outbox_events(tenant_id, kind, payload, dedupe_key)
    VALUES (NEW.tenant_id, 'appointment.reminder_due', p,
            'appointment.reminder_due:' || NEW.id::text || ':' || extract(epoch FROM NEW.inicio)::bigint::text)
    ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
  END IF;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS khub_agenda_outbox ON agenda_compromissos;
CREATE TRIGGER khub_agenda_outbox AFTER INSERT OR UPDATE ON agenda_compromissos
  FOR EACH ROW EXECUTE FUNCTION khub_agenda_outbox();

-- 5. Referência cross-tenant do contato (RLS sozinha não garante). Usa a
--    função com o nome do ambiente (khub_* no QA, orvyn_* no DEV ainda).
DO $$
DECLARE fn text;
BEGIN
 SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference','orvyn_check_tenant_reference')
  ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
 IF fn IS NOT NULL THEN
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON agenda_compromissos';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON agenda_compromissos FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'contact_id', 'contacts');
 END IF;
END $$;

-- RLS já existe desde a 021; reafirma (idempotente) e corrige os GRANTs para
-- os dois nomes de papel.
ALTER TABLE agenda_compromissos ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_compromissos FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON agenda_compromissos;
CREATE POLICY tenant_rw ON agenda_compromissos FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_compromissos TO %I', r);
    END IF; END LOOP; END $$;

COMMIT;

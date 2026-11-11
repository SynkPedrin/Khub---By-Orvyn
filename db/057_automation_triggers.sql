-- =====================================================================
-- 057_automation_triggers.sql — gatilhos novos do motor (Q3.2 + W3)
--
-- Contexto:
--   1. `workflow_schedules`: agenda dos gatilhos por TEMPO — `gatilho.agendado`
--      (diário/semanal/mensal em hora e fuso) e `gatilho.data_contato`
--      (aniversário ou outro campo de data, varredura diária). Publicar o fluxo
--      grava uma linha por nó; pausar/despublicar/excluir apaga (CASCADE na
--      exclusão). O worker varre `proximo_em <= now()`, pega a linha com lease
--      (`lease_until`, dois workers nunca disparam a mesma janela), abre os runs
--      com `dedupe_key` por fluxo+nó+janela(+contato) e só então avança
--      `proximo_em`. Falhou no meio: a próxima varredura refaz a MESMA janela e
--      o unique(workflow_id, dedupe_key) dos runs impede execução dupla.
--      Escolha sobre o repeatable job do BullMQ: o estado fica no Postgres, sob
--      RLS, e sobrevive a flush do Redis sem rotina de reconstrução.
--   2. `payment.received` no outbox: trigger PRÓPRIA em `financeiro_cobrancas`
--      (a função compartilhada `khub_domain_outbox` NÃO é tocada). Dispara
--      quando a cobrança vira `paga` (UPDATE) ou já nasce paga (INSERT). Uma
--      vez por cobrança: dedupe `payment.received:<id>` + ON CONFLICT DO NOTHING
--      (reentrega do webhook da Stripe não abre segundo run).
--
-- ADITIVA: tabela nova com RLS FORCE + função/trigger novas.
-- Roda no QA (papéis khub_*) e no DEV (papéis orvyn_*).
--
-- Rollback (manual):
--   BEGIN;
--   DROP TRIGGER IF EXISTS khub_cobranca_outbox ON financeiro_cobrancas;
--   DROP FUNCTION IF EXISTS khub_cobranca_outbox();
--   DROP TABLE IF EXISTS workflow_schedules;
--   DELETE FROM schema_migrations WHERE filename = 'db/057_automation_triggers.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- 1. Agenda dos gatilhos por tempo
CREATE TABLE IF NOT EXISTS workflow_schedules (
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id   UUID        NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_id    UUID        NOT NULL REFERENCES workflow_versions(id) ON DELETE CASCADE,
  node_id       TEXT        NOT NULL,
  tipo          TEXT        NOT NULL CHECK (tipo IN ('agendado','data_contato')),
  proximo_em    TIMESTAMPTZ NOT NULL,
  ultima_janela TIMESTAMPTZ NULL,
  lease_until   TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, workflow_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_workflow_schedules_due ON workflow_schedules (tenant_id, proximo_em);

ALTER TABLE workflow_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_schedules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON workflow_schedules;
CREATE POLICY tenant_rw ON workflow_schedules FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON workflow_schedules TO %I', r);
    END IF; END LOOP; END $$;

-- 2. Pagamento recebido → outbox (evento e mudança no MESMO commit)
CREATE OR REPLACE FUNCTION khub_cobranca_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.status = 'paga' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paga') THEN
  INSERT INTO outbox_events(tenant_id, kind, payload, dedupe_key)
   VALUES (NEW.tenant_id, 'payment.received',
           jsonb_build_object('id', NEW.id, 'contactId', NEW.contact_id, 'dealId', NEW.deal_id,
                              'valorCentavos', NEW.valor_centavos, 'moeda', NEW.moeda,
                              'descricao', NEW.descricao, 'pagoEm', COALESCE(NEW.pago_em, now())),
           'payment.received:' || NEW.id::text)
   ON CONFLICT (tenant_id, dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS khub_cobranca_outbox ON financeiro_cobrancas;
CREATE TRIGGER khub_cobranca_outbox AFTER INSERT OR UPDATE OF status ON financeiro_cobrancas
  FOR EACH ROW EXECUTE FUNCTION khub_cobranca_outbox();

COMMIT;

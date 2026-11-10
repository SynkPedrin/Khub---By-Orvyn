-- ORVYN OS: durable events, delivery ledger and recoverable scheduling.
-- Additive migration. Run as migration owner, before deploying API/worker.
BEGIN;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS opted_out_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS scheduled_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lease_until timestamptz;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS lease_owner uuid;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS generation integer NOT NULL DEFAULT 0;
ALTER TABLE workflow_runs ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'legacy';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS provider_id text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS delivery_error text;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sent_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency ON messages(tenant_id,idempotency_key);
CREATE INDEX IF NOT EXISTS runs_due ON workflow_runs(tenant_id,scheduled_at) WHERE status IN ('rodando','esperando');
CREATE INDEX IF NOT EXISTS messages_conversation_time ON messages(tenant_id,conversation_id,created_at DESC);
CREATE TABLE IF NOT EXISTS outbox_events (
 id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 kind text NOT NULL,
 payload jsonb NOT NULL,
 dedupe_key text NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processed','failed')),
 attempts integer NOT NULL DEFAULT 0,
 last_error text,
 processed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox_events(tenant_id,created_at) WHERE status='pending';
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON outbox_events;
CREATE POLICY tenant_rw ON outbox_events USING (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid)
 WITH CHECK (tenant_id=NULLIF(current_setting('app.current_tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON outbox_events TO orvyn_app;

-- Domain changes and their events commit in the SAME transaction, including
-- writes made through imports/AI. Redis is never part of this commit.
CREATE OR REPLACE FUNCTION orvyn_domain_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; p jsonb; tag text;
BEGIN
 IF TG_TABLE_NAME='contacts' THEN
  IF TG_OP='INSERT' THEN
   k:='contact.created'; p:=jsonb_build_object('id',NEW.id,'nome',NEW.nome,'origem',COALESCE(NEW.campos_custom->>'origem','Manual'));
  ELSE
   FOR tag IN SELECT unnest(NEW.tags) EXCEPT SELECT unnest(OLD.tags) LOOP
    INSERT INTO outbox_events(tenant_id,kind,payload,dedupe_key) VALUES(NEW.tenant_id,'contact.tagged',jsonb_build_object('id',NEW.id,'tag',tag),uuid_generate_v4()::text);
   END LOOP;
  END IF;
 ELSIF TG_TABLE_NAME='deals' THEN
  IF TG_OP='INSERT' THEN
   k:='deal.created'; p:=jsonb_build_object('id',NEW.id,'stageId',NEW.stage_id,'contactId',NEW.contact_id);
  ELSE
   IF NEW.stage_id IS DISTINCT FROM OLD.stage_id THEN
    INSERT INTO outbox_events(tenant_id,kind,payload,dedupe_key) VALUES(NEW.tenant_id,'deal.moved',jsonb_build_object('id',NEW.id,'stageId',NEW.stage_id,'stageAnterior',OLD.stage_id),uuid_generate_v4()::text);
   END IF;
   IF NEW.status IS DISTINCT FROM OLD.status THEN
    k:='deal.status_changed'; p:=jsonb_build_object('id',NEW.id,'status',NEW.status,'contactId',NEW.contact_id);
    IF NEW.status IN ('ganho','perdido') THEN
     UPDATE workflow_runs SET status='cancelado',finished_at=now(),erro='negócio encerrado' WHERE tenant_id=NEW.tenant_id AND (deal_id=NEW.id OR contact_id=NEW.contact_id) AND status IN ('rodando','esperando');
    END IF;
   END IF;
  END IF;
 ELSIF TG_TABLE_NAME='messages' AND NEW.autor_tipo='contato' THEN
  k:='message.created'; p:=jsonb_build_object('id',NEW.id,'conversationId',NEW.conversation_id,'de','contato','texto',NEW.corpo,'hora',NEW.hora);
 END IF;
 IF k IS NOT NULL THEN
  INSERT INTO outbox_events(tenant_id,kind,payload,dedupe_key) VALUES(NEW.tenant_id,k,p,uuid_generate_v4()::text);
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS orvyn_outbox ON contacts;
CREATE TRIGGER orvyn_outbox AFTER INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION orvyn_domain_outbox();
DROP TRIGGER IF EXISTS orvyn_outbox ON deals;
CREATE TRIGGER orvyn_outbox AFTER INSERT OR UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION orvyn_domain_outbox();
DROP TRIGGER IF EXISTS orvyn_outbox ON messages;
CREATE TRIGGER orvyn_outbox AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION orvyn_domain_outbox();

-- RLS cannot enforce ownership of referenced rows by itself. Reject new
-- cross-tenant references, including raw SQL and future application callers.
CREATE OR REPLACE FUNCTION orvyn_check_tenant_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref uuid; valid boolean; i integer;
BEGIN
 FOR i IN 0..TG_NARGS/2-1 LOOP
  ref:=(to_jsonb(NEW)->>TG_ARGV[i*2])::uuid;
  IF ref IS NOT NULL THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE id=$1 AND tenant_id=$2)',TG_ARGV[i*2+1]) INTO valid USING ref,NEW.tenant_id;
   IF NOT valid THEN RAISE EXCEPTION 'related resource not found' USING ERRCODE='23503'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;
DO $$
DECLARE t text; args text;
BEGIN
 FOR t,args IN SELECT * FROM (VALUES
 ('contacts', '''company_id'',''companies'''),
 ('stages', '''pipeline_id'',''pipelines'''),
 ('deals', '''contact_id'',''contacts'',''stage_id'',''stages'',''pipeline_id'',''pipelines'''),
 ('conversations', '''contact_id'',''contacts'''),
 ('messages', '''conversation_id'',''conversations'''),
 ('tasks', '''contact_id'',''contacts'',''deal_id'',''deals'',''company_id'',''companies'''),
 ('notes', '''contact_id'',''contacts'',''deal_id'',''deals'',''company_id'',''companies'''),
 ('workflow_versions', '''workflow_id'',''workflows'''),
 ('workflow_runs', '''workflow_id'',''workflows'',''version_id'',''workflow_versions'',''contact_id'',''contacts'',''deal_id'',''deals''')
 ) AS refs(t,args) LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS tenant_reference ON %I',t);
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference(%s)',t,args);
 END LOOP;
END $$;
COMMIT;

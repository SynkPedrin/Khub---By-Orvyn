-- 083_whatsapp_openwa.sql — WhatsApp por QR Code próprio (open-wa, ADR-0058).
--
-- 1. `whatsapp_links_conexao`: link público (7 dias) que o cliente abre para
--    ler o QR Code e conectar o WhatsApp dele. Só o sha256 do token fica no
--    banco; o token (256 bits) é a credencial e só aparece uma vez, na criação.
-- 2. `resolve_whatsapp_link(hash)`: SECURITY DEFINER para a página pública
--    achar o tenant sem sessão (padrão db/060). Devolve só o necessário.
-- 3. Uma sessão open-wa pertence a UM tenant enquanto ativa (índice parcial).
-- 4. Histórico importado não dispara automação nem IA: o gatilho de outbox
--    (khub_domain_outbox) ignora a transação que ligou `khub.historico = on`
--    (set_config local à transação). Sem isso, importar 90 dias de conversa
--    faria a IA responder mensagem antiga e o fluxo "Novo Lead" rodar para
--    cada contato antigo.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS resolve_whatsapp_link(TEXT);
--   DROP TABLE IF EXISTS whatsapp_links_conexao;
--   DROP INDEX IF EXISTS uq_openwa_sessao_ativa;
--   e reaplicar khub_domain_outbox de db/057 (sem o primeiro IF).

BEGIN;

CREATE TABLE IF NOT EXISTS whatsapp_links_conexao (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash     TEXT NOT NULL UNIQUE,
  provider       TEXT NOT NULL DEFAULT 'openwa' CHECK (provider IN ('openwa')),
  criado_por     UUID NULL,
  expira_em      TIMESTAMPTZ NOT NULL,
  conectado_em   TIMESTAMPTZ NULL,
  numero         TEXT NULL,
  revogado_em    TIMESTAMPTZ NULL,
  ultimo_acesso_em TIMESTAMPTZ NULL,
  acessos        INT NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expira_em > created_at)
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_links_tenant ON whatsapp_links_conexao (tenant_id, created_at DESC);

ALTER TABLE whatsapp_links_conexao ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_links_conexao FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON whatsapp_links_conexao;
CREATE POLICY tenant_rw ON whatsapp_links_conexao FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DO $$
DECLARE r text;
BEGIN
 FOREACH r IN ARRAY ARRAY['khub_app','orvyn_app'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
   EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON whatsapp_links_conexao TO %I', r);
  END IF;
 END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_openwa_sessao_ativa
  ON integrations (external_business_id)
  WHERE provider = 'openwa' AND status <> 'revoked' AND external_business_id IS NOT NULL;

CREATE OR REPLACE FUNCTION resolve_whatsapp_link(p_hash TEXT)
RETURNS TABLE (tenant_id UUID, link_id UUID, tenant_nome TEXT, expira_em TIMESTAMPTZ, revogado_em TIMESTAMPTZ, conectado_em TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.tenant_id, l.id, t.nome, l.expira_em, l.revogado_em, l.conectado_em
  FROM whatsapp_links_conexao l JOIN tenants t ON t.id = l.tenant_id
  WHERE l.token_hash = p_hash
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_whatsapp_link(TEXT) FROM PUBLIC;
DO $$
DECLARE dono text; r text;
BEGIN
 SELECT rolname INTO dono FROM pg_roles WHERE rolname IN ('khub_service','orvyn_service')
  ORDER BY (rolname = 'khub_service') DESC LIMIT 1;
 IF dono IS NOT NULL THEN EXECUTE format('ALTER FUNCTION resolve_whatsapp_link(TEXT) OWNER TO %I', dono); END IF;
 FOREACH r IN ARRAY ARRAY['khub_app','orvyn_app'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
   EXECUTE format('GRANT EXECUTE ON FUNCTION resolve_whatsapp_link(TEXT) TO %I', r);
  END IF;
 END LOOP;
END $$;

-- Mesmo corpo de db/057 + o primeiro IF (histórico importado não vira evento).
CREATE OR REPLACE FUNCTION khub_domain_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text; p jsonb; tag text;
BEGIN
 IF current_setting('khub.historico', true) = 'on' THEN
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='contacts' THEN
  IF TG_OP='INSERT' THEN
   k:='contact.created'; p:=jsonb_build_object('id',NEW.id,'nome',NEW.nome,'origem',COALESCE(NULLIF(NEW.origem,''),NEW.campos_custom->>'lead_origem',NEW.campos_custom->>'origem','Manual'));
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

COMMIT;

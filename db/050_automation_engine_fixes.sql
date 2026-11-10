-- =====================================================================
-- 050_automation_engine_fixes.sql — Sprint Q1 (bugs do motor de automações)
--
-- Contexto:
--  1. BUG-027 (Q1.1) — o gatilho "Contato criado" com filtro de origem nunca
--     batia: a função de outbox montava `origem` só a partir de
--     `campos_custom->>'origem'`, mas o cadastro manual grava a coluna
--     `contacts.origem` e o lead de anúncio grava `campos_custom.lead_origem`.
--     A função é recriada (CREATE OR REPLACE) com
--       COALESCE(NULLIF(NEW.origem,''), NEW.campos_custom->>'lead_origem',
--                NEW.campos_custom->>'origem', 'Manual')
--     e o RESTO DO CORPO IDÊNTICO ao vivo (conferido com pg_get_functiondef no
--     QA em 2026-11-10 = corpo de db/022; 035 só renomeou; 036/037 não mexem).
--     O nome da função difere por ambiente: `khub_domain_outbox` (QA, após 035)
--     e `orvyn_domain_outbox` (DEV, 035 pendente) — detectado em pg_proc.
--  2. Q1.2 — `workflows.janela_inclui_equipe`: a janela de envio passa a valer
--     também para "Notificar equipe" quando o fluxo marcar (padrão: não).
--  3. Q1.3 — `workflow_runs.grafo_teste`: o "Testar" roda o RASCUNHO; o grafo
--     é congelado no run (o rascunho segue editável sem mudar o teste em
--     andamento). NULL em todo run de produção (esses leem a versão publicada).
--  4. Q1.4 (W5) — `workflows.webhook_segredo`: segredo HMAC opcional do
--     webhook de entrada. Com ele, o POST exige `X-KHUB-Signature:
--     sha256=<hmac>`. Fica na linha do workflow (não no grafo) para não vazar
--     em versões, templates do marketplace nem no GET do canvas.
--
-- ADITIVA: só colunas novas (nulas ou com default) + troca do corpo da função.
-- Tabelas já têm RLS FORCE + policy tenant_rw (db/010, db/011); colunas novas
-- herdam os grants de tabela de khub_app/orvyn_app.
--
-- Rollback (manual):
--   BEGIN;
--   ALTER TABLE workflows DROP COLUMN IF EXISTS webhook_segredo,
--                         DROP COLUMN IF EXISTS janela_inclui_equipe;
--   ALTER TABLE workflow_runs DROP COLUMN IF EXISTS grafo_teste;
--   -- função: reaplicar o bloco CREATE OR REPLACE de db/022 (linhas 41-70)
--   -- com o nome vigente (khub_domain_outbox ou orvyn_domain_outbox).
--   COMMIT;
-- =====================================================================

BEGIN;

ALTER TABLE workflows
  ADD COLUMN IF NOT EXISTS webhook_segredo      TEXT    NULL,
  ADD COLUMN IF NOT EXISTS janela_inclui_equipe BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE workflow_runs
  ADD COLUMN IF NOT EXISTS grafo_teste JSONB NULL;

COMMENT ON COLUMN workflows.webhook_segredo IS 'Segredo HMAC-SHA256 do webhook de entrada (X-KHUB-Signature). NULL = sem assinatura.';
COMMENT ON COLUMN workflows.janela_inclui_equipe IS 'Janela de envio também segura o nó Notificar equipe.';
COMMENT ON COLUMN workflow_runs.grafo_teste IS 'Grafo congelado do rascunho para runs de teste (teste = true). NULL = usa a versão.';

DO $mig$
DECLARE nome text;
BEGIN
  SELECT p.proname INTO nome
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname IN ('khub_domain_outbox', 'orvyn_domain_outbox')
   ORDER BY (p.proname = 'khub_domain_outbox') DESC
   LIMIT 1;
  IF nome IS NULL THEN
    RAISE EXCEPTION '050: função de outbox (khub_domain_outbox/orvyn_domain_outbox) não encontrada — aplique db/022 antes';
  END IF;

  EXECUTE format($sql$
CREATE OR REPLACE FUNCTION public.%I() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE k text; p jsonb; tag text;
BEGIN
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
END $fn$;
$sql$, nome);
END
$mig$;

COMMIT;

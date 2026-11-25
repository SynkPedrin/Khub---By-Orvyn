-- 081_tenant_reference_so_o_que_mudou.sql — a trava de tenant (db/022) só
-- confere a referência que MUDOU num UPDATE.
--
-- Por quê: `khub_check_tenant_reference()` (db/022, renomeada em db/035) rodava em todo UPDATE conferindo
-- TODAS as referências da linha. Quando uma exclusão em cascata faz
-- `ON DELETE SET NULL` numa coluna (ex.: agent_profile_facts.conversation_id),
-- o UPDATE reconferia as outras colunas (message_id) que apontam para linhas
-- sendo apagadas no mesmo comando → "related resource not found" (23503).
-- Efeito: excluir conversa (INBOX-EXCLUIR) falhava em toda conversa com
-- histórico da IA. Referência que não mudou já foi validada quando foi gravada;
-- se o tenant da linha mudar, tudo é conferido de novo.
--
-- Rollback: reaplicar o corpo de db/022 com o nome khub_check_tenant_reference.

CREATE OR REPLACE FUNCTION khub_check_tenant_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref uuid; valid boolean; i integer;
BEGIN
 FOR i IN 0..TG_NARGS/2-1 LOOP
  ref:=(to_jsonb(NEW)->>TG_ARGV[i*2])::uuid;
  IF TG_OP='UPDATE' AND NEW.tenant_id IS NOT DISTINCT FROM OLD.tenant_id
     AND ref IS NOT DISTINCT FROM (to_jsonb(OLD)->>TG_ARGV[i*2])::uuid THEN
   CONTINUE;
  END IF;
  IF ref IS NOT NULL THEN
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM %I WHERE id=$1 AND tenant_id=$2)',TG_ARGV[i*2+1]) INTO valid USING ref,NEW.tenant_id;
   IF NOT valid THEN RAISE EXCEPTION 'related resource not found' USING ERRCODE='23503'; END IF;
  END IF;
 END LOOP;
 RETURN NEW;
END $$;

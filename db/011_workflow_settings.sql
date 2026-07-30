-- =====================================================================
-- ORVYN OS · Configurações de workflow + webhook de entrada (SPRINT E.2)
-- Migration 011. Aditiva e idempotente. Rodar com owner/superuser APÓS 010.
--
-- Estas colunas são o que separa "automação legal na demo" de "automação que
-- não queima a lista do cliente": reentrada, parar no reply e janela de envio.
-- =====================================================================

-- Reentrada: o MESMO contato pode entrar de novo no fluxo?
-- `uma_vez` (padrão) protege contra o erro mais comum: contato recebendo a
-- mesma sequência 3x porque o gatilho disparou 3x.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS reentrada TEXT NOT NULL DEFAULT 'uma_vez';
DO $$ BEGIN
  ALTER TABLE workflows ADD CONSTRAINT workflows_reentrada_chk CHECK (reentrada IN ('uma_vez', 'sempre', 'apos_terminar'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Se o contato responder no WhatsApp, a execução para (ele virou conversa humana).
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS parar_no_reply BOOLEAN NOT NULL DEFAULT false;

-- Janela de envio: fora dela, a ação de mensagem espera até abrir.
-- Sem isso, uma espera de 2 dias entrega "Oi!" às 3h da manhã.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS janela_ativa BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS janela_dias INT[] NOT NULL DEFAULT '{1,2,3,4,5}';  -- 0=domingo … 6=sábado
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS janela_inicio SMALLINT NOT NULL DEFAULT 9;         -- hora local
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS janela_fim SMALLINT NOT NULL DEFAULT 18;
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo';
DO $$ BEGIN
  ALTER TABLE workflows ADD CONSTRAINT workflows_janela_chk CHECK (janela_inicio BETWEEN 0 AND 23 AND janela_fim BETWEEN 1 AND 24 AND janela_inicio < janela_fim);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Gatilho por webhook: chave pública da URL. Só é gerada quando o fluxo usa o
-- nó `gatilho.webhook`; é aleatória e revogável (regenerar troca a URL).
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS webhook_key TEXT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_workflows_webhook_key ON workflows (webhook_key) WHERE webhook_key IS NOT NULL;

-- Reentrada `uma_vez`: um contato, uma execução por workflow.
-- Índice parcial (só runs com contato) — o unique é garantido na aplicação,
-- porque `sempre`/`apos_terminar` precisam de várias linhas por contato.
CREATE INDEX IF NOT EXISTS idx_wf_runs_contato ON workflow_runs (tenant_id, workflow_id, contact_id) WHERE contact_id IS NOT NULL;

-- Espera-por-resposta: acha rápido os runs parados aguardando um contato falar.
CREATE INDEX IF NOT EXISTS idx_wf_runs_aguardando ON workflow_runs (tenant_id, contact_id) WHERE status = 'esperando';

-- ---------------------------------------------------------------------
-- Roteamento do webhook de entrada: chave → tenant. Mesma justificativa das
-- migrations 008/009 — a rota é pública e chega sem tenant; a função devolve
-- SOMENTE o par (tenant_id, workflow_id) de roteamento.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION resolve_workflow_by_webhook_key(p_key TEXT)
RETURNS TABLE (tenant_id UUID, workflow_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.tenant_id, w.id
  FROM workflows w
  WHERE w.webhook_key = p_key AND w.status = 'ativo'
  LIMIT 1;
$$;
ALTER FUNCTION resolve_workflow_by_webhook_key(TEXT) OWNER TO orvyn_service;
REVOKE ALL ON FUNCTION resolve_workflow_by_webhook_key(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_workflow_by_webhook_key(TEXT) TO orvyn_app;

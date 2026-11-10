-- =====================================================================
-- 036_message_origin.sql — origem da mensagem no Inbox (automação/humano/IA)
--
-- Contexto: `messages.autor_tipo` já distinguia `contato | humano | ia`
-- (+ `agent_id` quando é IA), mas uma automação que envia WhatsApp
-- (`automations/executor.service.ts`) chamava `send()` sem autoria —
-- ficava gravada como `humano` genérico, indistinguível de um atendente
-- de verdade digitando. E nem o atendente humano tinha quem era
-- persistido. Sem isso, o Inbox não tem como mostrar a origem (pedido do
-- usuário, "como no GHL").
--
-- ADITIVA: só colunas novas, nulas, sem mudar significado de linha
-- existente. `autor_tipo='automacao'` passa a ser um valor válido a mais
-- (coluna já era TEXT livre, sem CHECK) — nenhuma migração de dados.
--
-- Rollback (manual, na ordem):
--   BEGIN;
--   DROP TRIGGER IF EXISTS tenant_reference ON messages;
--   CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON messages
--     FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('conversation_id', 'conversations', 'agent_id', 'agents');
--   ALTER TABLE messages DROP COLUMN IF EXISTS workflow_id, DROP COLUMN IF EXISTS enviado_por_id;
--   COMMIT;
-- =====================================================================

BEGIN;

-- `workflow_id`: qual automação mandou (autor_tipo='automacao'). Tenant-checado
-- (como agent_id) — automação é sempre do mesmo tenant da conversa.
-- `enviado_por_id`: qual identidade digitou (autor_tipo='humano'). Mesma regra
-- de `conversations.assignee_id` (db/030): aponta para `identities`, que é
-- global (uma identidade cobre vários tenants) — por isso FICA DE FORA do
-- trigger de referência cross-tenant, igual ao assignee_id já é.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS workflow_id     UUID NULL REFERENCES workflows(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enviado_por_id  UUID NULL REFERENCES identities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_workflow ON messages (tenant_id, workflow_id) WHERE workflow_id IS NOT NULL;

-- Substitui o trigger de db/030 (que só checava conversation_id/agent_id)
-- por um que também cobre workflow_id.
DROP TRIGGER IF EXISTS tenant_reference ON messages;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('conversation_id', 'conversations', 'agent_id', 'agents', 'workflow_id', 'workflows');

COMMIT;

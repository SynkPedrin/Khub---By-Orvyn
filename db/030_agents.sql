-- =====================================================================
-- 030_agents.sql — Agent Manager + atendimento IA↔humano no Inbox
-- ADR-0030 · Sprint AG · Tasks RV-03.1 e RV-06.1
--
-- ADITIVA: só cria tabelas/colunas novas. Nenhum dado existente muda de
-- significado — toda conversa já existente fica `atendimento='humano'`
-- (o comportamento de hoje: só humano responde).
--
-- Rollback (manual, na ordem):
--   BEGIN;
--   DROP TRIGGER IF EXISTS tenant_reference ON agent_runs;
--   ALTER TABLE messages      DROP COLUMN IF EXISTS agent_id;
--   ALTER TABLE conversations DROP COLUMN IF EXISTS handoff_at, DROP COLUMN IF EXISTS handoff_motivo,
--                             DROP COLUMN IF EXISTS assignee_id, DROP COLUMN IF EXISTS agent_id,
--                             DROP COLUMN IF EXISTS atendimento;
--   DROP TABLE IF EXISTS agent_runs;
--   DROP TABLE IF EXISTS agents;
--   -- e recriar os triggers tenant_reference de conversations/messages com os
--   -- argumentos de db/022 (sem agent_id).
--   COMMIT;
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- agents — agente configurável pelo cliente (modelo, prompt, personalidade,
-- ferramentas, limites, conhecimento). Validação de modelo e ferramentas
-- contra a allowlist mora na API (muda com o catálogo, não com o schema).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agents (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome                    TEXT NOT NULL,
  descricao               TEXT NULL,
  status                  TEXT NOT NULL DEFAULT 'rascunho',
  modelo                  TEXT NOT NULL,
  instrucoes              TEXT NOT NULL DEFAULT '',
  tom                     TEXT NOT NULL DEFAULT 'cordial',
  personalidade           TEXT NOT NULL DEFAULT '',
  ferramentas             TEXT[] NOT NULL DEFAULT '{}',
  conhecimento_ativo      BOOLEAN NOT NULL DEFAULT true,
  conhecimento_escopos    TEXT[] NOT NULL DEFAULT '{tenant,sub,nicho,global}',
  max_respostas_conversa  INT NOT NULL DEFAULT 20,
  max_caracteres          INT NOT NULL DEFAULT 600,
  canais                  TEXT[] NOT NULL DEFAULT '{WhatsApp}',
  padrao                  BOOLEAN NOT NULL DEFAULT false,
  created_by              UUID NULL,               -- identities.id de quem criou
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agents_nome_chk        CHECK (length(nome) BETWEEN 1 AND 80),
  CONSTRAINT agents_status_chk      CHECK (status IN ('rascunho', 'ativo', 'pausado', 'arquivado')),
  CONSTRAINT agents_tom_chk         CHECK (tom IN ('cordial', 'formal', 'direto', 'descontraido')),
  CONSTRAINT agents_instrucoes_chk  CHECK (length(instrucoes) <= 8000),
  CONSTRAINT agents_person_chk      CHECK (length(personalidade) <= 1000),
  CONSTRAINT agents_respostas_chk   CHECK (max_respostas_conversa BETWEEN 1 AND 200),
  CONSTRAINT agents_caracteres_chk  CHECK (max_caracteres BETWEEN 80 AND 2000)
);
CREATE INDEX IF NOT EXISTS idx_agents_tenant ON agents (tenant_id, status);
-- No máximo UM agente padrão por tenant (é ele que assume conversa nova).
CREATE UNIQUE INDEX IF NOT EXISTS agents_um_padrao ON agents (tenant_id) WHERE padrao AND status <> 'arquivado';

-- ---------------------------------------------------------------------
-- agent_runs — um registro por mensagem do contato processada pelo agente.
-- UNIQUE(tenant_id, message_id) é a idempotência do runtime: a mesma
-- mensagem entregue duas vezes ao worker não gera duas respostas nem duas
-- idas ao modelo.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_runs (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id             UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id      UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id           UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'processando',
  motivo               TEXT NULL,
  resposta_message_id  UUID NULL,
  tools                JSONB NOT NULL DEFAULT '[]'::jsonb,
  fontes               JSONB NOT NULL DEFAULT '[]'::jsonb,
  modelo               TEXT NULL,
  tokens_entrada       INT NOT NULL DEFAULT 0,
  tokens_saida         INT NOT NULL DEFAULT 0,
  custo_usd            NUMERIC(12, 6) NOT NULL DEFAULT 0,
  latencia_ms          INT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at          TIMESTAMPTZ NULL,
  CONSTRAINT agent_runs_status_chk CHECK (status IN ('processando', 'respondido', 'transferido', 'ignorado', 'erro'))
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_por_mensagem ON agent_runs (tenant_id, message_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_conv ON agent_runs (tenant_id, conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs (tenant_id, agent_id, created_at);

-- ---------------------------------------------------------------------
-- Atendimento na conversa (RV-06.1): quem responde agora, qual agente,
-- qual humano é o responsável e por que houve transferência.
-- ---------------------------------------------------------------------
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS atendimento     TEXT NOT NULL DEFAULT 'humano',
  ADD COLUMN IF NOT EXISTS agent_id        UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assignee_id     UUID NULL REFERENCES identities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS handoff_motivo  TEXT NULL,
  ADD COLUMN IF NOT EXISTS handoff_at      TIMESTAMPTZ NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_atendimento_chk') THEN
    ALTER TABLE conversations ADD CONSTRAINT conversations_atendimento_chk CHECK (atendimento IN ('ia', 'humano'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_atendimento ON conversations (tenant_id, atendimento, status);
CREATE INDEX IF NOT EXISTS idx_conversations_assignee ON conversations (tenant_id, assignee_id) WHERE assignee_id IS NOT NULL;

-- Mensagem escrita por um agente: atribuição para auditoria e analytics (RV-08.3).
ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id UUID NULL REFERENCES agents(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- RLS — mesmo padrão das demais (db/013).
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['agents', 'agent_runs']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO orvyn_app, orvyn_service', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Referência cross-tenant (db/022): um id de agente/conversa/mensagem de
-- OUTRO tenant é recusado no banco, não só na API.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS tenant_reference ON conversations;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference('contact_id', 'contacts', 'agent_id', 'agents');

DROP TRIGGER IF EXISTS tenant_reference ON messages;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON messages
  FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference('conversation_id', 'conversations', 'agent_id', 'agents');

DROP TRIGGER IF EXISTS tenant_reference ON agent_runs;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference('agent_id', 'agents', 'conversation_id', 'conversations', 'message_id', 'messages');

COMMIT;

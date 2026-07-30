-- =====================================================================
-- ORVYN OS · Nyro IA (SPRINT F / F3) — schema + RLS
-- Migration 013. Aditiva e idempotente. Rodar com owner/superuser APÓS 012.
--
-- PRD §5: orquestrador multi-agente, tools tipadas (nunca escrita direta),
-- memória em 3 níveis, human-in-the-loop, guardrails por nicho.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Conversas com a Nyro. `agente` guarda quem respondeu (roteador → sub-agente),
-- para dar para auditar decisão ruim e medir qualidade por papel.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nyro_conversations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identity_id UUID NULL,                       -- quem abriu (identities.id)
  titulo      TEXT NULL,
  contexto    JSONB NOT NULL DEFAULT '{}'::jsonb,  -- de onde foi aberta (tela, contato...)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nyro_conv_tenant ON nyro_conversations (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS nyro_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES nyro_conversations(id) ON DELETE CASCADE,
  papel           TEXT NOT NULL,               -- user | assistant | tool
  conteudo        TEXT NOT NULL DEFAULT '',
  agente          TEXT NULL,                   -- roteador | configuracao | conversas | growth | consultoria
  tools           JSONB NOT NULL DEFAULT '[]'::jsonb,  -- chamadas feitas neste turno
  fontes          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- chunks do RAG citados (rastreabilidade)
  guardrail       TEXT NULL,                   -- motivo, quando a resposta foi barrada
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nyro_messages_papel_chk CHECK (papel IN ('user', 'assistant', 'tool'))
);
CREATE INDEX IF NOT EXISTS idx_nyro_msg_conv ON nyro_messages (tenant_id, conversation_id, created_at);

-- ---------------------------------------------------------------------
-- Human-in-the-loop (PRD §5.1 e invariante do CLAUDE.md): ação sensível não
-- executa; fica aqui esperando o humano aprovar no chat.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nyro_actions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NULL REFERENCES nyro_conversations(id) ON DELETE CASCADE,
  tool            TEXT NOT NULL,
  argumentos      JSONB NOT NULL DEFAULT '{}'::jsonb,
  resumo          TEXT NOT NULL,               -- o que a Nyro vai fazer, em português
  status          TEXT NOT NULL DEFAULT 'pendente',  -- pendente | aprovada | recusada | executada | falhou
  resultado       JSONB NULL,
  erro            TEXT NULL,
  decidido_por    UUID NULL,
  decidido_em     TIMESTAMPTZ NULL,
  expira_em       TIMESTAMPTZ NOT NULL DEFAULT now() + interval '24 hours',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nyro_actions_status_chk CHECK (status IN ('pendente','aprovada','recusada','executada','falhou'))
);
CREATE INDEX IF NOT EXISTS idx_nyro_actions_pend ON nyro_actions (tenant_id, created_at DESC) WHERE status = 'pendente';

-- ---------------------------------------------------------------------
-- Memória nível 2 (conta): fatos do negócio que a Nyro aprende e reusa.
-- Nível 1 é a conversa (nyro_messages); nível 3 é o RAG (rag_chunks).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nyro_memory (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave       TEXT NOT NULL,                   -- ex.: ticket_medio, tom_de_voz, horario_atendimento
  valor       TEXT NOT NULL,
  origem      TEXT NOT NULL DEFAULT 'nyro',    -- nyro | humano
  confianca   REAL NOT NULL DEFAULT 1.0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, chave)
);

-- ---------------------------------------------------------------------
-- Custo por tenant. Sem isto, a conta da Anthropic chega no fim do mês sem
-- ninguém saber quem gastou — e não dá para cobrar crédito de IA por plano.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_usage_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NULL,
  agente          TEXT NOT NULL,
  modelo          TEXT NOT NULL,
  tokens_entrada  INT NOT NULL DEFAULT 0,
  tokens_saida    INT NOT NULL DEFAULT 0,
  tokens_cache    INT NOT NULL DEFAULT 0,
  custo_usd       NUMERIC(10,6) NOT NULL DEFAULT 0,
  latencia_ms     INT NULL,
  erro            TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant ON ai_usage_events (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- RLS — mesmo padrão das demais.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nyro_conversations','nyro_messages','nyro_actions','nyro_memory','ai_usage_events']
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
END$$;

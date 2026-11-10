-- =====================================================================
-- ORVYN OS · Motor de Automações (SPRINT E / F4) — schema + RLS
-- Migration 010. Aditiva e idempotente. Rodar com owner/superuser APÓS 009.
-- PRD §7.2: execução event-driven, estado por run, retry/fallback/DLQ,
-- logs nó-a-nó, versionamento (publicar/rascunho/rollback).
-- =====================================================================

-- ---------------------------------------------------------------------
-- workflows — o "produto" que o usuário nomeia e liga/desliga.
-- O GRAFO NÃO mora aqui: mora na versão (rascunho editável x publicada).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflows (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  descricao   TEXT NULL,
  status      TEXT NOT NULL DEFAULT 'rascunho',   -- rascunho | ativo | pausado
  versao_ativa_id UUID NULL,                      -- FK adicionada depois (dependência circular)
  criado_por  UUID NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workflows_status_chk CHECK (status IN ('rascunho','ativo','pausado'))
);
CREATE INDEX IF NOT EXISTS idx_workflows_tenant ON workflows (tenant_id, status);

-- ---------------------------------------------------------------------
-- workflow_versions — imutável depois de publicada. É isto que dá rollback
-- e o que permite uma espera de 7 dias terminar com a MESMA lógica que
-- começou, mesmo que o usuário edite o workflow no meio do caminho.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_versions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  versao       INT  NOT NULL,
  grafo        JSONB NOT NULL DEFAULT '{"nos":[],"arestas":[]}'::jsonb,
  publicado_em TIMESTAMPTZ NULL,                  -- NULL = rascunho
  publicado_por UUID NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, versao)
);
CREATE INDEX IF NOT EXISTS idx_wf_versions ON workflow_versions (tenant_id, workflow_id, versao DESC);

DO $$ BEGIN
  ALTER TABLE workflows ADD CONSTRAINT workflows_versao_ativa_fk
    FOREIGN KEY (versao_ativa_id) REFERENCES workflow_versions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- workflow_runs — uma execução. `estado` é o snapshot do contexto (PRD §7.2):
-- é o que permite retomar espera de dias sem perder dado.
-- `dedupe_key` mata o gatilho duplicado (mesmo evento entregue 2x).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_runs (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id  UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_id   UUID NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  gatilho      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'rodando',   -- rodando | esperando | concluido | falhou | cancelado
  no_atual     TEXT NULL,
  estado       JSONB NOT NULL DEFAULT '{}'::jsonb,
  contexto     JSONB NOT NULL DEFAULT '{}'::jsonb, -- contato/negócio/mensagem que dispararam
  contact_id   UUID NULL REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id      UUID NULL REFERENCES deals(id) ON DELETE SET NULL,
  dedupe_key   TEXT NULL,
  erro         TEXT NULL,
  passos       INT NOT NULL DEFAULT 0,            -- guarda contra loop infinito (ir_para)
  teste        BOOLEAN NOT NULL DEFAULT false,    -- PRD §7.2: teste com contato fake
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ NULL,
  CONSTRAINT workflow_runs_status_chk CHECK (status IN ('rodando','esperando','concluido','falhou','cancelado'))
);
CREATE INDEX IF NOT EXISTS idx_wf_runs_tenant ON workflow_runs (tenant_id, workflow_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_wf_runs_status ON workflow_runs (tenant_id, status) WHERE status IN ('rodando','esperando');
-- idempotência do gatilho: o mesmo evento não abre duas execuções
CREATE UNIQUE INDEX IF NOT EXISTS uq_wf_runs_dedupe ON workflow_runs (workflow_id, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ---------------------------------------------------------------------
-- workflow_run_steps — log nó-a-nó (PRD §7.2: timeline visual da execução).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_run_steps (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id      UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  no_id       TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  status      TEXT NOT NULL,                      -- ok | falhou | pulado | esperando
  tentativa   INT NOT NULL DEFAULT 1,
  entrada     JSONB NOT NULL DEFAULT '{}'::jsonb,
  saida       JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro        TEXT NULL,
  duracao_ms  INT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_steps_run ON workflow_run_steps (tenant_id, run_id, created_at);

-- ---------------------------------------------------------------------
-- workflow_dlq — dead-letter (PRD §7.2). Nó que esgotou retry cai aqui com o
-- payload inteiro, para reprocessar sem perder o trabalho já feito.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS workflow_dlq (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_id      UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  no_id       TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  erro        TEXT NOT NULL,
  tentativas  INT NOT NULL DEFAULT 0,
  resolvido_em TIMESTAMPTZ NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wf_dlq_tenant ON workflow_dlq (tenant_id, created_at DESC) WHERE resolvido_em IS NULL;

-- ---------------------------------------------------------------------
-- RLS — mesmo padrão do 003/009.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflows','workflow_versions','workflow_runs','workflow_run_steps','workflow_dlq']
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

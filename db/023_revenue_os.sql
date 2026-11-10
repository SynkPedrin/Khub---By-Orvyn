-- =====================================================================
-- ORVYN Revenue OS — migration 023
-- =====================================================================
-- Transformação ORVYN OS → ORVYN Revenue OS.
--
-- ESTRITAMENTE ADITIVA. Não derruba tabela, não renomeia coluna, não
-- apaga dado. Toda coluna nova é nullable ou tem DEFAULT, então o código
-- em produção continua funcionando antes e depois de aplicar.
--
-- Ordem de deploy segura:
--   1. aplicar esta migration
--   2. subir API/worker
-- (o inverso também funciona: nada aqui é exigido pelo código anterior)
--
-- Isolamento: toda tabela nova nasce com RLS habilitada + FORCE, seguindo
-- o padrão de 021/022. Vazamento cross-tenant é incidente de LGPD, não bug.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. SCORE ORVYN e atributos de Lead em `contacts`
-- ---------------------------------------------------------------------
-- `contacts` continua sendo a entidade de pessoa. "Lead" é um ESTADO dela,
-- não uma tabela separada: duplicar a entidade criaria dois lugares para a
-- mesma pessoa e um problema permanente de sincronização.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score smallint;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score_version text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score_at timestamptz;
-- Fatores que produziram o score, para explicar o número ao vendedor.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS score_fatores jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS cargo text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS origem text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS localizacao text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS site text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin text;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS proxima_acao_at timestamptz;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS proxima_acao_tipo text;

-- Faixa válida do score. NULL é permitido e SIGNIFICATIVO: "ainda sem
-- sinais para pontuar" não é a mesma coisa que "score zero".
ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_score_faixa;
ALTER TABLE contacts ADD CONSTRAINT contacts_score_faixa
  CHECK (score IS NULL OR (score >= 0 AND score <= 100));

-- Fila de trabalho do vendedor: "quentes primeiro, dentro do meu tenant".
CREATE INDEX IF NOT EXISTS contacts_score_desc
  ON contacts(tenant_id, score DESC NULLS LAST);

-- "O que é meu e está esperando ação."
CREATE INDEX IF NOT EXISTS contacts_owner_proxima_acao
  ON contacts(tenant_id, owner_id, proxima_acao_at)
  WHERE proxima_acao_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. CAMPANHAS
-- ---------------------------------------------------------------------
-- Módulo novo. Nesta fase guarda definição e métricas; o DISPARO fica
-- desligado no código até existirem opt-out, limite por conta e auditoria
-- de envio. Ver docs/ORVYN_REVENUE_ARCHITECTURE.md §Campanhas.

CREATE TABLE IF NOT EXISTS campaigns (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome text NOT NULL,
  subtitulo text,
  descricao text,
  status text NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho','ativa','pausada','arquivada')),
  canais text[] NOT NULL DEFAULT '{}',
  publico_rotulo text,
  publico_filtro jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Janela de envio e dias permitidos: a campanha NÃO dispara fora disso.
  janela_inicio time,
  janela_fim time,
  dias_semana smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',
  fuso text NOT NULL DEFAULT 'America/Sao_Paulo',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS campaigns_tenant_status
  ON campaigns(tenant_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS campaign_steps (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  ordem smallint NOT NULL,
  canal text NOT NULL,
  titulo text NOT NULL,
  descricao text,
  -- Dia relativo ao início da sequência para este contato (não data fixa).
  dia smallint NOT NULL DEFAULT 1,
  template jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, ordem)
);

CREATE INDEX IF NOT EXISTS campaign_steps_campanha
  ON campaign_steps(tenant_id, campaign_id, ordem);

-- Métricas agregadas por dia. Agregado, e não contagem ao vivo sobre a
-- tabela de envios: o painel precisa responder rápido com milhões de linhas.
CREATE TABLE IF NOT EXISTS campaign_metrics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  dia date NOT NULL,
  envios integer NOT NULL DEFAULT 0,
  respostas integer NOT NULL DEFAULT 0,
  reunioes integer NOT NULL DEFAULT 0,
  receita numeric(12,2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, dia)
);

CREATE INDEX IF NOT EXISTS campaign_metrics_periodo
  ON campaign_metrics(tenant_id, campaign_id, dia DESC);

-- Participação de um contato numa campanha. `UNIQUE(campaign_id, contact_id)`
-- é a garantia estrutural de que ninguém entra duas vezes na mesma cadência.
CREATE TABLE IF NOT EXISTS campaign_enrollments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  step_atual smallint NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo','respondeu','concluido','removido','opt_out')),
  proximo_envio_at timestamptz,
  entrou_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, contact_id)
);

CREATE INDEX IF NOT EXISTS campaign_enrollments_due
  ON campaign_enrollments(tenant_id, proximo_envio_at)
  WHERE status = 'ativo';

-- ---------------------------------------------------------------------
-- 3. RLS — nenhuma tabela nova entra sem isolamento
-- ---------------------------------------------------------------------

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON campaigns;
CREATE POLICY tenant_rw ON campaigns FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaigns TO orvyn_app, orvyn_service;

ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_steps FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON campaign_steps;
CREATE POLICY tenant_rw ON campaign_steps FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_steps TO orvyn_app, orvyn_service;

ALTER TABLE campaign_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_metrics FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON campaign_metrics;
CREATE POLICY tenant_rw ON campaign_metrics FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_metrics TO orvyn_app, orvyn_service;

ALTER TABLE campaign_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_enrollments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON campaign_enrollments;
CREATE POLICY tenant_rw ON campaign_enrollments FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON campaign_enrollments TO orvyn_app, orvyn_service;

-- ---------------------------------------------------------------------
-- 4. Registro de execuções de IA por provedor
-- ---------------------------------------------------------------------
-- Com a abstração `AIProvider`, o mesmo tenant pode rodar em fornecedores
-- diferentes ao longo do tempo. Sem gravar QUAL provedor atendeu, a conta
-- de custo deixa de fechar e não dá para comparar qualidade entre eles.

ALTER TABLE ai_usage_events ADD COLUMN IF NOT EXISTS provedor text;
CREATE INDEX IF NOT EXISTS ai_usage_provedor
  ON ai_usage_events(tenant_id, provedor, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. Marcação de dado de demonstração
-- ---------------------------------------------------------------------
-- Permite semear um tenant de vitrine e apagá-lo depois com uma linha, sem
-- risco de levar junto dado de cliente.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMIT;

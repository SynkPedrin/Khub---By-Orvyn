-- 028_billing.sql — Assinatura do PRÓPRIO Orvyn (billing da plataforma).
--
-- Não confundir com `financeiro_cobrancas` (020): aquela é o tenant cobrando
-- OS CLIENTES DELE; esta é o tenant pagando o Orvyn pelo uso da plataforma.
-- Mesma conta Stripe, tabelas e webhooks separados.
--
-- Preço não é decisão de engenharia (PRD §17 marca LACUNA explícita: "não
-- define preços em R$"). Por isso `plano` é texto livre (Starter/Growth/
-- Scale, ver PRD) e o valor/Price ID real vem de env (`STRIPE_PRICE_*`),
-- nunca hardcoded aqui — igual ao resto do gating por credencial do projeto.

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plano                  TEXT NOT NULL CHECK (plano IN ('starter','growth','scale')),
  status                 TEXT NOT NULL DEFAULT 'incompleta'
                           CHECK (status IN ('incompleta','ativa','inadimplente','cancelada','pausada')),
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT UNIQUE,
  current_period_end     TIMESTAMPTZ,
  cancel_at_period_end   BOOLEAN NOT NULL DEFAULT false,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- V1: uma assinatura ativa por tenant (upgrade/downgrade troca o plano na
  -- mesma linha, não cria outra). Histórico de mudança fica no audit_logs.
  UNIQUE (tenant_id)
);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_subscriptions_customer ON subscriptions (stripe_customer_id);
-- ==SPLIT==
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
-- ==SPLIT==
ALTER TABLE subscriptions FORCE ROW LEVEL SECURITY;
-- ==SPLIT==
DROP POLICY IF EXISTS tenant_rw ON subscriptions;
-- ==SPLIT==
CREATE POLICY tenant_rw ON subscriptions FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- ==SPLIT==
GRANT SELECT, INSERT, UPDATE, DELETE ON subscriptions TO orvyn_app, orvyn_service;

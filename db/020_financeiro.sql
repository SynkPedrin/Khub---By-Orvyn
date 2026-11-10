-- 020_financeiro.sql — Cobranças do tenant (Financeiro). Valores em CENTAVOS
-- (inteiro, nunca float). Gerenciamento é local e real; o link de pagamento
-- Stripe é gated (config_required até STRIPE_SECRET_KEY). RLS padrão por tenant.
-- Aplicar:  node scripts/apply-sql.mjs db/020_financeiro.sql

CREATE TABLE IF NOT EXISTS financeiro_cobrancas (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id            UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id               UUID REFERENCES deals(id) ON DELETE SET NULL,
  descricao             TEXT NOT NULL,
  valor_centavos        INTEGER NOT NULL CHECK (valor_centavos >= 0),
  moeda                 TEXT NOT NULL DEFAULT 'BRL',
  status                TEXT NOT NULL DEFAULT 'rascunho'
                          CHECK (status IN ('rascunho','enviada','paga','vencida','cancelada')),
  vencimento            DATE,
  pago_em               TIMESTAMPTZ,
  stripe_payment_intent TEXT,
  stripe_checkout_url   TEXT,
  created_by            UUID,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_fin_cob_tenant ON financeiro_cobrancas (tenant_id, created_at DESC);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_fin_cob_contato ON financeiro_cobrancas (tenant_id, contact_id);
-- ==SPLIT==
-- Fila de vencidas: a receber com data passada (usada pelo status/relatório).
CREATE INDEX IF NOT EXISTS idx_fin_cob_venc ON financeiro_cobrancas (tenant_id, vencimento)
  WHERE status IN ('enviada','rascunho');
-- ==SPLIT==
ALTER TABLE financeiro_cobrancas ENABLE ROW LEVEL SECURITY;
-- ==SPLIT==
ALTER TABLE financeiro_cobrancas FORCE  ROW LEVEL SECURITY;
-- ==SPLIT==
DROP POLICY IF EXISTS tenant_rw ON financeiro_cobrancas;
-- ==SPLIT==
CREATE POLICY tenant_rw ON financeiro_cobrancas FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- ==SPLIT==
GRANT SELECT, INSERT, UPDATE, DELETE ON financeiro_cobrancas TO orvyn_app, orvyn_service;

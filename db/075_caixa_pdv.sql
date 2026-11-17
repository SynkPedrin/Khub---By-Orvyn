-- =====================================================================
-- 075_caixa_pdv.sql — Caixa de operação (PDV) no Financeiro (ADR-0051)
--
-- Pedido do product owner (2026-11-17, Studio da Beleza): o "Entradas e
-- saídas" vira o caixa que fica na recepção cadastrando as vendas.
--  - forma de pagamento (dinheiro, débito, crédito com parcelas, pix) no
--    lugar da observação;
--  - venda de produto do estoque (autocompletar) baixa o estoque;
--  - profissional = colaboradora do catálogo com comissão configurada
--    (as profissionais do salão não são usuárias do KHUB);
--  - cancelar/editar venda e abrir Visão geral/Comissões exigem a senha do
--    financeiro (só o hash fica no banco, em tabela própria com RLS).
--
-- Aditiva: colunas novas anuláveis, CHECKs ampliados, tabela nova.
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS financeiro_config;
--   ALTER TABLE estoque_movimentos DROP COLUMN IF EXISTS transacao_id;
--   ALTER TABLE financeiro_transacoes DROP COLUMN IF EXISTS forma_pagamento, DROP COLUMN IF EXISTS parcelas,
--     DROP COLUMN IF EXISTS produto_id, DROP COLUMN IF EXISTS quantidade,
--     DROP COLUMN IF EXISTS cancelada_em, DROP COLUMN IF EXISTS cancelada_por, DROP COLUMN IF EXISTS motivo_cancelamento;
--   (e restaurar os CHECKs de status/origem da db/070 e db/071)
--   COMMIT;
-- =====================================================================

BEGIN;

-- ---------------------------- lançamentos ----------------------------
ALTER TABLE financeiro_transacoes
  ADD COLUMN IF NOT EXISTS forma_pagamento TEXT,
  ADD COLUMN IF NOT EXISTS parcelas SMALLINT,
  ADD COLUMN IF NOT EXISTS produto_id UUID REFERENCES produtos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS quantidade NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS cancelada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelada_por UUID,
  ADD COLUMN IF NOT EXISTS motivo_cancelamento TEXT;

ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS fin_tx_forma_chk;
ALTER TABLE financeiro_transacoes ADD CONSTRAINT fin_tx_forma_chk
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN ('dinheiro','debito','credito','pix'));
ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS fin_tx_parcelas_chk;
ALTER TABLE financeiro_transacoes ADD CONSTRAINT fin_tx_parcelas_chk
  CHECK (parcelas IS NULL OR (parcelas BETWEEN 1 AND 24 AND forma_pagamento = 'credito'));
ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS fin_tx_quantidade_chk;
ALTER TABLE financeiro_transacoes ADD CONSTRAINT fin_tx_quantidade_chk
  CHECK (quantidade IS NULL OR quantidade > 0);
ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS fin_tx_motivo_cancel_chk;
ALTER TABLE financeiro_transacoes ADD CONSTRAINT fin_tx_motivo_cancel_chk
  CHECK (motivo_cancelamento IS NULL OR length(motivo_cancelamento) <= 300);
-- Venda cancelada continua no histórico (auditoria), fora de todos os totais (que somam só 'pago').
ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS financeiro_transacoes_status_check;
ALTER TABLE financeiro_transacoes ADD CONSTRAINT financeiro_transacoes_status_check
  CHECK (status IN ('pago','pendente','cancelada'));

CREATE INDEX IF NOT EXISTS idx_fin_tx_produto ON financeiro_transacoes (tenant_id, produto_id) WHERE produto_id IS NOT NULL;

-- Comissão de colaboradora do catálogo (profissional_id) já existe desde a db/071.

-- ------------------------------ estoque ------------------------------
ALTER TABLE estoque_movimentos ADD COLUMN IF NOT EXISTS transacao_id UUID REFERENCES financeiro_transacoes(id) ON DELETE SET NULL;
ALTER TABLE estoque_movimentos DROP CONSTRAINT IF EXISTS estoque_movimentos_origem_check;
ALTER TABLE estoque_movimentos ADD CONSTRAINT estoque_movimentos_origem_check
  CHECK (origem IN ('manual','importacao','venda'));
CREATE INDEX IF NOT EXISTS idx_estoque_mov_transacao ON estoque_movimentos (transacao_id) WHERE transacao_id IS NOT NULL;

-- -------------------------- senha do financeiro --------------------------
CREATE TABLE IF NOT EXISTS financeiro_config (
  tenant_id   UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  senha_hash  TEXT CHECK (senha_hash IS NULL OR length(senha_hash) BETWEEN 20 AND 300),
  updated_by  UUID,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE financeiro_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE financeiro_config FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON financeiro_config;
CREATE POLICY tenant_rw ON financeiro_config FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- --------------- referências do MESMO tenant (db/022) ---------------
DO $$
DECLARE fn TEXT;
BEGIN
  SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'função check_tenant_reference ausente (db/022)'; END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON financeiro_transacoes';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON financeiro_transacoes
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', fn,
    'categoria_id', 'financeiro_categorias', 'contact_id', 'contacts',
    'cobranca_id', 'financeiro_cobrancas', 'compromisso_id', 'agenda_compromissos',
    'produto_id', 'produtos', 'profissional_id', 'profissionais');

  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON financeiro_comissoes';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON financeiro_comissoes
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L)', fn,
    'transacao_id', 'financeiro_transacoes', 'pagamento_transacao_id', 'financeiro_transacoes',
    'profissional_id', 'profissionais');

  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON estoque_movimentos';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON estoque_movimentos
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L)', fn,
    'produto_id', 'produtos', 'importacao_id', 'importacoes', 'transacao_id', 'financeiro_transacoes');
END $$;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON financeiro_config TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

-- 015_drip.sql — "Drip mode": liberação em lotes por janela de tempo.
-- Cada linha é (tenant, nó do fluxo, início da janela) → quantos contatos já
-- passaram naquela janela. O nó `controle.drip` incrementa atomicamente e só
-- libera enquanto count <= limite; o resto espera a próxima janela.
-- Aditiva. RLS no mesmo padrão do 010.

CREATE TABLE IF NOT EXISTS workflow_drip_counters (
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  node_id      TEXT        NOT NULL,               -- id do nó no grafo (aleatório, único por fluxo)
  window_start TIMESTAMPTZ NOT NULL,               -- início da janela (truncado)
  count        INTEGER     NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, node_id, window_start)   -- chave do UPSERT atômico
);

-- limpeza futura de janelas antigas
CREATE INDEX IF NOT EXISTS idx_drip_window ON workflow_drip_counters (window_start);

-- RLS + FORCE + policy tenant_rw + grants — idêntico ao 010.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_drip_counters']
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

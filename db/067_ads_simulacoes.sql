-- =====================================================================
-- 067_ads_simulacoes.sql — simulações do Gerenciador salvas por subconta
--
-- Contexto (SIM-5, aprovado pelo product owner em 2026-11-13): as simulações
-- do simulador de campanhas viviam só no localStorage do navegador
-- (`khub:ads-simulador:v2`) — trocou de máquina, perdeu tudo. Agora ficam no
-- banco, por subconta, e a tela usa a API quando disponível.
--
-- Guarda a ENTRADA (campanha + criativos, sem mídia — a mídia nunca sai do
-- navegador) e o RESUMO do resultado (números do cartão da lista). A projeção
-- completa não é persistida: o motor é determinístico (semente fixa), então
-- abrir uma simulação recalcula na hora com o motor vigente.
--
-- Dado de negócio: tenant_id NOT NULL + RLS FORCE + tenant_rw.
-- ADITIVA: só objeto novo. Rollback (manual):
--   BEGIN; DROP TABLE IF EXISTS ads_simulacoes; COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS ads_simulacoes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL,
  entrada     JSONB NOT NULL,
  resumo      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ads_simulacoes_nome_chk    CHECK (length(nome) BETWEEN 1 AND 120),
  CONSTRAINT ads_simulacoes_entrada_chk CHECK (jsonb_typeof(entrada) = 'object'),
  CONSTRAINT ads_simulacoes_resumo_chk  CHECK (jsonb_typeof(resumo) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_ads_simulacoes_tenant ON ads_simulacoes (tenant_id, created_at DESC);

ALTER TABLE ads_simulacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads_simulacoes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON ads_simulacoes;
CREATE POLICY tenant_rw ON ads_simulacoes
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON ads_simulacoes TO khub_app, khub_service;

COMMIT;

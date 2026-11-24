-- 080_links_rastreados.sql — Links rastreados de WhatsApp por campanha.
--
-- Por quê: o WhatsApp só entrega `referral` de anúncio Click-to-WhatsApp da
-- Meta. Anúncio do Google (ou da Meta sem CTWA) que cai no WhatsApp chega sem
-- rastro de campanha. A solução padrão de agência: cada campanha usa um link
-- wa.me com texto inicial único; quando a PRIMEIRA mensagem de um contato novo
-- casa com o texto do link, a origem é gravada como confirmada (db/066).
--
-- Rollback: DROP TABLE links_rastreados;

CREATE TABLE IF NOT EXISTS links_rastreados (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  codigo       TEXT NOT NULL,
  campanha     TEXT NOT NULL,
  fonte        TEXT NOT NULL CHECK (fonte IN ('meta_ads','google_ads','tiktok_ads','organico','outro')),
  conjunto     TEXT,
  criativo     TEXT,
  texto_inicial TEXT NOT NULL,
  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (length(codigo) BETWEEN 2 AND 60),
  CHECK (length(campanha) BETWEEN 1 AND 160),
  CHECK (length(texto_inicial) BETWEEN 3 AND 400)
);
-- ==SPLIT==
CREATE UNIQUE INDEX IF NOT EXISTS uq_links_rastreados_codigo ON links_rastreados (tenant_id, codigo);
-- ==SPLIT==
CREATE INDEX IF NOT EXISTS idx_links_rastreados_ativos ON links_rastreados (tenant_id) WHERE ativo;
-- ==SPLIT==
ALTER TABLE links_rastreados ENABLE ROW LEVEL SECURITY;
-- ==SPLIT==
ALTER TABLE links_rastreados FORCE ROW LEVEL SECURITY;
-- ==SPLIT==
DROP POLICY IF EXISTS tenant_rw ON links_rastreados;
-- ==SPLIT==
CREATE POLICY tenant_rw ON links_rastreados FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
-- ==SPLIT==
GRANT SELECT, INSERT, UPDATE, DELETE ON links_rastreados TO orvyn_app, orvyn_service;

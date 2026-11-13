-- =====================================================================
-- 066_fotos_atribuicao.sql — foto de perfil durável + origem do lead
--
-- Contexto (pedido do product owner, 2026-11-12):
--  1. A foto do WhatsApp/Instagram vinha como URL assinada (pps.whatsapp.net,
--     lookaside do Facebook) que EXPIRA em horas: a tela caía nas iniciais.
--     `contact_fotos` guarda a IMAGEM (bytes, ~5–40 KB) e a API serve por
--     `/v1/crm/contacts/:id/foto`, com cache. A URL original vira só a fonte.
--  2. Rastreio de origem de todo lead novo: `contacts.atribuicao` guarda de
--     onde ele veio de forma estruturada (canal, fonte, anúncio, campanha,
--     criativo, id de clique), preenchido na ENTRADA (webhook) e nunca
--     sobrescrito por um contato posterior (primeiro toque preservado; o
--     último toque fica em `ultimoToque`).
--
-- ADITIVA: tabela nova + coluna nova com default. Nada existente muda.
--
-- Rollback (manual):
--   BEGIN; DROP TABLE IF EXISTS contact_fotos; ALTER TABLE contacts DROP COLUMN IF EXISTS atribuicao; COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS contact_fotos (
  contact_id     UUID PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  mime           TEXT NOT NULL,
  bytes          BYTEA NOT NULL,
  fonte          TEXT NOT NULL,
  atualizada_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT contact_fotos_mime_chk  CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT contact_fotos_tam_chk   CHECK (octet_length(bytes) BETWEEN 1 AND 600000),
  CONSTRAINT contact_fotos_fonte_chk CHECK (fonte IN ('whatsapp', 'instagram', 'messenger'))
);
CREATE INDEX IF NOT EXISTS idx_contact_fotos_tenant ON contact_fotos (tenant_id, atualizada_em);

ALTER TABLE contact_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_fotos FORCE  ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON contact_fotos;
CREATE POLICY tenant_rw ON contact_fotos FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON contact_fotos TO khub_app, khub_service;

-- Foto só aponta para contato do MESMO tenant.
DROP TRIGGER IF EXISTS tenant_reference ON contact_fotos;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON contact_fotos
  FOR EACH ROW EXECUTE FUNCTION khub_check_tenant_reference('contact_id', 'contacts');

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS atribuicao JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_atribuicao_chk') THEN
    ALTER TABLE contacts ADD CONSTRAINT contacts_atribuicao_chk CHECK (jsonb_typeof(atribuicao) = 'object');
  END IF;
END $$;
-- Relatório "leads por fonte/campanha": filtro pelo campo mais usado.
CREATE INDEX IF NOT EXISTS idx_contacts_atrib_fonte ON contacts (tenant_id, (atribuicao->>'fonte'));

COMMIT;

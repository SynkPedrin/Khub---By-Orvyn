-- =====================================================================
-- 037_contact_photos.sql — foto de perfil do WhatsApp no contato
--
-- Contexto: o Inbox mostrava só iniciais coloridas. A instância SM v2 da
-- Stevo expõe `POST /user/avatar` (URL assinada do pps.whatsapp.net), mas
-- essa URL expira — por isso guardamos também QUANDO foi buscada
-- (`foto_em`) para revalidar por TTL na leitura (lazy) e no sync em massa
-- (scripts/operar/sincronizar-avatares.mjs).
--
-- ADITIVA: só colunas novas, nulas. Nenhuma linha existente muda.
--
-- Rollback (manual):
--   BEGIN;
--   ALTER TABLE contacts DROP COLUMN IF EXISTS foto_url, DROP COLUMN IF EXISTS foto_em;
--   COMMIT;
-- =====================================================================

BEGIN;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS foto_url TEXT NULL,
  ADD COLUMN IF NOT EXISTS foto_em  TIMESTAMPTZ NULL;

COMMIT;

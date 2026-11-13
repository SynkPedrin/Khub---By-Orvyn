-- =====================================================================
-- 055b_anexo_tipos_entrada.sql — amplia `messages_anexo_chk` (db/055)
--
-- Contexto: a 055 aceitava em `messages.anexo.tipo` só os tipos de SAÍDA do
-- Inbox (imagem, documento, audio). A mídia RECEBIDA pela Stevo
-- (`stevo-api-eventos.service.ts`, `midia-entrada.ts`) também grava em
-- `messages.anexo`, com `tipo` 'figurinha' ou 'video' — esses UPDATEs eram
-- recusados pelo CHECK e o anexo recebido se perdia. A 055 já está aplicada
-- em DEV, por isso a correção é um arquivo novo (nunca editar migração aplicada).
--
-- ADITIVA: só afrouxa o CHECK. Nenhuma linha existente muda.
--
-- Rollback (manual — falha se já existir anexo 'figurinha'/'video'):
--   BEGIN;
--   ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_anexo_chk;
--   ALTER TABLE messages ADD CONSTRAINT messages_anexo_chk
--     CHECK (anexo IS NULL OR (jsonb_typeof(anexo) = 'object' AND anexo->>'tipo' IN ('imagem', 'documento', 'audio')));
--   DELETE FROM schema_migrations WHERE filename = 'db/055b_anexo_tipos_entrada.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_anexo_chk;
ALTER TABLE messages ADD CONSTRAINT messages_anexo_chk
  CHECK (anexo IS NULL OR (jsonb_typeof(anexo) = 'object' AND anexo->>'tipo' IN ('imagem', 'documento', 'audio', 'figurinha', 'video')));

COMMIT;

-- =====================================================================
-- 069_booking_pessoal.sql — Calendário individual por colaborador
-- (sprint CAL-PESSOAL)
--
-- Contexto: cada membro da equipe publica a própria página de agendamento
-- (/agenda/meu-link → /b/<slug>) sem precisar de admin. Reusa a tabela e
-- todo o fluxo público da db/060: a página pessoal é uma booking_page com
-- `owner_id` preenchido, `responsaveis = [dono]` e `distribuicao = fixo`
-- (o serviço garante; o banco faz de backstop).
--
-- Mudanças:
--   booking_pages.owner_id  UUID NULL → identities(id) ON DELETE SET NULL.
--   Índice único parcial (tenant_id, owner_id): 1 página pessoal por membro.
--   Trigger khub_booking_check_responsaveis estendido: dono precisa ser
--   membro do tenant e estar entre os responsáveis (a reserva cai sempre
--   na agenda dele, e a visão "toda a equipe" agrega de graça).
--
-- Roda no QA (papéis khub_*) e no DEV (papéis orvyn_*).
--
-- Rollback (manual):
--   BEGIN;
--   DROP INDEX IF EXISTS uq_booking_pages_owner;
--   ALTER TABLE booking_pages DROP COLUMN IF EXISTS owner_id;
--   -- restaurar a versão da db/060 de khub_booking_check_responsaveis()
--   DELETE FROM schema_migrations WHERE filename = 'db/069_booking_pessoal.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

ALTER TABLE booking_pages
  ADD COLUMN IF NOT EXISTS owner_id UUID NULL REFERENCES identities(id) ON DELETE SET NULL;

COMMENT ON COLUMN booking_pages.owner_id IS 'Página pessoal: dono (identity) que configurou o próprio link. NULL = página da equipe.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_pages_owner
  ON booking_pages (tenant_id, owner_id) WHERE owner_id IS NOT NULL;

-- Dono precisa ser membro do tenant e estar na fila de responsáveis: a
-- reserva pública sempre vira compromisso na agenda DELE (CAL-02).
CREATE OR REPLACE FUNCTION khub_booking_check_responsaveis() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r uuid;
BEGIN
 FOREACH r IN ARRAY COALESCE(NEW.responsaveis, '{}') LOOP
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.identity_id = r AND m.tenant_id = NEW.tenant_id) THEN
   RAISE EXCEPTION 'responsável não é membro desta conta' USING ERRCODE = '23503';
  END IF;
 END LOOP;
 IF NEW.owner_id IS NOT NULL THEN
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.identity_id = NEW.owner_id AND m.tenant_id = NEW.tenant_id) THEN
   RAISE EXCEPTION 'dono da página não é membro desta conta' USING ERRCODE = '23503';
  END IF;
  IF NOT (NEW.owner_id = ANY(COALESCE(NEW.responsaveis, '{}'))) THEN
   RAISE EXCEPTION 'o dono precisa estar entre os responsáveis' USING ERRCODE = '23514';
  END IF;
 END IF;
 IF cardinality(NEW.responsaveis) > 0 AND NEW.rr_cursor >= cardinality(NEW.responsaveis) THEN
  NEW.rr_cursor := 0;
 END IF;
 RETURN NEW;
END $$;

COMMIT;

-- =====================================================================
-- 065_invite_module_access.sql — Acesso por módulo no convite (ADR-0045)
--
-- Contexto (pedido do product owner, 2026-11-12): a subconta convida os
-- colaboradores da empresa do cliente e escolhe o que cada um vê (Dashboard,
-- Leads, Pipeline, Conversas, Agenda, IA...). O sistema fica aberto na loja
-- do cliente, então o colaborador precisa entrar JÁ restrito: os módulos são
-- escolhidos no convite e copiados para `users.permissoes` no aceite.
--
-- `users.permissoes` (db/004) já existe e não era usado; aqui só o convite
-- ganha a mesma coluna. Aditiva, com default: linhas antigas ficam '{}'
-- (= sem restrição, comportamento de antes). `invites` segue como em db/004
-- (sem RLS, lida só por token/tenant em SettingsService e AuthService).
--
-- Rollback:
--   BEGIN; ALTER TABLE invites DROP COLUMN IF EXISTS permissoes; COMMIT;
-- =====================================================================

BEGIN;

ALTER TABLE invites ADD COLUMN IF NOT EXISTS permissoes jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN invites.permissoes IS
  'Acesso por módulo escolhido no convite ({"modulos": [...]}); vira users.permissoes no aceite (ADR-0045).';

COMMIT;

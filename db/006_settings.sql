-- =====================================================================
-- ORVYN OS · Configurações (perfil, empresa, personalização)
-- Migration 006. Aditiva. Rodar após 000..005.
-- Sem novas tabelas (memberships/invites/audit_logs já existem no 004).
-- =====================================================================

-- Empresa (business profile)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS endereco TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telefone TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS website  TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS idioma   TEXT NOT NULL DEFAULT 'pt-BR';

-- Perfil do usuário: idioma + preferências (personalização do CRM: cor/fundo)
ALTER TABLE users ADD COLUMN IF NOT EXISTS idioma TEXT NOT NULL DEFAULT 'pt-BR';
ALTER TABLE users ADD COLUMN IF NOT EXISTS prefs  JSONB NOT NULL DEFAULT '{}'::jsonb;

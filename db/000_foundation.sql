-- =====================================================================
-- ORVYN · Nyro IA — Fundação mínima para o R0 do RAG
-- Migration 000. Idempotente. Rodar com role owner/superuser.
--
-- Motivo: 001_rag_schema.sql tem FK REFERENCES tenants(id) e as policies
-- de RLS dependem de duas roles (app SEM BYPASSRLS, service COM BYPASSRLS).
-- Nenhuma delas existe ainda (monorepo/F0-09 não foram construídos).
-- Este arquivo cria apenas o suficiente para o R0 do RAG rodar e ser
-- testado. O schema completo de tenants/users/audit é F0-08/F0-09 e
-- irá SUBSTITUIR/ESTENDER esta tabela mínima (ver ADR-0004 em Arquitetura.md).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---------------------------------------------------------------------
-- Tabela mínima de tenants (alinhada ao PRD §12.1; será estendida em F0-09)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tenants (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome              TEXT NOT NULL,
  template_id       TEXT NULL,
  template_version  INT  NULL,
  plano             TEXT NOT NULL DEFAULT 'starter',
  status            TEXT NOT NULL DEFAULT 'active',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Roles de banco (invariante R0.2)
--   orvyn_app     -> role da APLICAÇÃO. NOBYPASSRLS. Sujeita a toda policy.
--   orvyn_service -> role de SERVIÇO. BYPASSRLS. Publica bases global/nicho/sub
--                    e roda jobs de ingestão/curadoria. Nunca exposta ao request web.
--
-- Sem senha aqui de propósito: NUNCA commitar segredo. Defina a senha fora do
-- versionamento (ver db/README.md):
--   ALTER ROLE orvyn_app     PASSWORD :'app_password';
--   ALTER ROLE orvyn_service PASSWORD :'service_password';
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orvyn_app') THEN
    CREATE ROLE orvyn_app LOGIN NOBYPASSRLS;
  ELSE
    ALTER ROLE orvyn_app NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'orvyn_service') THEN
    CREATE ROLE orvyn_service LOGIN BYPASSRLS;
  ELSE
    ALTER ROLE orvyn_service BYPASSRLS;
  END IF;
END$$;

-- Privilégios de schema
GRANT USAGE ON SCHEMA public TO orvyn_app, orvyn_service;

-- tenants: app só lê; service lê e escreve (provisionamento roda pelo service)
GRANT SELECT                         ON tenants TO orvyn_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO orvyn_service;

-- =====================================================================
-- 064_agency_member_prefs.sql — Seletor de subcontas (estilo GHL)
--
-- Contexto (pedido do product owner, 2026-11-12): o seletor de subcontas da
-- sidebar ganha "Recentes" e "Fixar", como o switcher de subcontas do GHL.
-- São preferências POR MEMBRO da agência × subconta:
--   - `fixado`: a subconta aparece no topo de "Todas as contas" para ele;
--   - `ultimo_acesso_em`: gravado quando ele ENTRA na subconta
--     (`AgencyService.ativarCliente`) — alimenta "Recentes".
--
-- Tabela global (como agency_member_client_access, db/026): não tem
-- tenant_id porque pertence à AGÊNCIA, não a um cliente. Toda leitura/escrita
-- passa por AgencyService, que só aceita subcontas VISÍVEIS para o membro
-- (mesma regra de acesso de `clientesVisiveis`). Cascata: sai o membro ou a
-- subconta, saem as preferências.
--
-- Rollback:
--   BEGIN; DROP TABLE IF EXISTS agency_member_client_prefs; COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS agency_member_client_prefs (
  agency_member_id  uuid NOT NULL REFERENCES agency_members(id) ON DELETE CASCADE,
  client_account_id uuid NOT NULL REFERENCES agency_client_accounts(id) ON DELETE CASCADE,
  fixado            boolean NOT NULL DEFAULT false,
  ultimo_acesso_em  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_member_id, client_account_id)
);

-- "Recentes" do membro: as últimas subcontas acessadas.
CREATE INDEX IF NOT EXISTS agency_member_client_prefs_recentes
  ON agency_member_client_prefs (agency_member_id, ultimo_acesso_em DESC)
  WHERE ultimo_acesso_em IS NOT NULL;

-- Papéis: `khub_*` no QA/produção, ainda `orvyn_*` no DEV: roda nos dois
-- (mesmo bloco de db/063).
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON agency_member_client_prefs TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

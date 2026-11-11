-- =====================================================================
-- 051_lost_reasons.sql — motivo de perda e dono do negócio (Q2.1)
--
-- Contexto: marcar um negócio como "perdido" não registrava POR QUÊ, então
-- não havia como analisar perdas (preço? concorrente? sem resposta?). E o
-- negócio não tinha dono próprio: o filtro "dono" e a ação em massa
-- "atribuir dono" do pipeline precisam de uma coluna no próprio negócio.
--
--   lost_reasons           — catálogo de motivos por tenant (nome, ativo, ordem).
--                            Os 6 motivos padrão são semeados pela API na
--                            primeira leitura (nada de seed global aqui).
--   deals.motivo_perda_id  — FK nula para lost_reasons (ON DELETE SET NULL;
--                            a API só apaga motivo sem uso, o resto desativa).
--   deals.motivo_perda_obs — observação livre da perda (até 500 caracteres).
--   deals.owner_id         — identities.id do responsável (sem FK, igual a
--                            contacts.owner_id: identities é global; a API
--                            valida que é membro do tenant).
--
-- A FK não basta para multi-tenant (checagem de FK ignora RLS): o gatilho
-- `tenant_reference_motivo_perda` usa o mesmo verificador das outras
-- referências (khub_/orvyn_check_tenant_reference) para barrar motivo de
-- outro tenant gravado por SQL cru.
--
-- ADITIVA: tabela nova, colunas novas nulas, índices e gatilho. Nenhuma linha
-- existente muda de valor.
--
-- Rollback (manual):
--   BEGIN;
--   DROP TRIGGER IF EXISTS tenant_reference_motivo_perda ON deals;
--   DROP INDEX IF EXISTS idx_deals_owner;
--   DROP INDEX IF EXISTS idx_deals_status;
--   ALTER TABLE deals DROP COLUMN IF EXISTS owner_id;
--   ALTER TABLE deals DROP COLUMN IF EXISTS motivo_perda_obs;
--   ALTER TABLE deals DROP COLUMN IF EXISTS motivo_perda_id;
--   DROP TABLE IF EXISTS lost_reasons;
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS lost_reasons (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome       TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  ativo      BOOLEAN NOT NULL DEFAULT true,
  ordem      INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- nome único por tenant sem diferenciar maiúsculas ("Preço" = "preço")
CREATE UNIQUE INDEX IF NOT EXISTS uq_lost_reasons_nome ON lost_reasons (tenant_id, lower(nome));
CREATE INDEX IF NOT EXISTS idx_lost_reasons_lista ON lost_reasons (tenant_id, ordem);

ALTER TABLE lost_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE lost_reasons FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON lost_reasons;
CREATE POLICY tenant_rw ON lost_reasons FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON lost_reasons TO %I', r);
    END IF;
  END LOOP;
END $$;

ALTER TABLE deals ADD COLUMN IF NOT EXISTS motivo_perda_id UUID NULL REFERENCES lost_reasons(id) ON DELETE SET NULL;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS motivo_perda_obs TEXT NULL CHECK (motivo_perda_obs IS NULL OR length(motivo_perda_obs) <= 500);
ALTER TABLE deals ADD COLUMN IF NOT EXISTS owner_id UUID NULL;

-- filtros do pipeline: status (abertos/ganhos/perdidos) e dono
CREATE INDEX IF NOT EXISTS idx_deals_status ON deals (tenant_id, pipeline_id, status);
CREATE INDEX IF NOT EXISTS idx_deals_owner ON deals (tenant_id, owner_id);

-- Referência ao motivo precisa ser do MESMO tenant. O verificador foi
-- renomeado para khub_* na 035 só onde ela rodou; usa o que existir.
DO $$
DECLARE fn text;
BEGIN
  SELECT proname INTO fn FROM pg_proc
   WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'verificador de referência por tenant ausente (db/022)'; END IF;
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference_motivo_perda ON deals';
  EXECUTE format('CREATE TRIGGER tenant_reference_motivo_perda BEFORE INSERT OR UPDATE OF motivo_perda_id ON deals FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'motivo_perda_id', 'lost_reasons');
END $$;

COMMIT;

-- 077_agenda_avec_sync.sql — agenda do Avec dentro da agenda do KHUB (ADR-0052).
--
-- O salão continua operando no Avec: a equipe marca lá. A IA do salão só
-- enxergava a agenda do KHUB, que era uma cópia da exportação de 14-18/11, e
-- marcou 15 de 21 horários em cima de atendimento ou bloqueio do Avec (BUG-050).
-- Daqui em diante a agenda do Avec é sincronizada (a cada 10 min e ao vivo na
-- hora de reservar):
--   * agenda_compromissos.origem/externo_id: a linha veio do Avec e qual é a
--     chave dela (o id do Avec muda a cada leitura; a chave é data + profissional
--     + horário + serviço + cliente, ver avec-agenda.ts);
--   * agenda_jornadas: expediente REAL de cada profissional por dia (o Avec
--     manda a jornada do dia; NULL = folga). Sem linha, vale o expediente
--     deduzido do histórico (agenda-salao.ts).
-- Rollback: DROP TABLE agenda_jornadas; DROP INDEX uq_agenda_externo;
--   ALTER TABLE agenda_compromissos DROP COLUMN origem, DROP COLUMN externo_id,
--   DROP COLUMN sincronizado_em. (As linhas sincronizadas continuam como
--   compromissos comuns.)
BEGIN;

ALTER TABLE agenda_compromissos
  ADD COLUMN IF NOT EXISTS origem TEXT,
  ADD COLUMN IF NOT EXISTS externo_id TEXT,
  ADD COLUMN IF NOT EXISTS sincronizado_em TIMESTAMPTZ;
ALTER TABLE agenda_compromissos DROP CONSTRAINT IF EXISTS agenda_compromissos_origem_check;
ALTER TABLE agenda_compromissos ADD CONSTRAINT agenda_compromissos_origem_check
  CHECK ((origem IS NULL AND externo_id IS NULL)
      OR (origem IN ('avec') AND externo_id IS NOT NULL AND length(externo_id) BETWEEN 1 AND 200));
CREATE UNIQUE INDEX IF NOT EXISTS uq_agenda_externo
  ON agenda_compromissos (tenant_id, origem, externo_id) WHERE externo_id IS NOT NULL;

-- ---------------------- expediente por dia (Avec) ----------------------
CREATE TABLE IF NOT EXISTS agenda_jornadas (
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profissional_id UUID NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
  data            DATE NOT NULL,
  -- minutos desde 00:00 no fuso do salão; ambos NULL = folga nesse dia.
  ini_min         INTEGER CHECK (ini_min IS NULL OR ini_min BETWEEN 0 AND 1440),
  fim_min         INTEGER CHECK (fim_min IS NULL OR fim_min BETWEEN 0 AND 1440),
  origem          TEXT NOT NULL DEFAULT 'avec' CHECK (origem IN ('avec')),
  atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profissional_id, data),
  CONSTRAINT agenda_jornadas_faixa_chk CHECK ((ini_min IS NULL) = (fim_min IS NULL) AND (ini_min IS NULL OR ini_min < fim_min))
);
CREATE INDEX IF NOT EXISTS idx_agenda_jornadas_data ON agenda_jornadas (tenant_id, data);
ALTER TABLE agenda_jornadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_jornadas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_rw ON agenda_jornadas;
CREATE POLICY tenant_rw ON agenda_jornadas FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

DO $$
DECLARE fn TEXT;
BEGIN
  SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'função check_tenant_reference ausente (db/022)'; END IF;
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON agenda_jornadas';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON agenda_jornadas
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'profissional_id', 'profissionais');
END $$;

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON agenda_jornadas TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

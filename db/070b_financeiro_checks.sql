-- =====================================================================
-- 070b_financeiro_checks.sql — Regras de integridade do financeiro que
-- faltavam em bancos onde as tabelas nasceram de uma versão ANTERIOR da 070.
--
-- Contexto (2026-11-14): no Neon (produção) as tabelas do financeiro foram
-- criadas pela 070 antiga; a 070 atual usa CREATE TABLE IF NOT EXISTS e, ao
-- ser reaplicada, não recria os CHECKs inline. O teste de isolamento da 070
-- falhou lá ("lançamento de valor zero aceito"). Diff Neon × QA: 7 CHECKs
-- ausentes, colunas idênticas.
--
-- ADITIVA e idempotente: só adiciona o CHECK que não existe (pelo nome) e,
-- no caso de financeiro_transacoes.valor_centavos, troca `>= 0` por `> 0`.
-- Em banco que já está certo (QA, dev novo) é um no-op.
--
-- Rollback:
--   BEGIN;
--   ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS financeiro_transacoes_descricao_check;
--   ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS financeiro_transacoes_valor_centavos_check;
--   ALTER TABLE financeiro_transacoes ADD CONSTRAINT financeiro_transacoes_valor_centavos_check CHECK (valor_centavos >= 0);
--   ALTER TABLE financeiro_categorias DROP CONSTRAINT IF EXISTS financeiro_categorias_nome_check;
--   ALTER TABLE equipe_comissoes DROP CONSTRAINT IF EXISTS equipe_comissoes_cargo_check;
--   ALTER TABLE financeiro_comissoes DROP CONSTRAINT IF EXISTS fin_com_competencia_chk, DROP CONSTRAINT IF EXISTS fin_com_pago_chk,
--     DROP CONSTRAINT IF EXISTS fin_com_valor_chk, DROP CONSTRAINT IF EXISTS financeiro_comissoes_percent_check;
--   DELETE FROM schema_migrations WHERE filename IN ('db/070b_financeiro_checks.sql', '070b_financeiro_checks.sql');
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.garantir_check(tabela regclass, nome text, definicao text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = tabela AND conname = nome) THEN
    EXECUTE format('ALTER TABLE %s ADD CONSTRAINT %I %s', tabela, nome, definicao);
  END IF;
END $$;

-- Valor do lançamento: estritamente positivo (a versão antiga aceitava zero).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'financeiro_transacoes'::regclass
      AND conname = 'financeiro_transacoes_valor_centavos_check'
      AND pg_get_constraintdef(oid) <> 'CHECK ((valor_centavos > 0))'
  ) THEN
    ALTER TABLE financeiro_transacoes DROP CONSTRAINT financeiro_transacoes_valor_centavos_check;
  END IF;
END $$;
SELECT pg_temp.garantir_check('financeiro_transacoes', 'financeiro_transacoes_valor_centavos_check', 'CHECK (valor_centavos > 0)');
SELECT pg_temp.garantir_check('financeiro_transacoes', 'financeiro_transacoes_descricao_check', 'CHECK (length(btrim(descricao)) >= 1 AND length(btrim(descricao)) <= 200)');
SELECT pg_temp.garantir_check('financeiro_categorias', 'financeiro_categorias_nome_check', 'CHECK (length(btrim(nome)) >= 1 AND length(btrim(nome)) <= 60)');
SELECT pg_temp.garantir_check('equipe_comissoes', 'equipe_comissoes_cargo_check', 'CHECK (cargo IS NULL OR length(cargo) <= 80)');
SELECT pg_temp.garantir_check('financeiro_comissoes', 'fin_com_competencia_chk', 'CHECK (EXTRACT(day FROM competencia) = 1)');
SELECT pg_temp.garantir_check('financeiro_comissoes', 'fin_com_pago_chk', 'CHECK ((status = ''paga'') = (pago_em IS NOT NULL))');
SELECT pg_temp.garantir_check('financeiro_comissoes', 'fin_com_valor_chk', 'CHECK (valor_centavos <= base_centavos)');
SELECT pg_temp.garantir_check('financeiro_comissoes', 'financeiro_comissoes_percent_check', 'CHECK (percent > 0 AND percent <= 100)');

COMMIT;

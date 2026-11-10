-- =====================================================================
-- ORVYN OS · RLS nas PARTIÇÕES de ad_insights (BUG-014)
-- Migration 014. Aditiva e idempotente. Rodar com owner/superuser APÓS 013.
--
-- INCIDENTE: `ad_insights` é particionada por RANGE(date) e tem RLS. Mas no
-- Postgres a RLS da tabela-pai só é aplicada quando a leitura passa POR ELA:
-- `SELECT * FROM ad_insights_default` (a partição, direto) **ignora** a policy
-- e devolve linha de todos os tenants. Verificado: orvyn_app leu 14 linhas sem
-- nenhum contexto de tenant.
--
-- Hoje a app sempre consulta a tabela-pai, então nada vazou pela API — mas isso
-- faz a APLICAÇÃO virar a 1ª camada de isolamento, que é exatamente o que o
-- invariante 1 proíbe ("isolamento é do banco"). Um `$queryRaw` futuro citando a
-- partição, um dump, ou um SELECT de suporte já bastariam para vazar.
--
-- Correção: RLS + FORCE + policy em toda partição existente, e o mesmo para as
-- partições futuras (o bloco é reexecutável — rodar após criar partição nova).
-- =====================================================================

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT c.relname AS particao
    FROM pg_inherits i
    JOIN pg_class c   ON c.oid = i.inhrelid
    JOIN pg_class pai ON pai.oid = i.inhparent
    WHERE pai.relname = 'ad_insights'
      AND c.relkind IN ('r', 'p')   -- só tabelas: índices particionados ficam de fora
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p.particao);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', p.particao);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', p.particao);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, p.particao);
    RAISE NOTICE 'RLS aplicada na partição %', p.particao;
  END LOOP;
END$$;

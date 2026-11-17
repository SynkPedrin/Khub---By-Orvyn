-- 076_agents_instrucoes_20k.sql — instruções do agente até 20 mil caracteres (BUG-048).
--
-- A API passou a aceitar 20 mil caracteres (LIMITE_INSTRUCOES, commit 8db177c:
-- o prompt da IA do GHL que o KHUB substitui tinha ~15 mil), mas o banco
-- manteve o CHECK de 8 mil da db/030: acima disso a escrita estourava a
-- constraint e a API respondia 500. Aqui o banco acompanha a API.
-- Rollback: voltar o CHECK para 8000 (só se nenhum agente passar disso).
BEGIN;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_instrucoes_chk;
ALTER TABLE agents ADD CONSTRAINT agents_instrucoes_chk CHECK (length(instrucoes) <= 20000);
COMMIT;

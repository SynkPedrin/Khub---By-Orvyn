-- 079_agenda_grupos.sql — Agendamentos multi-serviço: `grupo_id` vincula os
-- compromissos individuais de um mesmo agendamento (ex.: escova com Ana 14h +
-- manicure com Bia 15h para a mesma cliente).
--
-- Decisão (aprovada pelo product owner em 2026-11-24): cada serviço continua um
-- compromisso individual (lembretes, financeiro por atendimento, comissões e a
-- sync Avec → KHUB seguem 1:1); `grupo_id` é o vínculo que a tela usa para
-- mostrar como um agendamento só e para operar o conjunto (cancelar/reagendar
-- tudo ou item a item). Linhas antigas ficam com grupo_id NULL (sem migração
-- de dados, compatibilidade total).
--
-- Rollback: DROP INDEX uq_agenda_grupo; ALTER TABLE agenda_compromissos DROP
-- COLUMN grupo_id;

ALTER TABLE agenda_compromissos ADD COLUMN IF NOT EXISTS grupo_id UUID;
-- ==SPLIT==
-- Mesmo grupo nunca duplica na criação transacional; índice parcial só onde há grupo.
CREATE INDEX IF NOT EXISTS idx_agenda_grupo ON agenda_compromissos (tenant_id, grupo_id) WHERE grupo_id IS NOT NULL;

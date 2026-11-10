-- 017_workflow_tags.sql — tags nos workflows (organização do workspace).
-- Aditiva, sem quebra: coluna array com default vazio. RLS já vem da 010.
ALTER TABLE workflows ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_workflows_tags ON workflows USING GIN (tags);

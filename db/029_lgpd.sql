-- 029_lgpd.sql — Base legal/consentimento por contato (PRD §14, RegrasNegocio
-- §5: "Base legal e consentimento registrados por contato"). Aditiva: não
-- retroage consentimento pra contato já existente (fica '{}', explicitamente
-- "não registrado" — nunca inventa um consentimento que não foi dado).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS consentimento jsonb NOT NULL DEFAULT '{}';
-- Shape esperado (não é CHECK — o front decide os valores válidos, como
-- campos_custom): {"baseLegal": "consentimento"|"execucao_contrato"|
-- "legitimo_interesse"|..., "consentidoEm": timestamp ISO, "origem": string}

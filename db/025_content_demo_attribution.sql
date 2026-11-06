-- =====================================================================
-- ORVYN Revenue OS — migration 025
-- =====================================================================
-- Content Operations Lab: metadados de tenant demonstrativo + atribuição
-- real Campaign → Creative → Lead.
--
-- ESTRITAMENTE ADITIVA. Toda coluna nova é nullable, sem DEFAULT que mude
-- comportamento existente. Nenhuma tabela/coluna anterior é alterada.
--
-- Contexto: `tenants.is_demo` já existe (migration 023) mas nunca entrou no
-- Prisma schema (drift real encontrado nesta auditoria — corrigido junto
-- com esta migration). `demo_scenario`/`dataset_version` são aditivos ao
-- mesmo mecanismo, não um sistema novo: permitem identificar QUAL roteiro
-- de demonstração populou o tenant (útil pro `seed:content:clean` e pra
-- nunca confundir um tenant demo com produção).
--
-- Atribuição: `contacts` não tinha nenhum caminho relacional até
-- `ad_campaigns`/`ad_creatives` — só `deals.origem` (texto livre). Sem uma
-- FK real, Analytics não consegue responder "que receita veio deste
-- criativo?" sem inventar a resposta. `ad_creative_id`/`ad_campaign_id` em
-- `contacts` fecham essa cadeia (Deal já se liga a Contact via
-- `contact_id`, então a atribuição de receita flui: creative → contact →
-- deal, sem duplicar a relação em duas tabelas).
-- =====================================================================

BEGIN;

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS demo_scenario text;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS dataset_version text;

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_campaign_id uuid REFERENCES ad_campaigns(id) ON DELETE SET NULL;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ad_creative_id uuid REFERENCES ad_creatives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contacts_ad_creative
  ON contacts(tenant_id, ad_creative_id)
  WHERE ad_creative_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS contacts_ad_campaign
  ON contacts(tenant_id, ad_campaign_id)
  WHERE ad_campaign_id IS NOT NULL;

COMMIT;

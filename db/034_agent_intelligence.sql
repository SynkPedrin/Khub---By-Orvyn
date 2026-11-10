-- =====================================================================
-- 034_agent_intelligence.sql — KHUB Agent Intelligence Platform
-- Documento: docs/AI_AGENT_ARCHITECTURE.md
--
-- ADITIVA: só cria tabelas, colunas, índices e funções novas. Nenhum dado
-- existente muda de significado:
--   - `agents.config` nasce '{}' e o servidor aplica os padrões (Zod) na
--     leitura — um agente antigo continua se comportando como antes;
--   - `agents.versao_publicada_id` nasce NULL = "sem versão publicada": o
--     runtime usa a configuração viva (comportamento de antes desta migração);
--   - colunas novas de `agent_runs` são nulas/padrão.
--
-- Rollback (manual, na ordem):
--   BEGIN;
--   DROP FUNCTION IF EXISTS agent_rag_search_hybrid(VECTOR, TEXT, TEXT, TEXT, TEXT[], UUID[], INT, INT, INT);
--   DROP FUNCTION IF EXISTS agent_rag_search_lexical(TEXT, TEXT, TEXT, TEXT[], UUID[], INT);
--   DROP FUNCTION IF EXISTS agent_tsquery_or(TEXT);
--   ALTER TABLE agents DROP COLUMN IF EXISTS versao_publicada_id, DROP COLUMN IF EXISTS config;
--   ALTER TABLE agent_runs DROP COLUMN IF EXISTS version_id, DROP COLUMN IF EXISTS intencao,
--     DROP COLUMN IF EXISTS sentimento, DROP COLUMN IF EXISTS urgencia, DROP COLUMN IF EXISTS confianca,
--     DROP COLUMN IF EXISTS trace, DROP COLUMN IF EXISTS blocos;
--   ALTER TABLE rag_documents DROP COLUMN IF EXISTS texto_fonte;
--   DROP TABLE IF EXISTS agent_simulations, agent_evaluations, agent_eval_scenarios,
--     agent_improvement_proposals, agent_learning_events, agent_tool_executions,
--     agent_followups, agent_followup_rules, agent_delivery_queue, agent_memories,
--     agent_extractions, agent_profile_facts, agent_customer_profiles,
--     agent_knowledge_sources, agent_versions, agent_intent_categories CASCADE;
--   COMMIT;
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Configuração estendida do agente (identidade, personalidade,
--    comportamento, regras, comunicação, inteligência, memória, CRM).
--    Um JSONB validado por Zod no servidor: a estrutura evolui com o
--    produto sem migração; o que é filtrado/indexado continua em coluna.
-- ---------------------------------------------------------------------
ALTER TABLE agents ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_config_obj_chk') THEN
    ALTER TABLE agents ADD CONSTRAINT agents_config_obj_chk CHECK (jsonb_typeof(config) = 'object');
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 2. Versionamento: snapshot imutável da configuração publicada.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_versions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id       UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  numero         INT  NOT NULL,
  snapshot       JSONB NOT NULL,
  notas          TEXT NULL,
  origem         TEXT NOT NULL DEFAULT 'publicacao',
  proposta_id    UUID NULL,
  avaliacao_id   UUID NULL,
  publicado_por  UUID NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_versions_numero_chk CHECK (numero >= 1),
  CONSTRAINT agent_versions_origem_chk CHECK (origem IN ('publicacao', 'restauracao', 'proposta')),
  CONSTRAINT agent_versions_notas_chk  CHECK (notas IS NULL OR length(notas) <= 2000)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_versions_numero ON agent_versions (agent_id, numero);
CREATE INDEX IF NOT EXISTS idx_agent_versions_tenant ON agent_versions (tenant_id, agent_id, created_at DESC);

ALTER TABLE agents ADD COLUMN IF NOT EXISTS versao_publicada_id UUID NULL REFERENCES agent_versions(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 3. Categorias de intenção personalizadas por Subaccount (tenant).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_intent_categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chave       TEXT NOT NULL,
  nome        TEXT NOT NULL,
  descricao   TEXT NOT NULL DEFAULT '',
  exemplos    TEXT[] NOT NULL DEFAULT '{}',
  ativo       BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_intent_chave_chk CHECK (chave ~ '^[a-z][a-z0-9_]{1,39}$'),
  CONSTRAINT agent_intent_nome_chk  CHECK (length(nome) BETWEEN 1 AND 60),
  CONSTRAINT agent_intent_desc_chk  CHECK (length(descricao) <= 400)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_intent_categories_chave ON agent_intent_categories (tenant_id, chave);

-- ---------------------------------------------------------------------
-- 4. Knowledge Engine: fontes de conhecimento POR AGENTE. O documento e os
--    chunks continuam no RAG (rag_documents/rag_chunks, RLS do 001/033);
--    aqui fica o vínculo agente↔documento, a categoria e a ativação.
--    `texto_fonte` guarda o texto extraído (reprocessar/visualizar sem
--    pedir o arquivo de novo).
-- ---------------------------------------------------------------------
ALTER TABLE rag_documents ADD COLUMN IF NOT EXISTS texto_fonte TEXT NULL;

CREATE TABLE IF NOT EXISTS agent_knowledge_sources (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id     UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  document_id  UUID NOT NULL REFERENCES rag_documents(id) ON DELETE CASCADE,
  categoria    TEXT NOT NULL DEFAULT 'geral',
  ativo        BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_knowledge_categoria_chk CHECK (length(categoria) BETWEEN 1 AND 60)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_knowledge_sources_doc ON agent_knowledge_sources (agent_id, document_id);
CREATE INDEX IF NOT EXISTS idx_agent_knowledge_tenant ON agent_knowledge_sources (tenant_id, agent_id, ativo);

-- ---------------------------------------------------------------------
-- 5. Customer Intelligence Profile (um por contato, compartilhado pelos
--    agentes do tenant) + fatos com origem/confiança/confirmação.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_customer_profiles (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id             UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  resumo                 TEXT NOT NULL DEFAULT '',
  temperatura            TEXT NULL,
  intencao               TEXT NULL,
  sentimento             TEXT NULL,
  urgencia               TEXT NULL,
  etapa                  TEXT NULL,
  proxima_acao           TEXT NULL,
  proxima_acao_em        TIMESTAMPTZ NULL,
  motivo_nao_conversao   TEXT NULL,
  convertido_em          TIMESTAMPTZ NULL,
  ultima_interacao_at    TIMESTAMPTZ NULL,
  ultimo_agent_id        UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_profiles_temp_chk CHECK (temperatura IS NULL OR temperatura IN ('fria', 'morna', 'quente')),
  CONSTRAINT agent_profiles_urg_chk  CHECK (urgencia IS NULL OR urgencia IN ('baixa', 'media', 'alta')),
  CONSTRAINT agent_profiles_resumo_chk CHECK (length(resumo) <= 4000)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_customer_profiles_contato ON agent_customer_profiles (tenant_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_agent_profiles_temp ON agent_customer_profiles (tenant_id, temperatura, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_profile_facts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  campo            TEXT NOT NULL,
  valor            JSONB NOT NULL,
  origem           TEXT NOT NULL,
  confianca        NUMERIC(4, 3) NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pendente',
  agent_id         UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id  UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
  message_id       UUID NULL REFERENCES messages(id) ON DELETE SET NULL,
  identificado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  atualizado_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_facts_campo_chk  CHECK (campo ~ '^[a-z][a-z0-9_]{1,59}$'),
  CONSTRAINT agent_facts_origem_chk CHECK (origem IN ('declarado', 'inferido', 'humano', 'crm')),
  CONSTRAINT agent_facts_status_chk CHECK (status IN ('confirmado', 'pendente', 'rejeitado')),
  CONSTRAINT agent_facts_conf_chk   CHECK (confianca BETWEEN 0 AND 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_profile_facts_campo ON agent_profile_facts (tenant_id, contact_id, campo);

-- Histórico de TODA extração (aplicada ou não) — auditoria e aprendizado.
CREATE TABLE IF NOT EXISTS agent_extractions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  agent_id         UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  run_id           UUID NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
  message_id       UUID NULL REFERENCES messages(id) ON DELETE SET NULL,
  campo            TEXT NOT NULL,
  valor            JSONB NOT NULL,
  origem           TEXT NOT NULL,
  confianca        NUMERIC(4, 3) NOT NULL DEFAULT 0,
  decisao          TEXT NOT NULL,
  motivo           TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_extr_origem_chk  CHECK (origem IN ('declarado', 'inferido', 'humano', 'crm')),
  CONSTRAINT agent_extr_decisao_chk CHECK (decisao IN ('aplicado', 'pendente_revisao', 'ignorado_confirmado', 'ignorado_confianca', 'ignorado_politica', 'sincronizado_crm'))
);
CREATE INDEX IF NOT EXISTS idx_agent_extractions_contato ON agent_extractions (tenant_id, contact_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 6. Memory Engine — três camadas.
--    curto       : resumo progressivo da conversa atual
--    longo       : fatos/eventos relevantes entre conversas
--    operacional : estado comercial, tarefas, compromissos, próximos passos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_memories (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id          UUID NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id     UUID NULL REFERENCES conversations(id) ON DELETE CASCADE,
  agent_id            UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  camada              TEXT NOT NULL,
  tipo                TEXT NOT NULL,
  conteudo            TEXT NOT NULL,
  importancia         SMALLINT NOT NULL DEFAULT 3,
  origem              TEXT NOT NULL DEFAULT 'agente',
  ate_message_id      UUID NULL,
  mensagens_cobertas  INT NOT NULL DEFAULT 0,
  expira_em           TIMESTAMPTZ NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_mem_camada_chk CHECK (camada IN ('curto', 'longo', 'operacional')),
  CONSTRAINT agent_mem_tipo_chk   CHECK (tipo IN ('resumo_conversa', 'fato', 'preferencia', 'evento', 'objetivo', 'tarefa', 'compromisso', 'proximo_passo')),
  CONSTRAINT agent_mem_imp_chk    CHECK (importancia BETWEEN 1 AND 5),
  CONSTRAINT agent_mem_origem_chk CHECK (origem IN ('agente', 'humano', 'sistema')),
  CONSTRAINT agent_mem_cont_chk   CHECK (length(conteudo) BETWEEN 1 AND 6000)
);
CREATE INDEX IF NOT EXISTS idx_agent_memories_contato ON agent_memories (tenant_id, contact_id, camada, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_memories_expira ON agent_memories (expira_em) WHERE expira_em IS NOT NULL;
-- Um resumo progressivo por conversa (atualizado no lugar).
CREATE UNIQUE INDEX IF NOT EXISTS agent_memories_resumo_conv ON agent_memories (tenant_id, conversation_id) WHERE tipo = 'resumo_conversa';

-- ---------------------------------------------------------------------
-- 7. Message Delivery Queue — blocos fragmentados com ordem, atraso,
--    idempotência, cancelamento e estado persistido. A fila do BullMQ só
--    carrega o id do bloco; a verdade é esta tabela.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_delivery_queue (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  run_id           UUID NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
  followup_id      UUID NULL,
  sequencia_id     UUID NOT NULL,
  ordem            SMALLINT NOT NULL,
  total            SMALLINT NOT NULL,
  texto            TEXT NOT NULL,
  atraso_ms        INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'pendente',
  tentativas       SMALLINT NOT NULL DEFAULT 0,
  agendado_para    TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviado_em       TIMESTAMPTZ NULL,
  message_id       UUID NULL REFERENCES messages(id) ON DELETE SET NULL,
  idempotency_key  TEXT NOT NULL,
  motivo           TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_delivery_status_chk CHECK (status IN ('pendente', 'enviando', 'enviado', 'cancelado', 'falhou', 'incerto')),
  CONSTRAINT agent_delivery_ordem_chk  CHECK (ordem >= 1 AND ordem <= total AND total <= 20),
  CONSTRAINT agent_delivery_texto_chk  CHECK (length(texto) BETWEEN 1 AND 4096),
  CONSTRAINT agent_delivery_atraso_chk CHECK (atraso_ms BETWEEN 0 AND 120000)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_delivery_idempotencia ON agent_delivery_queue (tenant_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS agent_delivery_seq_ordem ON agent_delivery_queue (sequencia_id, ordem);
CREATE INDEX IF NOT EXISTS idx_agent_delivery_conv ON agent_delivery_queue (tenant_id, conversation_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_delivery_pend ON agent_delivery_queue (status, agendado_para) WHERE status IN ('pendente', 'enviando');

-- ---------------------------------------------------------------------
-- 8. Follow-up Intelligence — regras (estratégias) e execuções.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_followup_rules (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id            UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  nome                TEXT NOT NULL,
  estrategia          TEXT NOT NULL,
  ativo               BOOLEAN NOT NULL DEFAULT false,
  max_tentativas      SMALLINT NOT NULL DEFAULT 3,
  intervalos_horas    INT[] NOT NULL DEFAULT '{24,72,168}',
  horario_inicio      SMALLINT NOT NULL DEFAULT 9,
  horario_fim         SMALLINT NOT NULL DEFAULT 19,
  dias_semana         SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  fuso                TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  objetivo            TEXT NOT NULL DEFAULT '',
  tom                 TEXT NOT NULL DEFAULT '',
  instrucoes          TEXT NOT NULL DEFAULT '',
  parar_se            TEXT[] NOT NULL DEFAULT '{respondeu,converteu,optout,humano_assumiu}',
  max_mensagens_dia   SMALLINT NOT NULL DEFAULT 1,
  prioridade          SMALLINT NOT NULL DEFAULT 5,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_fur_estrategia_chk CHECK (estrategia IN ('sem_resposta', 'pos_orcamento', 'objecao_preco', 'pos_interesse', 'agendamento_pendente', 'reativacao', 'oportunidade_perdida', 'pos_atendimento')),
  CONSTRAINT agent_fur_tent_chk       CHECK (max_tentativas BETWEEN 1 AND 10),
  CONSTRAINT agent_fur_horas_chk      CHECK (horario_inicio BETWEEN 0 AND 23 AND horario_fim BETWEEN 1 AND 24 AND horario_fim > horario_inicio),
  CONSTRAINT agent_fur_dia_chk        CHECK (max_mensagens_dia BETWEEN 1 AND 5),
  CONSTRAINT agent_fur_textos_chk     CHECK (length(nome) BETWEEN 1 AND 80 AND length(objetivo) <= 500 AND length(tom) <= 200 AND length(instrucoes) <= 2000)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_followup_rules_estrategia ON agent_followup_rules (agent_id, estrategia);

CREATE TABLE IF NOT EXISTS agent_followups (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  rule_id          UUID NOT NULL REFERENCES agent_followup_rules(id) ON DELETE CASCADE,
  contact_id       UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  ciclo_id         UUID NOT NULL,
  estrategia       TEXT NOT NULL,
  tentativa        SMALLINT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'agendado',
  agendado_para    TIMESTAMPTZ NOT NULL,
  executado_em     TIMESTAMPTZ NULL,
  motivo           TEXT NULL,
  contexto         JSONB NOT NULL DEFAULT '{}'::jsonb,
  mensagem         TEXT NULL,
  sequencia_id     UUID NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_fu_status_chk CHECK (status IN ('agendado', 'gerando', 'enviado', 'cancelado', 'pulado', 'falhou')),
  CONSTRAINT agent_fu_tent_chk   CHECK (tentativa BETWEEN 1 AND 10)
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_followups_ciclo_tentativa ON agent_followups (tenant_id, ciclo_id, tentativa);
-- Anti-duplicidade: no máximo UM follow-up agendado por contato e agente.
CREATE UNIQUE INDEX IF NOT EXISTS agent_followups_um_agendado ON agent_followups (tenant_id, contact_id, agent_id) WHERE status IN ('agendado', 'gerando');
CREATE INDEX IF NOT EXISTS idx_agent_followups_vencidos ON agent_followups (status, agendado_para) WHERE status = 'agendado';
CREATE INDEX IF NOT EXISTS idx_agent_followups_contato ON agent_followups (tenant_id, contact_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 9. Action Engine — log de toda execução de ferramenta (inclusive negadas,
--    simuladas e aguardando aprovação humana).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_tool_executions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         UUID NULL REFERENCES agents(id) ON DELETE SET NULL,
  run_id           UUID NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
  conversation_id  UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
  contact_id       UUID NULL REFERENCES contacts(id) ON DELETE SET NULL,
  ferramenta       TEXT NOT NULL,
  args             JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultado        JSONB NULL,
  status           TEXT NOT NULL,
  erro             TEXT NULL,
  origem           TEXT NOT NULL DEFAULT 'modelo',
  latencia_ms      INT NULL,
  aprovado_por     UUID NULL,
  decidido_em      TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_tool_status_chk CHECK (status IN ('executado', 'erro', 'negado', 'simulado', 'aguardando_aprovacao', 'aprovado', 'rejeitado')),
  CONSTRAINT agent_tool_origem_chk CHECK (origem IN ('modelo', 'regra', 'aprovacao', 'simulador'))
);
CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON agent_tool_executions (tenant_id, agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_tools_aprovacao ON agent_tool_executions (tenant_id, status) WHERE status = 'aguardando_aprovacao';

-- ---------------------------------------------------------------------
-- 10. Learning & Evaluation Engine.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_learning_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id         UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL,
  chave            TEXT NOT NULL,
  conversation_id  UUID NULL REFERENCES conversations(id) ON DELETE SET NULL,
  run_id           UUID NULL REFERENCES agent_runs(id) ON DELETE SET NULL,
  detalhe          JSONB NOT NULL DEFAULT '{}'::jsonb,
  peso             SMALLINT NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_learn_tipo_chk CHECK (tipo IN ('transferencia', 'lacuna_conhecimento', 'baixa_confianca', 'objecao', 'guardrail', 'erro_ferramenta', 'correcao_humana', 'feedback', 'conversao', 'perda', 'sem_resposta')),
  CONSTRAINT agent_learn_peso_chk CHECK (peso BETWEEN -5 AND 5),
  CONSTRAINT agent_learn_chave_chk CHECK (length(chave) BETWEEN 1 AND 200)
);
CREATE INDEX IF NOT EXISTS idx_agent_learning ON agent_learning_events (tenant_id, agent_id, tipo, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_improvement_proposals (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id           UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  tipo               TEXT NOT NULL,
  chave              TEXT NOT NULL,
  titulo             TEXT NOT NULL,
  descricao          TEXT NOT NULL,
  evidencias         JSONB NOT NULL DEFAULT '[]'::jsonb,
  patch              JSONB NULL,
  conteudo_sugerido  TEXT NULL,
  ocorrencias        INT NOT NULL DEFAULT 1,
  status             TEXT NOT NULL DEFAULT 'aberta',
  avaliacao_id       UUID NULL,
  decidido_por       UUID NULL,
  decidido_em        TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_prop_tipo_chk   CHECK (tipo IN ('prompt', 'comportamento', 'conhecimento', 'ferramenta')),
  CONSTRAINT agent_prop_status_chk CHECK (status IN ('aberta', 'em_avaliacao', 'aprovada', 'rejeitada', 'aplicada'))
);
-- Uma proposta aberta por padrão identificado (re-detecção soma ocorrências).
CREATE UNIQUE INDEX IF NOT EXISTS agent_proposals_chave_aberta ON agent_improvement_proposals (tenant_id, agent_id, chave) WHERE status IN ('aberta', 'em_avaliacao');
CREATE INDEX IF NOT EXISTS idx_agent_proposals ON agent_improvement_proposals (tenant_id, agent_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_eval_scenarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL,
  mensagens     JSONB NOT NULL,
  expectativas  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ativo         BOOLEAN NOT NULL DEFAULT true,
  origem        TEXT NOT NULL DEFAULT 'manual',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT agent_scen_origem_chk CHECK (origem IN ('manual', 'conversa', 'aprendizado', 'padrao')),
  CONSTRAINT agent_scen_nome_chk   CHECK (length(nome) BETWEEN 1 AND 120)
);
CREATE INDEX IF NOT EXISTS idx_agent_scenarios ON agent_eval_scenarios (tenant_id, agent_id, ativo);

CREATE TABLE IF NOT EXISTS agent_evaluations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id      UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version_id    UUID NULL REFERENCES agent_versions(id) ON DELETE SET NULL,
  proposta_id   UUID NULL REFERENCES agent_improvement_proposals(id) ON DELETE SET NULL,
  alvo          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'executando',
  nota          NUMERIC(5, 2) NULL,
  metricas      JSONB NOT NULL DEFAULT '{}'::jsonb,
  resultados    JSONB NOT NULL DEFAULT '[]'::jsonb,
  comparacao    JSONB NULL,
  regressao     BOOLEAN NOT NULL DEFAULT false,
  custo_usd     NUMERIC(12, 6) NOT NULL DEFAULT 0,
  erro          TEXT NULL,
  created_by    UUID NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ NULL,
  CONSTRAINT agent_eval_alvo_chk   CHECK (alvo IN ('rascunho', 'versao', 'proposta')),
  CONSTRAINT agent_eval_status_chk CHECK (status IN ('executando', 'concluida', 'falhou'))
);
CREATE INDEX IF NOT EXISTS idx_agent_evaluations ON agent_evaluations (tenant_id, agent_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 11. Simulador — sessões persistidas (para revisar e virar cenário de teste).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_simulations (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  perfil      TEXT NOT NULL DEFAULT 'livre',
  mensagens   JSONB NOT NULL DEFAULT '[]'::jsonb,
  traces      JSONB NOT NULL DEFAULT '[]'::jsonb,
  custo_usd   NUMERIC(12, 6) NOT NULL DEFAULT 0,
  created_by  UUID NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_simulations ON agent_simulations (tenant_id, agent_id, updated_at DESC);

-- ---------------------------------------------------------------------
-- 12. agent_runs: decisão estruturada do Intelligence Core (sem raciocínio
--     privado do modelo — só decisões, fontes, ferramentas e resultados).
-- ---------------------------------------------------------------------
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS version_id  UUID NULL REFERENCES agent_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intencao    TEXT NULL,
  ADD COLUMN IF NOT EXISTS sentimento  TEXT NULL,
  ADD COLUMN IF NOT EXISTS urgencia    TEXT NULL,
  ADD COLUMN IF NOT EXISTS confianca   NUMERIC(4, 3) NULL,
  ADD COLUMN IF NOT EXISTS trace       JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS blocos      SMALLINT NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_agent_runs_intencao ON agent_runs (tenant_id, agent_id, intencao, created_at);

-- ---------------------------------------------------------------------
-- 13. Busca do agente: mesma fusão RRF do 001/007, com filtro opcional por
--     documentos (fontes ativas do agente) DENTRO do WHERE — invariante RAG 5.
--     p_document_ids NULL = todos os documentos do tenant.
-- ---------------------------------------------------------------------
-- Pergunta em linguagem natural ("quanto custa a avaliação?") quase nunca
-- tem TODOS os termos no documento: a perna lexical do agente usa OR entre os
-- termos (o ts_rank_cd continua premiando quem cobre mais termos). O RAG
-- original (rag_search_*) não muda.
CREATE OR REPLACE FUNCTION agent_tsquery_or(p_text TEXT) RETURNS tsquery
LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN q::text = '' THEN q ELSE to_tsquery('pt_unaccent', replace(q::text, ' & ', ' | ')) END
  FROM websearch_to_tsquery('pt_unaccent', p_text) AS q
$$;
GRANT EXECUTE ON FUNCTION agent_tsquery_or(TEXT) TO orvyn_app, orvyn_service;

CREATE OR REPLACE FUNCTION agent_rag_search_hybrid(
  p_query_embedding VECTOR(1024),
  p_query_text      TEXT,
  p_nicho           TEXT,
  p_sub             TEXT,
  p_escopos         TEXT[],
  p_document_ids    UUID[],
  p_k_each          INT DEFAULT 50,
  p_limit           INT DEFAULT 30,
  p_rrf_k           INT DEFAULT 60
)
RETURNS TABLE (chunk_id UUID, document_id UUID, escopo rag_escopo, titulo TEXT, breadcrumb TEXT, conteudo TEXT, score REAL)
LANGUAGE sql STABLE AS $$
WITH filtro AS (
  SELECT c.id, c.document_id, c.escopo, c.breadcrumb, c.conteudo, c.embedding, c.tsv
  FROM rag_chunks c
  WHERE c.status = 'published'
    AND c.escopo::text = ANY(p_escopos)
    AND (
      c.escopo = 'global'
      OR (c.escopo = 'nicho'  AND c.nicho = p_nicho)
      OR (c.escopo = 'sub'    AND c.nicho = p_nicho AND c.subespecialidade = p_sub)
      OR (c.escopo = 'tenant' AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          AND (p_document_ids IS NULL OR c.document_id = ANY(p_document_ids)))
    )
),
vetorial AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> p_query_embedding) AS rank
  FROM filtro WHERE embedding IS NOT NULL
  ORDER BY embedding <=> p_query_embedding LIMIT p_k_each
),
lexico AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(tsv, agent_tsquery_or(p_query_text)) DESC) AS rank
  FROM filtro WHERE tsv @@ agent_tsquery_or(p_query_text)
  ORDER BY ts_rank_cd(tsv, agent_tsquery_or(p_query_text)) DESC LIMIT p_k_each
),
fundido AS (
  SELECT COALESCE(v.id, l.id) AS id,
         (COALESCE(1.0 / (p_rrf_k + v.rank), 0) + COALESCE(1.0 / (p_rrf_k + l.rank), 0)) AS rrf
  FROM vetorial v FULL OUTER JOIN lexico l ON l.id = v.id
)
SELECT f.id, fl.document_id, fl.escopo, d.titulo, fl.breadcrumb, fl.conteudo,
       (f.rrf * CASE fl.escopo WHEN 'tenant' THEN 1.35 WHEN 'sub' THEN 1.20 WHEN 'nicho' THEN 1.10 ELSE 1.00 END)::real AS score
FROM fundido f
JOIN filtro fl ON fl.id = f.id
JOIN rag_documents d ON d.id = fl.document_id
ORDER BY score DESC
LIMIT p_limit;
$$;

CREATE OR REPLACE FUNCTION agent_rag_search_lexical(
  p_query_text   TEXT,
  p_nicho        TEXT,
  p_sub          TEXT,
  p_escopos      TEXT[],
  p_document_ids UUID[],
  p_limit        INT DEFAULT 30
)
RETURNS TABLE (chunk_id UUID, document_id UUID, escopo rag_escopo, titulo TEXT, breadcrumb TEXT, conteudo TEXT, score REAL)
LANGUAGE sql STABLE AS $$
WITH filtro AS (
  SELECT c.id, c.document_id, c.escopo, c.breadcrumb, c.conteudo, c.tsv
  FROM rag_chunks c
  WHERE c.status = 'published'
    AND c.escopo::text = ANY(p_escopos)
    AND (
      c.escopo = 'global'
      OR (c.escopo = 'nicho'  AND c.nicho = p_nicho)
      OR (c.escopo = 'sub'    AND c.nicho = p_nicho AND c.subespecialidade = p_sub)
      OR (c.escopo = 'tenant' AND c.tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid
          AND (p_document_ids IS NULL OR c.document_id = ANY(p_document_ids)))
    )
),
lexico AS (
  SELECT f.id, ts_rank_cd(f.tsv, agent_tsquery_or(p_query_text)) AS rank
  FROM filtro f
  WHERE f.tsv @@ agent_tsquery_or(p_query_text)
  ORDER BY rank DESC LIMIT p_limit
)
SELECT l.id, fl.document_id, fl.escopo, d.titulo, fl.breadcrumb, fl.conteudo,
       (l.rank * CASE fl.escopo WHEN 'tenant' THEN 1.35 WHEN 'sub' THEN 1.20 WHEN 'nicho' THEN 1.10 ELSE 1.00 END)::real AS score
FROM lexico l
JOIN filtro fl ON fl.id = l.id
JOIN rag_documents d ON d.id = fl.document_id
ORDER BY score DESC
LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION agent_rag_search_hybrid(VECTOR, TEXT, TEXT, TEXT, TEXT[], UUID[], INT, INT, INT) TO orvyn_app, orvyn_service;
GRANT EXECUTE ON FUNCTION agent_rag_search_lexical(TEXT, TEXT, TEXT, TEXT[], UUID[], INT) TO orvyn_app, orvyn_service;

-- ---------------------------------------------------------------------
-- 14. RLS — mesmo padrão do 013/030 em TODA tabela nova.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'agent_versions', 'agent_intent_categories', 'agent_knowledge_sources',
    'agent_customer_profiles', 'agent_profile_facts', 'agent_extractions',
    'agent_memories', 'agent_delivery_queue', 'agent_followup_rules',
    'agent_followups', 'agent_tool_executions', 'agent_learning_events',
    'agent_improvement_proposals', 'agent_eval_scenarios', 'agent_evaluations',
    'agent_simulations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE  ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($f$
      CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO orvyn_app, orvyn_service', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 15. Referência cross-tenant recusada no BANCO (db/022), não só na API.
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT; args TEXT;
BEGIN
  FOR t, args IN SELECT * FROM (VALUES
    ('agent_versions',              '''agent_id'',''agents'''),
    ('agent_knowledge_sources',     '''agent_id'',''agents'',''document_id'',''rag_documents'''),
    ('agent_customer_profiles',     '''contact_id'',''contacts'',''ultimo_agent_id'',''agents'''),
    ('agent_profile_facts',         '''contact_id'',''contacts'',''agent_id'',''agents'',''conversation_id'',''conversations'',''message_id'',''messages'''),
    ('agent_extractions',           '''contact_id'',''contacts'',''agent_id'',''agents'',''run_id'',''agent_runs'',''message_id'',''messages'''),
    ('agent_memories',              '''contact_id'',''contacts'',''conversation_id'',''conversations'',''agent_id'',''agents'''),
    ('agent_delivery_queue',        '''agent_id'',''agents'',''conversation_id'',''conversations'',''run_id'',''agent_runs'',''message_id'',''messages'''),
    ('agent_followup_rules',        '''agent_id'',''agents'''),
    ('agent_followups',             '''agent_id'',''agents'',''rule_id'',''agent_followup_rules'',''contact_id'',''contacts'',''conversation_id'',''conversations'''),
    ('agent_tool_executions',       '''agent_id'',''agents'',''run_id'',''agent_runs'',''conversation_id'',''conversations'',''contact_id'',''contacts'''),
    ('agent_learning_events',       '''agent_id'',''agents'',''conversation_id'',''conversations'',''run_id'',''agent_runs'''),
    ('agent_improvement_proposals', '''agent_id'',''agents'''),
    ('agent_eval_scenarios',        '''agent_id'',''agents'''),
    ('agent_evaluations',           '''agent_id'',''agents'',''version_id'',''agent_versions'',''proposta_id'',''agent_improvement_proposals'''),
    ('agent_simulations',           '''agent_id'',''agents''')
  ) AS refs(t, args) LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS tenant_reference ON %I', t);
    EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference(%s)', t, args);
  END LOOP;
END $$;

-- agent_runs ganhou version_id; agents ganhou versao_publicada_id.
DROP TRIGGER IF EXISTS tenant_reference ON agent_runs;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON agent_runs
  FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference('agent_id', 'agents', 'conversation_id', 'conversations', 'message_id', 'messages', 'version_id', 'agent_versions');

DROP TRIGGER IF EXISTS tenant_reference ON agents;
CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION orvyn_check_tenant_reference('versao_publicada_id', 'agent_versions');

COMMIT;

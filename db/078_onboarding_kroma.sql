-- =====================================================================
-- 078_onboarding_kroma.sql — Onboarding de clientes da agência KROMA
--
-- Contexto: a KROMA (agência no modo agency, db/026) precisa conduzir o
-- onboarding de cada subconta com processo rastreável: coleta de
-- conhecimento, reunião de imersão, análise via Genna (ADR-0053),
-- implantação com tarefas reais no Daily (db/074), especificação do agente
-- de IA do cliente e homologação com verificações + aprovação humana final.
--
-- Escopo: estes dados são da AGÊNCIA, não de uma subconta — mesmo modelo de
-- db/026 e db/074: sem tenant_id e sem RLS. O isolamento é feito no
-- OnboardingService, que resolve a agência pela identidade da sessão (nunca
-- por id vindo do cliente) e filtra por agency_id + subcontas visíveis do
-- membro (AgencyService.escopo). Nenhum dado operacional de subconta é lido
-- ou gravado aqui; `agency_onboarding_agents.agent_id` só REFERENCIA (sem
-- FK, o agente vive no tenant do cliente) um agente que será criado depois.
--
-- Resultados vindos do Genna (`agency_onboarding_reports.bruto`) são dado
-- NÃO confiável: armazenados para consulta humana, nunca executados.
--
-- Aditiva: só cria tabelas novas.
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS agency_onboarding_events, agency_onboarding_approvals,
--     agency_onboarding_verifications, agency_onboarding_tasks,
--     agency_onboarding_agents, agency_onboarding_reports,
--     agency_onboarding_meetings, agency_onboarding_knowledge_hist,
--     agency_onboarding_knowledge, agency_onboardings;
--   COMMIT;
-- =====================================================================

BEGIN;

-- Onboarding em andamento/concluído de uma subconta. Um não-finalizado por
-- subconta (índice único parcial abaixo); `completion_locked` começa true e
-- só o backend destrava no finalizar, após revalidar as verificações.
CREATE TABLE IF NOT EXISTS agency_onboardings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id         uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  client_account_id uuid NOT NULL REFERENCES agency_client_accounts(id) ON DELETE CASCADE,
  responsavel_id    uuid REFERENCES agency_members(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'coleta' CHECK (status IN (
                    'coleta', 'imersao', 'implantacao', 'homologacao', 'pronto', 'bloqueado')),
  etapa_atual       text,
  -- Serviços contratados: {"trafego":true,"social":true,"audiovisual":false,"agente_ia":true,"branding":false}.
  escopo            jsonb NOT NULL DEFAULT '{}',
  completion_locked boolean NOT NULL DEFAULT true,
  aprovado_por      uuid REFERENCES agency_members(id) ON DELETE SET NULL,
  aprovado_em       timestamptz,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS agency_onboardings_aberto_por_cliente
  ON agency_onboardings (client_account_id) WHERE status <> 'pronto';
CREATE INDEX IF NOT EXISTS agency_onboardings_agencia_status ON agency_onboardings (agency_id, status);
CREATE INDEX IF NOT EXISTS agency_onboardings_cliente ON agency_onboardings (client_account_id);

-- Conhecimento coletado do cliente, uma linha por seção (upsert lógico).
CREATE TABLE IF NOT EXISTS agency_onboarding_knowledge (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id  uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  secao          text NOT NULL CHECK (secao IN (
                 'institucional', 'operacao', 'produtos', 'comercial', 'marketing', 'identidade', 'preferencias')),
  dados          jsonb NOT NULL DEFAULT '{}',
  pendente       boolean NOT NULL DEFAULT true,
  confirmado_por uuid,
  confirmado_em  timestamptz,
  atualizado_por uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onboarding_id, secao)
);
CREATE INDEX IF NOT EXISTS agency_onboarding_knowledge_onb ON agency_onboarding_knowledge (onboarding_id);

-- Snapshot do conteúdo ANTERIOR a cada update de knowledge (auditoria de edição).
CREATE TABLE IF NOT EXISTS agency_onboarding_knowledge_hist (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  knowledge_id uuid NOT NULL REFERENCES agency_onboarding_knowledge(id) ON DELETE CASCADE,
  dados        jsonb NOT NULL,
  alterado_por uuid,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_onboarding_knowledge_hist_knw ON agency_onboarding_knowledge_hist (knowledge_id, created_at);

-- Reuniões do onboarding (imersão e afins): pauta, decisões e pendências.
CREATE TABLE IF NOT EXISTS agency_onboarding_meetings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id  uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  tipo           text NOT NULL DEFAULT 'imersao',
  data           timestamptz,
  participantes  jsonb NOT NULL DEFAULT '[]',
  pauta          jsonb NOT NULL DEFAULT '[]',
  resumo         text,
  decisoes       jsonb NOT NULL DEFAULT '[]',
  pendencias     jsonb NOT NULL DEFAULT '[]',
  criado_por     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_onboarding_meetings_onb ON agency_onboarding_meetings (onboarding_id, created_at);

-- Relatórios de análise (Genna, manual ou web). `bruto` = resultado cru da
-- tool: dado não confiável, só para leitura humana.
CREATE TABLE IF NOT EXISTS agency_onboarding_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id    uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  fonte            text NOT NULL DEFAULT 'genna' CHECK (fonte IN ('genna', 'manual', 'web')),
  perfil_analisado text,
  ferramenta       text,
  metricas         jsonb NOT NULL DEFAULT '{}',
  achados          jsonb NOT NULL DEFAULT '[]',
  recomendacoes    jsonb NOT NULL DEFAULT '[]',
  limitacoes       text,
  bruto            jsonb,
  criado_por       uuid,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_onboarding_reports_onb ON agency_onboarding_reports (onboarding_id, created_at);

-- Especificação do agente de IA do cliente (um por onboarding). O agente só é
-- criado no tenant do cliente numa etapa futura; `agent_id` aponta para ele
-- quando existir (sem FK: tabela `agents` é de outro tenant).
CREATE TABLE IF NOT EXISTS agency_onboarding_agents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   uuid NOT NULL UNIQUE REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  agent_id        uuid,
  nome            text,
  -- identidade, função, personalidade, contexto, base de conhecimento, catálogo,
  -- preços, público, tom de voz, regras de atendimento, qualificação, objeções,
  -- follow-ups, encaminhamento humano, restrições, limites, segurança.
  especificacao   jsonb NOT NULL DEFAULT '{}',
  system_prompt   text,
  -- Cenários de teste: [{cenario, status: pendente|aprovado|reprovado, observacao}].
  testes          jsonb NOT NULL DEFAULT '[]',
  approval_status text NOT NULL DEFAULT 'rascunho' CHECK (approval_status IN (
                  'rascunho', 'em_testes', 'aprovado', 'publicado')),
  atualizado_por  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Vínculo entre o onboarding e as tarefas reais criadas no Daily (db/074).
CREATE TABLE IF NOT EXISTS agency_onboarding_tasks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id   uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  task_id         uuid NOT NULL REFERENCES agency_tasks(id) ON DELETE CASCADE,
  secao           text,
  criterio_aceite text,
  evidencias      jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onboarding_id, task_id)
);
CREATE INDEX IF NOT EXISTS agency_onboarding_tasks_onb ON agency_onboarding_tasks (onboarding_id);

-- Checklist de homologação. `escopo_key`: NULL = sempre exigido; senão só se o
-- serviço estiver no escopo ('social|branding' = qualquer um dos dois).
CREATE TABLE IF NOT EXISTS agency_onboarding_verifications (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id  uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  chave          text NOT NULL,
  rotulo         text NOT NULL,
  secao          text NOT NULL,
  status         text NOT NULL DEFAULT 'pendente' CHECK (status IN (
                 'pendente', 'em_andamento', 'concluido', 'em_verificacao', 'verificado', 'bloqueado', 'aguardando_aprovacao')),
  obrigatorio    boolean NOT NULL DEFAULT true,
  escopo_key     text,
  evidencias     jsonb NOT NULL DEFAULT '[]',
  task_id        uuid REFERENCES agency_tasks(id) ON DELETE SET NULL,
  verificado_por uuid,
  verificado_em  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (onboarding_id, chave)
);
CREATE INDEX IF NOT EXISTS agency_onboarding_verifications_onb ON agency_onboarding_verifications (onboarding_id, status);

-- Ações que exigem decisão de owner/admin da agência (ex.: mudança de escopo
-- pedida por um member).
CREATE TABLE IF NOT EXISTS agency_onboarding_approvals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id  uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  acao           text NOT NULL,
  payload        jsonb NOT NULL DEFAULT '{}',
  solicitado_por uuid NOT NULL,
  status         text NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovada', 'recusada')),
  decidido_por   uuid,
  justificativa  text,
  decidido_em    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_onboarding_approvals_onb ON agency_onboarding_approvals (onboarding_id, status);

-- Linha do tempo do onboarding (auditoria funcional visível na UI).
CREATE TABLE IF NOT EXISTS agency_onboarding_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  onboarding_id uuid NOT NULL REFERENCES agency_onboardings(id) ON DELETE CASCADE,
  tipo          text NOT NULL,
  dados         jsonb NOT NULL DEFAULT '{}',
  ator          text NOT NULL DEFAULT 'usuario',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_onboarding_events_onb ON agency_onboarding_events (onboarding_id, created_at);

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON agency_onboardings, agency_onboarding_knowledge, agency_onboarding_knowledge_hist, agency_onboarding_meetings, agency_onboarding_reports, agency_onboarding_agents, agency_onboarding_tasks, agency_onboarding_verifications, agency_onboarding_approvals, agency_onboarding_events TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

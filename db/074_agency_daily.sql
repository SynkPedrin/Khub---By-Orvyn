-- =====================================================================
-- 074_agency_daily.sql — Daily da agência (ADR-0050)
--
-- Contexto (pedido do product owner, 2026-11-16): no modo agência, além de
-- Visão geral, Clientes e Equipe, a agência ganha o "Daily" do KROMA OS:
-- Minhas tarefas, Todas as tarefas, Studio (conteúdo com aprovação) e
-- Calendário da agência.
--
-- Escopo: estes dados são da AGÊNCIA, não de uma subconta. Seguem o mesmo
-- modelo de db/026 (agencies, agency_members...): sem tenant_id e sem RLS;
-- o isolamento é feito no AgencyDailyService, que resolve a agência pela
-- identidade da sessão (nunca por id vindo do cliente) e filtra por
-- agency_id + subcontas visíveis do membro. Nenhum dado operacional de
-- subconta (contatos, conversas) é lido ou gravado aqui.
--
-- Aditiva: só cria tabelas novas.
--
-- Rollback:
--   BEGIN;
--   DROP TABLE IF EXISTS agency_event_participantes, agency_events,
--     agency_task_comentarios, agency_task_checklist, agency_tasks;
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS agency_tasks (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id         uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  -- Número legível (#123) para citar a tarefa em conversa.
  numero            bigint GENERATED ALWAYS AS IDENTITY,
  titulo            text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  descricao         text CHECK (descricao IS NULL OR char_length(descricao) <= 20000),
  client_account_id uuid REFERENCES agency_client_accounts(id) ON DELETE SET NULL,
  responsavel_id    uuid REFERENCES agency_members(id) ON DELETE SET NULL,
  criador_id        uuid REFERENCES agency_members(id) ON DELETE SET NULL,
  parent_id         uuid REFERENCES agency_tasks(id) ON DELETE CASCADE,
  tipo              text NOT NULL DEFAULT 'outro' CHECK (tipo IN (
                      'post', 'carrossel', 'reel', 'criativo', 'copy', 'trafego',
                      'landing_page', 'branding', 'reuniao', 'administrativo', 'outro')),
  status            text NOT NULL DEFAULT 'a_fazer' CHECK (status IN (
                      'backlog', 'a_fazer', 'em_andamento', 'em_revisao', 'aguardando_aprovacao', 'concluida')),
  prioridade        text NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('baixa', 'normal', 'alta', 'urgente')),
  inicio_em         timestamptz,
  prazo_em          timestamptz,
  posicao           double precision NOT NULL DEFAULT 0,
  concluida_em      timestamptz,
  arquivada_em      timestamptz,
  -- Studio: só tarefas de conteúdo (post, carrossel, reel, criativo) usam.
  plataformas       text[] NOT NULL DEFAULT '{}',
  objetivo          text CHECK (objetivo IS NULL OR char_length(objetivo) <= 500),
  legenda           text CHECK (legenda IS NULL OR char_length(legenda) <= 5000),
  hashtags          text CHECK (hashtags IS NULL OR char_length(hashtags) <= 1000),
  cta               text CHECK (cta IS NULL OR char_length(cta) <= 300),
  exige_legenda     boolean NOT NULL DEFAULT true,
  -- Data planejada de publicação: diferente do prazo de entrega.
  publicar_em       timestamptz,
  aprovacao         text CHECK (aprovacao IS NULL OR aprovacao IN (
                      'em_producao', 'revisao_interna', 'aguardando_aprovacao', 'ajustes', 'aprovado', 'publicado')),
  publicado_em      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS agency_tasks_status ON agency_tasks (agency_id, status, posicao) WHERE arquivada_em IS NULL;
CREATE INDEX IF NOT EXISTS agency_tasks_responsavel ON agency_tasks (agency_id, responsavel_id) WHERE arquivada_em IS NULL;
CREATE INDEX IF NOT EXISTS agency_tasks_prazo ON agency_tasks (agency_id, prazo_em) WHERE arquivada_em IS NULL AND prazo_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS agency_tasks_publicar ON agency_tasks (agency_id, publicar_em) WHERE arquivada_em IS NULL AND publicar_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS agency_tasks_cliente ON agency_tasks (client_account_id);
CREATE INDEX IF NOT EXISTS agency_tasks_parent ON agency_tasks (parent_id);

CREATE TABLE IF NOT EXISTS agency_task_checklist (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id    uuid NOT NULL REFERENCES agency_tasks(id) ON DELETE CASCADE,
  texto      text NOT NULL CHECK (char_length(texto) BETWEEN 1 AND 300),
  feito      boolean NOT NULL DEFAULT false,
  posicao    integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_task_checklist_task ON agency_task_checklist (task_id, posicao);

CREATE TABLE IF NOT EXISTS agency_task_comentarios (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_id    uuid NOT NULL REFERENCES agency_tasks(id) ON DELETE CASCADE,
  autor_id   uuid REFERENCES agency_members(id) ON DELETE SET NULL,
  corpo      text NOT NULL CHECK (char_length(corpo) BETWEEN 1 AND 5000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_task_comentarios_task ON agency_task_comentarios (task_id, created_at);

-- Compromissos com horário (reuniões, gravações, calls), distintos dos prazos.
CREATE TABLE IF NOT EXISTS agency_events (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  agency_id         uuid NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
  titulo            text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  inicio_em         timestamptz NOT NULL,
  fim_em            timestamptz,
  dia_inteiro       boolean NOT NULL DEFAULT false,
  local             text CHECK (local IS NULL OR char_length(local) <= 300),
  notas             text CHECK (notas IS NULL OR char_length(notas) <= 5000),
  client_account_id uuid REFERENCES agency_client_accounts(id) ON DELETE SET NULL,
  criador_id        uuid REFERENCES agency_members(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (fim_em IS NULL OR fim_em >= inicio_em)
);
CREATE INDEX IF NOT EXISTS agency_events_inicio ON agency_events (agency_id, inicio_em);

CREATE TABLE IF NOT EXISTS agency_event_participantes (
  event_id  uuid NOT NULL REFERENCES agency_events(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES agency_members(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, member_id)
);
CREATE INDEX IF NOT EXISTS agency_event_participantes_member ON agency_event_participantes (member_id);

DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON agency_tasks, agency_task_checklist, agency_task_comentarios, agency_events, agency_event_participantes TO %I', r);
    END IF;
  END LOOP;
END $$;

COMMIT;

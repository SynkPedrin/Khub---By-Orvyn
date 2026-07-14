-- =====================================================================
-- ORVYN · CRM Core (F1) — schema + RLS + seed inicial
-- Migration 003. Idempotente. Rodar com owner/superuser APÓS 000/001/001a.
-- Toda tabela de negócio: tenant_id NOT NULL + RLS (app.current_tenant_id).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  nome         TEXT NOT NULL,
  role         TEXT NOT NULL DEFAULT 'owner',
  provider     TEXT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS pipelines (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  tipo         TEXT NOT NULL DEFAULT 'vendas',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stages (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  pipeline_id  UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  nome         TEXT NOT NULL,
  ordem        INT  NOT NULL,
  cor          TEXT NOT NULL DEFAULT '#7B2FBE',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stages_pipeline ON stages (tenant_id, pipeline_id, ordem);

CREATE TABLE IF NOT EXISTS contacts (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL,
  email          TEXT NULL,
  telefone       TEXT NULL,
  empresa        TEXT NULL,
  tag            TEXT NOT NULL DEFAULT 'Lead',
  tags           TEXT[] NOT NULL DEFAULT '{}',
  valor_estimado NUMERIC(12,2) NOT NULL DEFAULT 0,
  campos_custom  JSONB NOT NULL DEFAULT '{}'::jsonb,
  ultimo_contato_at TIMESTAMPTZ NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_contacts_tenant ON contacts (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  titulo       TEXT NOT NULL,
  contact_id   UUID NULL REFERENCES contacts(id) ON DELETE SET NULL,
  pipeline_id  UUID NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id     UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  valor        NUMERIC(12,2) NOT NULL DEFAULT 0,
  origem       TEXT NULL,
  status       TEXT NOT NULL DEFAULT 'aberto',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals (tenant_id, stage_id);

CREATE TABLE IF NOT EXISTS conversations (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id    UUID NULL REFERENCES contacts(id) ON DELETE SET NULL,
  nome          TEXT NOT NULL,
  canal         TEXT NOT NULL DEFAULT 'WhatsApp',
  status        TEXT NOT NULL DEFAULT 'aberta',
  ultima_previa TEXT NULL,
  nao_lidas     INT NOT NULL DEFAULT 0,
  ultima_hora   TEXT NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations (tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  autor_tipo       TEXT NOT NULL DEFAULT 'contato', -- contato | humano | nyro
  corpo            TEXT NOT NULL,
  hora             TEXT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages (tenant_id, conversation_id, created_at);

CREATE TABLE IF NOT EXISTS activities (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor        TEXT NOT NULL,
  acao         TEXT NOT NULL,
  tone         TEXT NOT NULL DEFAULT 'neutral',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activities_tenant ON activities (tenant_id, created_at DESC);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','pipelines','stages','contacts','deals','conversations','messages','activities']
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
END$$;

-- ---------------------------------------------------------------------
-- Seed inicial (dados REAIS do tenant, persistidos e editáveis).
-- Rodado como superuser (bypassa RLS). Idempotente por UUID fixo do tenant.
-- ---------------------------------------------------------------------
DO $$
DECLARE
  t_id   UUID := 'a0000000-0000-4000-8000-000000000001';
  pl_id  UUID := 'a0000000-0000-4000-8000-0000000000f1';
BEGIN
  IF EXISTS (SELECT 1 FROM tenants WHERE id = t_id) THEN RETURN; END IF;

  INSERT INTO tenants (id, nome, plano, status) VALUES (t_id, 'Sua Empresa', 'growth', 'active');
  INSERT INTO users (tenant_id, email, nome, role) VALUES (t_id, 'voce@orvyn.app', 'Você', 'owner');

  INSERT INTO pipelines (id, tenant_id, nome, tipo) VALUES (pl_id, t_id, 'Funil de Vendas', 'vendas');

  INSERT INTO stages (tenant_id, pipeline_id, nome, ordem, cor) VALUES
    (t_id, pl_id, 'Captação', 0, '#9B4DE0'),
    (t_id, pl_id, 'Qualificação', 1, '#7B2FBE'),
    (t_id, pl_id, 'Proposta', 2, '#5B1E9E'),
    (t_id, pl_id, 'Negociação', 3, '#B7791F'),
    (t_id, pl_id, 'Fechado / Ganho', 4, '#1E8449');

  INSERT INTO contacts (tenant_id, nome, email, telefone, tag, empresa, valor_estimado, ultimo_contato_at) VALUES
    (t_id, 'Marina Alves', 'marina.alves@email.com', '+55 11 99812-4410', 'Lead quente', NULL, 2400, now() - interval '2 hours'),
    (t_id, 'Rafael Nogueira', 'rafa.nog@email.com', '+55 21 99640-1123', 'Paciente', NULL, 3800, now() - interval '1 day'),
    (t_id, 'Cláudia Reis', 'claudia.reis@email.com', '+55 31 98701-2299', 'Cliente', 'Reis Advocacia', 6500, now() - interval '3 days'),
    (t_id, 'João Batista', 'joao.b@email.com', '+55 11 99123-8890', 'Lead', NULL, 4200, now() - interval '5 hours'),
    (t_id, 'Beatriz Lima', 'bia.lima@email.com', '+55 47 99555-3320', 'Lead quente', NULL, 5200, now() - interval '1 hour'),
    (t_id, 'Henrique Souza', 'h.souza@email.com', '+55 85 98444-7712', 'Cliente', NULL, 3100, now() - interval '7 days'),
    (t_id, 'Marcos Vinícius', 'marcos.v@email.com', '+55 51 99388-0091', 'Cliente', 'TechModa Ltda', 5600, now() - interval '2 days'),
    (t_id, 'Padaria Trigo Real', 'contato@trigoreal.com', '+55 19 99700-1234', 'Lead', 'Padaria Trigo Real', 890, now() - interval '4 days');

  -- Deals distribuídos nas etapas, referenciando contatos e stages por nome
  INSERT INTO deals (tenant_id, titulo, contact_id, pipeline_id, stage_id, valor, origem)
  SELECT t_id, x.titulo, c.id, pl_id, s.id, x.valor, x.origem
  FROM (VALUES
    ('Consulta cardiológica — plano anual', 'Marina Alves', 'Captação', 2400, 'Instagram Ads'),
    ('Pacote check-up executivo', 'Rafael Nogueira', 'Captação', 3800, 'Indicação'),
    ('Revisão contrato bancário', 'Cláudia Reis', 'Qualificação', 6500, 'Google Ads'),
    ('Ação previdenciária', 'João Batista', 'Qualificação', 4200, 'WhatsApp'),
    ('Onboarding contábil — Simples', 'Padaria Trigo Real', 'Proposta', 890, 'Site'),
    ('Procedimento estético', 'Beatriz Lima', 'Proposta', 5200, 'Instagram'),
    ('Consultoria tributária', 'Marcos Vinícius', 'Negociação', 7400, 'LinkedIn'),
    ('Plano de acompanhamento', 'Henrique Souza', 'Fechado / Ganho', 3100, 'WhatsApp')
  ) AS x(titulo, contato, etapa, valor, origem)
  JOIN contacts c ON c.tenant_id = t_id AND c.nome = x.contato
  JOIN stages   s ON s.tenant_id = t_id AND s.nome = x.etapa;

  -- Conversas + mensagens
  WITH conv AS (
    INSERT INTO conversations (tenant_id, contact_id, nome, canal, ultima_previa, nao_lidas, ultima_hora)
    SELECT t_id, c.id, c.nome, v.canal, v.previa, v.nl, v.hora
    FROM (VALUES
      ('Marina Alves', 'WhatsApp', 'Perfeito, pode ser quinta às 15h?', 2, '14:32'),
      ('João Batista', 'WhatsApp', 'Vou enviar os documentos hoje.', 0, '11:05'),
      ('Beatriz Lima', 'Instagram', 'Qual o valor do procedimento?', 1, '09:40')
    ) AS v(contato, canal, previa, nl, hora)
    JOIN contacts c ON c.tenant_id = t_id AND c.nome = v.contato
    RETURNING id, nome
  )
  INSERT INTO messages (tenant_id, conversation_id, autor_tipo, corpo, hora)
  SELECT t_id, conv.id, m.autor, m.corpo, m.hora
  FROM conv
  JOIN (VALUES
    ('Marina Alves','contato','Oi! Vi o anúncio de vocês, queria saber sobre a consulta.','14:20'),
    ('Marina Alves','nyro','Olá, Marina! 😊 A primeira consulta inclui avaliação completa. Prefere manhã ou tarde?','14:22'),
    ('Marina Alves','contato','De tarde fica melhor pra mim.','14:30'),
    ('Marina Alves','nyro','Perfeito, pode ser quinta às 15h?','14:32'),
    ('João Batista','contato','Bom dia, consegui separar os documentos da ação.','10:50'),
    ('João Batista','humano','Ótimo, João! Pode enviar por aqui que eu encaminho ao advogado.','10:58'),
    ('João Batista','contato','Vou enviar os documentos hoje.','11:05'),
    ('Beatriz Lima','contato','Oi, qual o valor do procedimento?','09:40')
  ) AS m(contato, autor, corpo, hora) ON m.contato = conv.nome;

  INSERT INTO activities (tenant_id, actor, acao, tone) VALUES
    (t_id, 'Nyro', 'qualificou o lead Marina Alves e agendou consulta', 'brand'),
    (t_id, 'Você', 'moveu "Consultoria tributária" para Negociação', 'neutral'),
    (t_id, 'Nyro', 'sugeriu reativar 12 contatos inativos', 'brand'),
    (t_id, 'Sistema', 'pagamento de R$ 3.100 confirmado (Stripe)', 'green');
END$$;

-- =====================================================================
-- 071_catalogo_estoque_importacao.sql: serviços, profissionais, estoque e
-- registro de importações (migração de dados do Avec e similares)
--
-- Contexto: clínicas e salões chegam com anos de dados em outro sistema
-- (Avec). Clientes, agenda e lançamentos já entram por planilha (db/070 e
-- comercial). Faltava onde morar: o catálogo de SERVIÇOS, os PROFISSIONAIS
-- (que NÃO são usuários do sistema, então `equipe_comissoes` não serve),
-- o ESTOQUE e o rastro de cada importação.
--
--   profissionais        : quem atende e recebe comissão. `identity_id` é um
--                          vínculo OPCIONAL com um usuário da conta.
--   servicos             : catálogo (duração, preço, comissão própria opcional).
--   produtos             : itens de estoque (SKU, custo, preço, mínimo).
--   estoque_movimentos   : razão do estoque. `delta` com sinal (entrada +,
--                          saída −); saldo = SUM(delta). Nunca se edita o
--                          saldo: lança-se um movimento (auditável).
--   importacoes          : cada lote importado (arquivo, contagens, status),
--                          para auditar e DESFAZER o lote inteiro.
--
-- Mudanças em tabelas existentes (sem apagar nada):
--   agenda_compromissos  + servico_id, profissional_id
--   financeiro_transacoes + profissional_id
--   financeiro_comissoes + profissional_id; identity_id passa a aceitar NULL,
--                          com CHECK: identity_id OU profissional_id.
--
-- Isolamento: tenant_id NOT NULL + RLS FORCE + tenant_rw; FKs para linhas de
-- outro tenant recusadas por `*_check_tenant_reference`.
-- Teste: db/071_catalogo_estoque_importacao_isolation_test.sql.
--
-- Papéis: khub_* (QA/prod) e orvyn_* (dev). Reaplicável (IF NOT EXISTS).
--
-- Rollback (manual):
--   BEGIN;
--   ALTER TABLE financeiro_comissoes DROP CONSTRAINT IF EXISTS fin_com_destino_chk;
--   DELETE FROM financeiro_comissoes WHERE identity_id IS NULL;
--   ALTER TABLE financeiro_comissoes ALTER COLUMN identity_id SET NOT NULL;
--   ALTER TABLE financeiro_comissoes DROP COLUMN IF EXISTS profissional_id;
--   ALTER TABLE financeiro_transacoes DROP COLUMN IF EXISTS profissional_id;
--   ALTER TABLE agenda_compromissos DROP COLUMN IF EXISTS servico_id, DROP COLUMN IF EXISTS profissional_id;
--   DROP TABLE IF EXISTS estoque_movimentos, produtos, servicos, profissionais, importacoes;
--   DELETE FROM schema_migrations WHERE filename = 'db/071_catalogo_estoque_importacao.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- ------------------------- importações -------------------------------
CREATE TABLE IF NOT EXISTS importacoes (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fonte          TEXT NOT NULL DEFAULT 'avec' CHECK (length(fonte) BETWEEN 1 AND 40),
  entidade       TEXT NOT NULL CHECK (entidade IN ('clientes','agenda','financeiro','servicos','profissionais','estoque','comissoes')),
  arquivo_nome   TEXT CHECK (arquivo_nome IS NULL OR length(arquivo_nome) <= 200),
  linhas_total   INTEGER NOT NULL DEFAULT 0 CHECK (linhas_total >= 0),
  criados        INTEGER NOT NULL DEFAULT 0 CHECK (criados >= 0),
  atualizados    INTEGER NOT NULL DEFAULT 0 CHECK (atualizados >= 0),
  ignorados      INTEGER NOT NULL DEFAULT 0 CHECK (ignorados >= 0),
  erros          INTEGER NOT NULL DEFAULT 0 CHECK (erros >= 0),
  status         TEXT NOT NULL DEFAULT 'concluida' CHECK (status IN ('concluida','desfeita')),
  resumo         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  desfeita_em    TIMESTAMPTZ,
  CONSTRAINT importacoes_desfeita_chk CHECK ((status = 'desfeita') = (desfeita_em IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_importacoes_tenant ON importacoes (tenant_id, created_at DESC);

-- ------------------------- profissionais -----------------------------
CREATE TABLE IF NOT EXISTS profissionais (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 120),
  especialidade    TEXT CHECK (especialidade IS NULL OR length(especialidade) <= 80),
  comissao_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (comissao_percent >= 0 AND comissao_percent <= 100),
  email            TEXT CHECK (email IS NULL OR length(email) <= 200),
  telefone         TEXT CHECK (telefone IS NULL OR length(telefone) <= 40),
  -- Vínculo opcional com um usuário da conta (quando o profissional também entra no sistema).
  identity_id      UUID REFERENCES identities(id) ON DELETE SET NULL,
  ativo            BOOLEAN NOT NULL DEFAULT true,
  importacao_id    UUID REFERENCES importacoes(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_profissionais_nome ON profissionais (tenant_id, lower(btrim(nome)));
CREATE INDEX IF NOT EXISTS idx_profissionais_importacao ON profissionais (importacao_id) WHERE importacao_id IS NOT NULL;

-- ------------------------- serviços ----------------------------------
CREATE TABLE IF NOT EXISTS servicos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome             TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 160),
  categoria        TEXT CHECK (categoria IS NULL OR length(categoria) <= 80),
  duracao_min      INTEGER NOT NULL DEFAULT 30 CHECK (duracao_min BETWEEN 1 AND 1440),
  preco_centavos   INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
  -- NULL = usa a comissão padrão do profissional.
  comissao_percent NUMERIC(5,2) CHECK (comissao_percent IS NULL OR (comissao_percent >= 0 AND comissao_percent <= 100)),
  ativo            BOOLEAN NOT NULL DEFAULT true,
  importacao_id    UUID REFERENCES importacoes(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_servicos_nome ON servicos (tenant_id, lower(btrim(nome)));
CREATE INDEX IF NOT EXISTS idx_servicos_importacao ON servicos (importacao_id) WHERE importacao_id IS NOT NULL;

-- ------------------------- produtos / estoque ------------------------
CREATE TABLE IF NOT EXISTS produtos (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome           TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 160),
  sku            TEXT CHECK (sku IS NULL OR length(sku) <= 60),
  categoria      TEXT CHECK (categoria IS NULL OR length(categoria) <= 80),
  unidade        TEXT NOT NULL DEFAULT 'un' CHECK (length(unidade) BETWEEN 1 AND 12),
  custo_centavos INTEGER NOT NULL DEFAULT 0 CHECK (custo_centavos >= 0),
  preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK (preco_centavos >= 0),
  estoque_minimo NUMERIC(12,3) NOT NULL DEFAULT 0 CHECK (estoque_minimo >= 0),
  ativo          BOOLEAN NOT NULL DEFAULT true,
  importacao_id  UUID REFERENCES importacoes(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_nome ON produtos (tenant_id, lower(btrim(nome)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_produtos_sku ON produtos (tenant_id, lower(btrim(sku))) WHERE sku IS NOT NULL AND btrim(sku) <> '';
CREATE INDEX IF NOT EXISTS idx_produtos_importacao ON produtos (importacao_id) WHERE importacao_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS estoque_movimentos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  produto_id       UUID NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL CHECK (tipo IN ('entrada','saida','ajuste')),
  -- Efeito no saldo, com sinal: entrada > 0, saída < 0, ajuste ≠ 0.
  delta            NUMERIC(12,3) NOT NULL CHECK (delta <> 0),
  custo_centavos   INTEGER CHECK (custo_centavos IS NULL OR custo_centavos >= 0),
  motivo           TEXT CHECK (motivo IS NULL OR length(motivo) <= 200),
  data_movimento   DATE NOT NULL DEFAULT CURRENT_DATE,
  origem           TEXT NOT NULL DEFAULT 'manual' CHECK (origem IN ('manual','importacao')),
  -- Reimportar o mesmo arquivo não duplica o movimento (índice único abaixo).
  chave_importacao TEXT,
  importacao_id    UUID REFERENCES importacoes(id) ON DELETE SET NULL,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT estoque_mov_sinal_chk CHECK ((tipo = 'entrada' AND delta > 0) OR (tipo = 'saida' AND delta < 0) OR tipo = 'ajuste')
);
CREATE INDEX IF NOT EXISTS idx_estoque_mov_produto ON estoque_movimentos (tenant_id, produto_id, data_movimento DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_estoque_mov_importacao ON estoque_movimentos (tenant_id, chave_importacao) WHERE chave_importacao IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_estoque_mov_importacao ON estoque_movimentos (importacao_id) WHERE importacao_id IS NOT NULL;

-- -------------------- ligações em tabelas existentes ------------------
ALTER TABLE agenda_compromissos
  ADD COLUMN IF NOT EXISTS servico_id UUID REFERENCES servicos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS profissional_id UUID REFERENCES profissionais(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_profissional ON agenda_compromissos (tenant_id, profissional_id) WHERE profissional_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agenda_servico ON agenda_compromissos (tenant_id, servico_id) WHERE servico_id IS NOT NULL;

ALTER TABLE financeiro_transacoes
  ADD COLUMN IF NOT EXISTS profissional_id UUID REFERENCES profissionais(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_fin_tx_profissional ON financeiro_transacoes (tenant_id, profissional_id) WHERE profissional_id IS NOT NULL;

-- Comissão passa a poder ser de um PROFISSIONAL (que não é usuário) em vez de um membro.
ALTER TABLE financeiro_comissoes ADD COLUMN IF NOT EXISTS profissional_id UUID REFERENCES profissionais(id) ON DELETE CASCADE;
ALTER TABLE financeiro_comissoes ALTER COLUMN identity_id DROP NOT NULL;
ALTER TABLE financeiro_comissoes DROP CONSTRAINT IF EXISTS fin_com_destino_chk;
ALTER TABLE financeiro_comissoes ADD CONSTRAINT fin_com_destino_chk CHECK (identity_id IS NOT NULL OR profissional_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_fin_com_profissional ON financeiro_comissoes (tenant_id, profissional_id, competencia) WHERE profissional_id IS NOT NULL;

-- -------------------- RLS (padrão do projeto) -------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['importacoes','profissionais','servicos','produtos','estoque_movimentos'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_rw ON %I FOR ALL
         USING (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)
         WITH CHECK (tenant_id = NULLIF(current_setting(''app.current_tenant_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;

-- -------------------- referências do MESMO tenant ---------------------
DO $$
DECLARE fn TEXT;
BEGIN
  SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'função check_tenant_reference ausente (db/022)'; END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON estoque_movimentos';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON estoque_movimentos
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L)', fn, 'produto_id', 'produtos', 'importacao_id', 'importacoes');

  -- cada um destes ganha a checagem da importação junto das demais referências
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON profissionais';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON profissionais
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'importacao_id', 'importacoes');
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON servicos';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON servicos
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'importacao_id', 'importacoes');
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON produtos';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON produtos
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L)', fn, 'importacao_id', 'importacoes');

  -- Substitui o gatilho da db/054 (só checava contact_id) por um que também checa servico/profissional.
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON agenda_compromissos';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON agenda_compromissos
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L)', fn,
    'contact_id', 'contacts', 'servico_id', 'servicos', 'profissional_id', 'profissionais');

  -- Substitui o da db/070 mantendo as referências antigas e somando profissional.
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON financeiro_transacoes';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON financeiro_transacoes
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', fn,
    'categoria_id', 'financeiro_categorias', 'contact_id', 'contacts',
    'cobranca_id', 'financeiro_cobrancas', 'compromisso_id', 'agenda_compromissos',
    'profissional_id', 'profissionais');
  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON financeiro_comissoes';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON financeiro_comissoes
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L)', fn,
    'transacao_id', 'financeiro_transacoes', 'pagamento_transacao_id', 'financeiro_transacoes',
    'profissional_id', 'profissionais');
END $$;

-- Papéis: `khub_*` no QA/produção, `orvyn_*` no dev (mesmo padrão da db/070).
DO $$ DECLARE r text; t text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['importacoes','profissionais','servicos','produtos','estoque_movimentos'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;

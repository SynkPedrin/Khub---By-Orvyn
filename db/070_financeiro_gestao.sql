-- =====================================================================
-- 070_financeiro_gestao.sql: Gestão financeira completa da empresa
--
-- Até aqui o Financeiro só tinha `financeiro_cobrancas` (db/020): cobrar
-- clientes. Esta migration soma a gestão do dinheiro DA EMPRESA:
--
--   financeiro_categorias  : categorias de entrada/saída por tenant
--                             (ex.: Serviços, Produtos, Aluguel, Salários).
--   financeiro_transacoes  : entradas e saídas (fluxo de caixa real):
--                             manual, cobrança paga, agenda concluída,
--                             importação (ex.: Avec) ou pagamento de comissão.
--                             Valores em CENTAVOS (inteiro).
--   equipe_comissoes       : por membro do tenant: cargo (função real,
--                             ex.: "Cabeleireira") + % de comissão. É uma
--                             EXTENSÃO do membership: não duplica cadastro.
--   financeiro_comissoes   : comissão gerada por entrada paga atribuída a um
--                             membro com % > 0 (prevista → paga). Pagar lança
--                             a saída no caixa (`pagamento_transacao_id`).
--
-- Integrações:
--   agenda_compromissos.valor_centavos: valor do atendimento; ao concluir,
--   a API gera a entrada (origem 'agenda') e a comissão do responsável.
--   Cobrança paga (manual ou webhook Stripe) vira entrada (origem 'cobranca').
--
-- Idempotência garantida no banco (índices únicos):
--   uma entrada por cobrança, uma por atendimento, uma comissão por entrada,
--   um pagamento por comissão e uma linha por chave de importação.
--
-- Isolamento: tenant_id NOT NULL + RLS FORCE + tenant_rw em todas; FKs para
-- linhas de outro tenant recusadas por `*_check_tenant_reference`; quem
-- recebe comissão/entrada atribuída precisa ser membro do tenant.
-- Teste: db/070_financeiro_gestao_isolation_test.sql.
--
-- Papéis: khub_* (QA/prod) e orvyn_* (dev). Reaplicável (IF NOT EXISTS).
--
-- Rollback (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS financeiro_comissoes, equipe_comissoes,
--     financeiro_transacoes, financeiro_categorias;
--   DROP FUNCTION IF EXISTS khub_fin_check_membro();
--   ALTER TABLE agenda_compromissos DROP COLUMN IF EXISTS valor_centavos;
--   DELETE FROM schema_migrations WHERE filename = 'db/070_financeiro_gestao.sql';
--   COMMIT;
-- =====================================================================

BEGIN;

-- ------------------------- categorias --------------------------------
CREATE TABLE IF NOT EXISTS financeiro_categorias (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome        TEXT NOT NULL CHECK (length(btrim(nome)) BETWEEN 1 AND 60),
  tipo        TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  cor         TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_cat_nome
  ON financeiro_categorias (tenant_id, lower(nome), tipo);

-- ------------------------- transações --------------------------------
CREATE TABLE IF NOT EXISTS financeiro_transacoes (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  tipo             TEXT NOT NULL CHECK (tipo IN ('entrada','saida')),
  categoria_id     UUID REFERENCES financeiro_categorias(id) ON DELETE SET NULL,
  descricao        TEXT NOT NULL CHECK (length(btrim(descricao)) BETWEEN 1 AND 200),
  valor_centavos   INTEGER NOT NULL CHECK (valor_centavos > 0),
  data_competencia DATE NOT NULL DEFAULT CURRENT_DATE,
  status           TEXT NOT NULL DEFAULT 'pago' CHECK (status IN ('pago','pendente')),
  contact_id       UUID REFERENCES contacts(id) ON DELETE SET NULL,
  cobranca_id      UUID REFERENCES financeiro_cobrancas(id) ON DELETE SET NULL,
  compromisso_id   UUID REFERENCES agenda_compromissos(id) ON DELETE SET NULL,
  responsavel_id   UUID REFERENCES identities(id) ON DELETE SET NULL,
  origem           TEXT NOT NULL DEFAULT 'manual',
  -- Importação: hash do conteúdo normalizado da linha + ocorrência no arquivo.
  -- Reimportar o mesmo arquivo não duplica (índice único abaixo).
  chave_importacao TEXT,
  observacao       TEXT,
  created_by       UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Reaplicação sobre uma versão anterior desta migration (sem as colunas/checks novos).
ALTER TABLE financeiro_transacoes ADD COLUMN IF NOT EXISTS chave_importacao TEXT;
ALTER TABLE financeiro_transacoes DROP CONSTRAINT IF EXISTS financeiro_transacoes_origem_check;
ALTER TABLE financeiro_transacoes ADD CONSTRAINT financeiro_transacoes_origem_check
  CHECK (origem IN ('manual','agenda','cobranca','importacao','comissao'));

CREATE INDEX IF NOT EXISTS idx_fin_tx_tenant_data
  ON financeiro_transacoes (tenant_id, data_competencia DESC);
CREATE INDEX IF NOT EXISTS idx_fin_tx_categoria
  ON financeiro_transacoes (tenant_id, categoria_id);
CREATE INDEX IF NOT EXISTS idx_fin_tx_responsavel
  ON financeiro_transacoes (tenant_id, responsavel_id) WHERE responsavel_id IS NOT NULL;
-- Uma cobrança paga / um atendimento concluído geram no máximo UMA entrada:
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_tx_cobranca
  ON financeiro_transacoes (cobranca_id) WHERE cobranca_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_tx_compromisso
  ON financeiro_transacoes (compromisso_id) WHERE compromisso_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_tx_importacao
  ON financeiro_transacoes (tenant_id, chave_importacao) WHERE chave_importacao IS NOT NULL;

-- -------------------- comissão por membro (config) --------------------
CREATE TABLE IF NOT EXISTS equipe_comissoes (
  tenant_id         UUID NOT NULL,
  identity_id       UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  cargo             TEXT CHECK (cargo IS NULL OR length(cargo) <= 80),
  comissao_percent  NUMERIC(5,2) NOT NULL DEFAULT 0
                      CHECK (comissao_percent >= 0 AND comissao_percent <= 100),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, identity_id),
  -- Extensão do membership: some junto quando o membro sai da conta.
  FOREIGN KEY (identity_id, tenant_id)
    REFERENCES memberships (identity_id, tenant_id) ON DELETE CASCADE
);

-- -------------------- comissões geradas -------------------------------
CREATE TABLE IF NOT EXISTS financeiro_comissoes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Só identities: o histórico de comissão fica mesmo se o membro sair.
  identity_id     UUID NOT NULL REFERENCES identities(id) ON DELETE CASCADE,
  transacao_id    UUID REFERENCES financeiro_transacoes(id) ON DELETE CASCADE,
  base_centavos   INTEGER NOT NULL CHECK (base_centavos >= 0),
  percent         NUMERIC(5,2) NOT NULL CHECK (percent > 0 AND percent <= 100),
  valor_centavos  INTEGER NOT NULL CHECK (valor_centavos >= 0),
  competencia     DATE NOT NULL, -- sempre dia 1 do mês da entrada
  status          TEXT NOT NULL DEFAULT 'prevista' CHECK (status IN ('prevista','paga')),
  pago_em         TIMESTAMPTZ,
  -- Saída lançada no caixa ao pagar (origem 'comissao').
  pagamento_transacao_id UUID REFERENCES financeiro_transacoes(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fin_com_valor_chk CHECK (valor_centavos <= base_centavos),
  CONSTRAINT fin_com_competencia_chk CHECK (extract(day FROM competencia) = 1),
  CONSTRAINT fin_com_pago_chk CHECK ((status = 'paga') = (pago_em IS NOT NULL))
);

ALTER TABLE financeiro_comissoes ADD COLUMN IF NOT EXISTS pagamento_transacao_id UUID
  REFERENCES financeiro_transacoes(id) ON DELETE SET NULL;

-- Uma transação gera no máximo UMA comissão; um pagamento quita UMA comissão:
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_com_tx
  ON financeiro_comissoes (transacao_id) WHERE transacao_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_com_pagamento
  ON financeiro_comissoes (pagamento_transacao_id) WHERE pagamento_transacao_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fin_com_membro
  ON financeiro_comissoes (tenant_id, identity_id, competencia);
CREATE INDEX IF NOT EXISTS idx_fin_com_competencia
  ON financeiro_comissoes (tenant_id, competencia);

-- -------------------- agenda: valor do atendimento --------------------
ALTER TABLE agenda_compromissos
  ADD COLUMN IF NOT EXISTS valor_centavos INTEGER CHECK (valor_centavos >= 0);

COMMENT ON COLUMN agenda_compromissos.valor_centavos IS
  'Valor do atendimento (centavos). Ao concluir, gera entrada no financeiro e comissão do responsável.';

-- -------------------- RLS (padrão do projeto) -------------------------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['financeiro_categorias','financeiro_transacoes','equipe_comissoes','financeiro_comissoes'] LOOP
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
-- RLS sozinha não impede apontar para id de outro tenant. O nome da função
-- mudou no rebrand (db/035): usa a que existir (mesmo desenho da db/054).
DO $$
DECLARE fn TEXT;
BEGIN
  SELECT proname INTO fn FROM pg_proc WHERE proname IN ('khub_check_tenant_reference', 'orvyn_check_tenant_reference')
   ORDER BY (proname = 'khub_check_tenant_reference') DESC LIMIT 1;
  IF fn IS NULL THEN RAISE EXCEPTION 'função check_tenant_reference ausente (db/022)'; END IF;

  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON financeiro_transacoes';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON financeiro_transacoes
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L, %L, %L, %L, %L)', fn,
    'categoria_id', 'financeiro_categorias', 'contact_id', 'contacts',
    'cobranca_id', 'financeiro_cobrancas', 'compromisso_id', 'agenda_compromissos');

  EXECUTE 'DROP TRIGGER IF EXISTS tenant_reference ON financeiro_comissoes';
  EXECUTE format('CREATE TRIGGER tenant_reference BEFORE INSERT OR UPDATE ON financeiro_comissoes
    FOR EACH ROW EXECUTE FUNCTION %I(%L, %L, %L, %L)', fn,
    'transacao_id', 'financeiro_transacoes', 'pagamento_transacao_id', 'financeiro_transacoes');
END $$;

-- Quem recebe entrada atribuída / comissão precisa ser membro do tenant
-- (identities são globais). Só na escrita da coluna: o histórico continua
-- válido depois que a pessoa sai da conta.
CREATE OR REPLACE FUNCTION khub_fin_check_membro() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref uuid;
BEGIN
  ref := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  IF ref IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM memberships m WHERE m.identity_id = ref AND m.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'pessoa não é membro desta conta' USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS fin_membro ON financeiro_transacoes;
CREATE TRIGGER fin_membro BEFORE INSERT OR UPDATE OF responsavel_id, tenant_id ON financeiro_transacoes
  FOR EACH ROW EXECUTE FUNCTION khub_fin_check_membro('responsavel_id');
DROP TRIGGER IF EXISTS fin_membro ON financeiro_comissoes;
CREATE TRIGGER fin_membro BEFORE INSERT OR UPDATE OF identity_id, tenant_id ON financeiro_comissoes
  FOR EACH ROW EXECUTE FUNCTION khub_fin_check_membro('identity_id');

-- Papéis: `khub_*` no QA/produção, `orvyn_*` no dev (mesmo padrão da db/068).
DO $$ DECLARE r text; t text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app', 'khub_service', 'orvyn_app', 'orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['financeiro_categorias','financeiro_transacoes','equipe_comissoes','financeiro_comissoes'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

COMMIT;

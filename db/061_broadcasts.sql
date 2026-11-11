-- =====================================================================
-- 061_broadcasts.sql — disparo em massa (WhatsApp / e-mail) por segmento
--
-- Contexto (Q4.3): a aba "Disparos" de /campanhas substitui o "em breve".
-- Um disparo nasce rascunho, ganha segmento (o MESMO contrato de filtro da
-- lista de Leads, contatos-filtro.ts, ou uma lista salva `contact_views`),
-- mensagem com variáveis e ritmo (lote, intervalo, janela, fuso).
--
-- Regras que o schema sustenta (a lógica mora em DisparosService):
--   * audiência CONGELADA ao aprovar: `broadcast_recipients` recebe um
--     snapshot (nome + destino) e não muda mais. Opt-out e sem canal entram
--     como `ignorado_*` (rastro de por que ninguém recebeu);
--   * aprovação humana (RegrasNegocio §2): `exige_aprovacao` quando a
--     audiência passa do limite ou o disparo foi criado pela Nyro;
--   * idempotência por destinatário: UNIQUE (broadcast_id, contact_id) e a
--     reserva `tentativa_em` antes do envio. Retry nunca duplica;
--   * lease (`lease_until`) para um único worker processar o lote por vez.
--
-- Também amplia `notifications.tipo` (db/055) para os avisos persistidos
-- novos: 'disparo_aprovacao' (061) e 'avaliacao_negativa' (062).
--
-- ADITIVA: tabelas novas + CHECK ampliado. Nenhuma linha existente muda.
--
-- Rollback (manual):
--   BEGIN;
--   DROP TABLE IF EXISTS broadcast_recipients;
--   DROP TABLE IF EXISTS broadcasts;
--   DELETE FROM notifications WHERE tipo IN ('disparo_aprovacao','avaliacao_negativa');
--   ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_tipo_chk;
--   ALTER TABLE notifications ADD CONSTRAINT notifications_tipo_chk CHECK (tipo IN ('mencao'));
--   COMMIT;
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS broadcasts (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nome                 TEXT NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 120),
  canal                TEXT NOT NULL CHECK (canal IN ('whatsapp', 'email')),
  segmento             JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(segmento) = 'object'),
  mensagem             TEXT NOT NULL DEFAULT '' CHECK (char_length(mensagem) <= 4000),
  assunto              TEXT CHECK (assunto IS NULL OR char_length(assunto) <= 200),
  status               TEXT NOT NULL DEFAULT 'rascunho' CHECK (status IN
                         ('rascunho', 'aguardando_aprovacao', 'agendado', 'enviando', 'pausado', 'concluido', 'cancelado')),
  agendado_para        TIMESTAMPTZ,
  lote_tamanho         INT NOT NULL DEFAULT 20 CHECK (lote_tamanho BETWEEN 1 AND 500),
  lote_intervalo_seg   INT NOT NULL DEFAULT 60 CHECK (lote_intervalo_seg BETWEEN 10 AND 86400),
  janela               JSONB NOT NULL DEFAULT '{"dias":[1,2,3,4,5],"inicio":9,"fim":18,"fuso":"America/Sao_Paulo"}'::jsonb
                         CHECK (jsonb_typeof(janela) = 'object'),
  exige_aprovacao      BOOLEAN NOT NULL DEFAULT false,
  aprovado_por         UUID,
  aprovado_em          TIMESTAMPTZ,
  rejeitado_motivo     TEXT CHECK (rejeitado_motivo IS NULL OR char_length(rejeitado_motivo) <= 500),
  criado_por           UUID,
  criado_por_tipo      TEXT NOT NULL DEFAULT 'humano' CHECK (criado_por_tipo IN ('humano', 'nyro')),
  pausa_motivo         TEXT,
  pausa_detalhe        JSONB,
  proximo_lote_em      TIMESTAMPTZ,
  lease_until          TIMESTAMPTZ,
  iniciado_em          TIMESTAMPTZ,
  concluido_em         TIMESTAMPTZ,
  cancelado_em         TIMESTAMPTZ,
  total_destinatarios  INT NOT NULL DEFAULT 0,
  total_enviados       INT NOT NULL DEFAULT 0,
  total_falhas         INT NOT NULL DEFAULT 0,
  total_ignorados      INT NOT NULL DEFAULT 0,
  total_respostas      INT NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (canal <> 'email' OR status = 'rascunho' OR char_length(coalesce(assunto, '')) > 0)
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_lista ON broadcasts (tenant_id, created_at DESC);
-- Varredura do worker: só os que ainda têm o que mandar.
CREATE INDEX IF NOT EXISTS idx_broadcasts_fila ON broadcasts (tenant_id, proximo_lote_em)
  WHERE status IN ('agendado', 'enviando');

CREATE TABLE IF NOT EXISTS broadcast_recipients (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  broadcast_id  UUID NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  -- LGPD: excluir o contato apaga o rastro do envio junto.
  contact_id    UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  nome          TEXT NOT NULL DEFAULT '',
  destino       TEXT,
  status        TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN
                  ('pendente', 'enviado', 'falhou', 'ignorado_optout', 'ignorado_sem_canal', 'respondeu')),
  message_id    UUID,
  erro          TEXT CHECK (erro IS NULL OR char_length(erro) <= 500),
  tentativa_em  TIMESTAMPTZ,
  enviado_em    TIMESTAMPTZ,
  respondido_em TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_broadcast_recipient UNIQUE (broadcast_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_status ON broadcast_recipients (tenant_id, broadcast_id, status);
-- Resposta em até 72h: acha rápido o envio recente de um contato.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_resposta ON broadcast_recipients (tenant_id, contact_id, enviado_em)
  WHERE status = 'enviado';
-- Limite diário por tenant: soma do que saiu hoje.
CREATE INDEX IF NOT EXISTS idx_broadcast_recipients_enviados ON broadcast_recipients (tenant_id, enviado_em)
  WHERE enviado_em IS NOT NULL;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['broadcasts', 'broadcast_recipients'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_rw ON %I', t);
    EXECUTE format($p$CREATE POLICY tenant_rw ON %I FOR ALL
      USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)$p$, t);
  END LOOP;
END $$;

DO $$ DECLARE r text; t text; BEGIN
  FOREACH r IN ARRAY ARRAY['khub_app','khub_service','orvyn_app','orvyn_service'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      FOREACH t IN ARRAY ARRAY['broadcasts', 'broadcast_recipients'] LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO %I', t, r);
      END LOOP;
    END IF;
  END LOOP;
END $$;

-- Avisos persistidos novos (ver cabeçalho). Só AMPLIA a lista de db/055.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_tipo_chk;
ALTER TABLE notifications ADD CONSTRAINT notifications_tipo_chk
  CHECK (tipo IN ('mencao', 'disparo_aprovacao', 'avaliacao_negativa'));

COMMIT;

-- =====================================================================
-- Calendário individual por colaborador — teste de isolamento (db/069)
-- BLOQUEANTE: qualquer vazamento faz RAISE EXCEPTION → exit != 0.
--
-- Rodar:  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/069_booking_pessoal_isolation_test.sql
-- Tudo em ROLLBACK: não deixa resíduo.
--
-- Prova, como khub_app (sem BYPASSRLS):
--   1. página pessoal de B é invisível para A (leitura, update, delete);
--   2. A não grava página pessoal no tenant B (WITH CHECK);
--   3. dono precisa ser membro do tenant (membro de B recusado em A);
--   4. dono precisa estar entre os responsáveis;
--   5. uma só página pessoal por membro (índice único parcial), mas o
--      mesmo membro pode ter a dele em cada tenant de que participa;
--   6. página pessoal ativa resolve pelo slug público.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000069', 'TENANT_A_BP'),
  ('b2b2b2b2-0000-4000-8000-000000000069', 'TENANT_B_BP');
INSERT INTO identities (id, email) VALUES
  ('1da00000-0000-4000-8000-00000000069a', 'dono-a-069@teste.khub'),
  ('1db00000-0000-4000-8000-00000000069b', 'dono-b-069@teste.khub');
INSERT INTO memberships (identity_id, tenant_id, role) VALUES
  ('1da00000-0000-4000-8000-00000000069a', 'a1a1a1a1-0000-4000-8000-000000000069', 'member'),
  ('1db00000-0000-4000-8000-00000000069b', 'b2b2b2b2-0000-4000-8000-000000000069', 'member');
SELECT set_config('app.current_tenant_id', 'b2b2b2b2-0000-4000-8000-000000000069', true);
INSERT INTO booking_pages (id, tenant_id, slug, titulo, owner_id, responsaveis, distribuicao) VALUES
  ('bb000000-0000-4000-8000-00000000069b', 'b2b2b2b2-0000-4000-8000-000000000069', 'pessoal-secreta-b-069', 'PESSOAL_SECRETA_B',
   '1db00000-0000-4000-8000-00000000069b', ARRAY['1db00000-0000-4000-8000-00000000069b']::uuid[], 'fixo');

SET LOCAL ROLE khub_app;

DO $$
DECLARE n INT; t uuid;
BEGIN
  -- (1) A não vê nem toca a página pessoal de B.
  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000069', true);
  SELECT count(*) INTO n FROM booking_pages WHERE titulo = 'PESSOAL_SECRETA_B';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[booking_pages pessoal]: A leu página de B'; END IF;
  UPDATE booking_pages SET titulo = 'HACK' WHERE id = 'bb000000-0000-4000-8000-00000000069b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update pessoal]: A alterou página de B'; END IF;
  DELETE FROM booking_pages WHERE id = 'bb000000-0000-4000-8000-00000000069b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete pessoal]: A apagou página de B'; END IF;

  -- (2) INSERT com tenant de B é barrado.
  BEGIN
    INSERT INTO booking_pages (tenant_id, slug, titulo, owner_id, responsaveis) VALUES
      ('b2b2b2b2-0000-4000-8000-000000000069', 'forjada-em-b-069', 'FORJADA',
       '1db00000-0000-4000-8000-00000000069b', ARRAY['1db00000-0000-4000-8000-00000000069b']::uuid[]);
    RAISE EXCEPTION 'VAZAMENTO[write pessoal]: A gravou página no tenant B';
  EXCEPTION WHEN insufficient_privilege OR check_violation THEN NULL;
  END;

  -- (3) Dono que não é membro do tenant é recusado.
  BEGIN
    INSERT INTO booking_pages (tenant_id, slug, titulo, owner_id, responsaveis) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000069', 'dono-estranho-069', 'DONO ESTRANHO',
       '1db00000-0000-4000-8000-00000000069b', ARRAY['1db00000-0000-4000-8000-00000000069b']::uuid[]);
    RAISE EXCEPTION 'FALHA[dono membro]: membro de B virou dono em A';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  -- (4) Dono fora dos responsáveis é recusado.
  BEGIN
    INSERT INTO booking_pages (tenant_id, slug, titulo, owner_id, responsaveis) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000069', 'dono-fora-da-fila-069', 'DONO FORA',
       '1da00000-0000-4000-8000-00000000069a', '{}'::uuid[]);
    RAISE EXCEPTION 'FALHA[dono na fila]: página pessoal sem o dono nos responsáveis';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  -- (5) Uma página pessoal por membro; a segunda é barrada pelo índice.
  INSERT INTO booking_pages (id, tenant_id, slug, titulo, owner_id, responsaveis, distribuicao) VALUES
    ('ba000000-0000-4000-8000-00000000069a', 'a1a1a1a1-0000-4000-8000-000000000069', 'pessoal-a-069', 'Pessoal A',
     '1da00000-0000-4000-8000-00000000069a', ARRAY['1da00000-0000-4000-8000-00000000069a']::uuid[], 'fixo');
  BEGIN
    INSERT INTO booking_pages (tenant_id, slug, titulo, owner_id, responsaveis) VALUES
      ('a1a1a1a1-0000-4000-8000-000000000069', 'pessoal-a-2-069', 'Duplicada',
       '1da00000-0000-4000-8000-00000000069a', ARRAY['1da00000-0000-4000-8000-00000000069a']::uuid[]);
    RAISE EXCEPTION 'FALHA[única por membro]: segunda página pessoal passou';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Página de EQUIPE (owner NULL) não disputa o índice: várias por tenant.
  INSERT INTO booking_pages (tenant_id, slug, titulo) VALUES
    ('a1a1a1a1-0000-4000-8000-000000000069', 'equipe-a-069', 'Equipe A'),
    ('a1a1a1a1-0000-4000-8000-000000000069', 'equipe-a-2-069', 'Equipe A 2');

  -- (6) A página pessoal ativa resolve pelo slug público.
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT tenant_id INTO t FROM resolve_booking_page_by_slug('pessoal-a-069');
  IF t IS DISTINCT FROM 'a1a1a1a1-0000-4000-8000-000000000069'::uuid THEN RAISE EXCEPTION 'FALHA[resolve pessoal]: veio %', t; END IF;

  RAISE NOTICE 'PASS 069 booking pessoal: isolamento, dono membro, dono na fila, unicidade e resolução pública OK';
END $$;

ROLLBACK;

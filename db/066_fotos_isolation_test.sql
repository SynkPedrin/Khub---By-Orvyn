-- =====================================================================
-- Fotos de contato — teste de isolamento cross-tenant (db/066)
-- BLOQUEANTE: vazamento faz RAISE EXCEPTION. ROLLBACK no fim.
-- =====================================================================
\set ON_ERROR_STOP on
BEGIN;

SET LOCAL ROLE khub_service;
INSERT INTO tenants (id, nome) VALUES
  ('a1a1a1a1-0000-4000-8000-000000000066', 'TENANT_A_FOTO'),
  ('b2b2b2b2-0000-4000-8000-000000000066', 'TENANT_B_FOTO');
INSERT INTO contacts (id, tenant_id, nome, atribuicao) VALUES
  ('ca000000-0000-4000-8000-00000000066a', 'a1a1a1a1-0000-4000-8000-000000000066', 'Contato A', '{"fonte":"meta_ads"}'),
  ('cb000000-0000-4000-8000-00000000066b', 'b2b2b2b2-0000-4000-8000-000000000066', 'CONTATO_SECRETO_B', '{"fonte":"google_ads"}');
INSERT INTO contact_fotos (contact_id, tenant_id, mime, bytes, fonte) VALUES
  ('ca000000-0000-4000-8000-00000000066a', 'a1a1a1a1-0000-4000-8000-000000000066', 'image/jpeg', '\xffd8ff'::bytea, 'whatsapp'),
  ('cb000000-0000-4000-8000-00000000066b', 'b2b2b2b2-0000-4000-8000-000000000066', 'image/jpeg', '\xffd8ffee'::bytea, 'instagram');

SET LOCAL ROLE khub_app;
DO $$
DECLARE n INT;
BEGIN
  PERFORM set_config('app.current_tenant_id', '', true);
  SELECT count(*) INTO n FROM contact_fotos;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[contact_fotos sem tenant]: %', n; END IF;

  PERFORM set_config('app.current_tenant_id', 'a1a1a1a1-0000-4000-8000-000000000066', true);
  SELECT count(*) INTO n FROM contact_fotos WHERE tenant_id = 'b2b2b2b2-0000-4000-8000-000000000066';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[contact_fotos]: A leu foto de B'; END IF;
  UPDATE contact_fotos SET fonte = 'messenger' WHERE contact_id = 'cb000000-0000-4000-8000-00000000066b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[update contact_fotos]'; END IF;
  DELETE FROM contact_fotos WHERE contact_id = 'cb000000-0000-4000-8000-00000000066b';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[delete contact_fotos]'; END IF;
  BEGIN
    INSERT INTO contact_fotos (contact_id, tenant_id, mime, bytes, fonte) VALUES ('cb000000-0000-4000-8000-00000000066b', 'a1a1a1a1-0000-4000-8000-000000000066', 'image/jpeg', '\xff'::bytea, 'whatsapp');
    RAISE EXCEPTION 'VAZAMENTO[ref contact_fotos→contacts]: A gravou foto no contato de B';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  SELECT count(*) INTO n FROM contacts WHERE atribuicao->>'fonte' = 'google_ads';
  IF n <> 0 THEN RAISE EXCEPTION 'VAZAMENTO[contacts.atribuicao]: A leu atribuição de B'; END IF;
  RAISE NOTICE 'OK 066: fotos e atribuição isoladas';
END $$;

RESET ROLE;
ROLLBACK;
\echo ' 066 OK — fotos de contato isoladas por tenant.'

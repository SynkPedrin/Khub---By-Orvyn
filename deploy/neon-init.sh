#!/usr/bin/env bash
# =====================================================================
# Inicializa um banco Neon NOVO e VAZIO com o schema completo do KHUB.
#
# Uso (no Mac, na raiz do repositório):
#   NEON_ADMIN_URL='postgresql://<dono>:<senha>@<host>/<banco>?sslmode=require' \
#   KHUB_APP_PASSWORD='<senha forte para khub_app>' \
#   KHUB_SERVICE_PASSWORD='<senha forte para khub_service>' \
#   ./deploy/neon-init.sh
#
# O que faz:
#   1. recusa rodar se o banco já tiver o schema do KHUB (proteção contra
#      reaplicar em banco com dados);
#   2. aplica db/*.sql em ordem pelo runner oficial (apps/api/scripts/db-migrate.mjs),
#      pulando os testes de isolamento, e registra cada arquivo em schema_migrations;
#   3. define as senhas dos papéis khub_app (a API usa este) e khub_service;
#   4. roda o teste de isolamento db/002 como khub_app;
#   5. imprime a DATABASE_URL que vai no Render.
#
# Sem psql instalado, usa a imagem Docker postgres:16 como psql.
# =====================================================================
set -euo pipefail

: "${NEON_ADMIN_URL:?defina NEON_ADMIN_URL (conexão do dono do banco no Neon)}"
: "${KHUB_APP_PASSWORD:?defina KHUB_APP_PASSWORD}"
: "${KHUB_SERVICE_PASSWORD:?defina KHUB_SERVICE_PASSWORD}"

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
DB_DIR="$RAIZ/db"

# psql local ou psql dentro de um contêiner descartável (mesmo caminho montado)
if command -v psql >/dev/null 2>&1; then
  PSQL=(psql)
else
  command -v docker >/dev/null 2>&1 || { echo "Instale o psql ou o Docker." >&2; exit 1; }
  SHIM="$(mktemp -d)"
  cat > "$SHIM/psql" <<EOF
#!/usr/bin/env bash
exec docker run --rm -i -v "$DB_DIR:$DB_DIR:ro" postgres:16 psql "\$@"
EOF
  chmod +x "$SHIM/psql"
  export PATH="$SHIM:$PATH"
  PSQL=("$SHIM/psql")
fi

echo "1/5 Conferindo se o banco está vazio…"
JA=$("${PSQL[@]}" "$NEON_ADMIN_URL" -Atc "select to_regclass('public.contacts') is not null")
if [ "$JA" = "t" ]; then
  echo "Este banco já tem o schema do KHUB (tabela contacts existe). Nada foi alterado." >&2
  exit 1
fi

echo "1b/5 Preparando os papéis da aplicação…"
# Postgres 16+: o dono do banco só passa a propriedade de objetos (ALTER ... OWNER TO)
# para papéis que ele consiga assumir. Cria os papéis antes da migração 000 (que é
# idempotente) e dá ao dono o direito de assumi-los. Os nomes khub_* vêm da 035.
"${PSQL[@]}" "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orvyn_app')     THEN CREATE ROLE orvyn_app LOGIN NOBYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='orvyn_service') THEN CREATE ROLE orvyn_service LOGIN BYPASSRLS; END IF;
END $$;
GRANT orvyn_app, orvyn_service TO CURRENT_USER WITH SET TRUE, INHERIT TRUE;
GRANT USAGE, CREATE ON SCHEMA public TO orvyn_app, orvyn_service;
SQL

echo "2/5 Aplicando as migrações em ordem…"
( cd "$RAIZ/apps/api" && npx prisma generate >/dev/null && ADMIN_DATABASE_URL="$NEON_ADMIN_URL" node scripts/db-migrate.mjs )

echo "3/5 Definindo as senhas dos papéis…"
"${PSQL[@]}" "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 \
  -v app_password="$KHUB_APP_PASSWORD" -v service_password="$KHUB_SERVICE_PASSWORD" <<'SQL'
ALTER ROLE khub_app     LOGIN PASSWORD :'app_password';
ALTER ROLE khub_service LOGIN PASSWORD :'service_password';
SQL

echo "4/5 Teste de isolamento entre clientes (db/002)…"
# O teste troca de papel por dentro (SET ROLE khub_service/khub_app), então roda
# como o dono do banco. No Neon o dono não é superusuário: se ele não puder
# assumir esses papéis, o teste não roda, mas a inicialização já está completa.
if "${PSQL[@]}" "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 -q -f "$DB_DIR/002_isolation_test.sql" >/dev/null 2>"${TMPDIR:-/tmp}/khub-isolamento.err"; then
  echo "   isolamento: PASS"
elif grep -q "permission denied to set role" "${TMPDIR:-/tmp}/khub-isolamento.err"; then
  echo "   isolamento: não rodou (o dono do Neon não pode assumir os papéis da app). Schema aplicado mesmo assim."
else
  cat "${TMPDIR:-/tmp}/khub-isolamento.err" >&2
  echo "   isolamento: FALHOU. Não ponha a API no ar antes de investigar." >&2
  exit 1
fi

echo "5/5 Pronto. No Render, use como DATABASE_URL:"
node -e '
  const u = new URL(process.env.NEON_ADMIN_URL);
  u.username = "khub_app"; u.password = "<KHUB_APP_PASSWORD>";
  console.log("   " + u.toString());'

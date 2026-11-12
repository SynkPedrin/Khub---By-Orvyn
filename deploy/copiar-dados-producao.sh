#!/usr/bin/env bash
# =====================================================================
# Copia os dados reais do banco de DEV para o banco de PRODUÇÃO (Neon),
# já inicializado pelo deploy/neon-init.sh.
#
# Uso (no Mac, na raiz do repositório, com o Docker aberto):
#   NEON_ADMIN_URL='postgresql://<dono>:<senha>@<host>/<banco>?sslmode=require' \
#   SUBCONTAS='<Cliente A>,<Cliente B>' \
#   KHUB_SERVICE_PASSWORD='<a mesma senha usada no neon-init.sh>' \
#   ./deploy/copiar-dados-producao.sh
#
# Opcional:
#   SUBCONTAS='Cliente A,Cliente B'   (OBRIGATÓRIO: nomes exatos das subcontas, separados por vírgula)
#   DEV_CONTAINER=orvyn-postgres  DEV_DB=orvyn      (origem)
#   TARGET_CONTAINER=<container local>             (só para teste: alvo num Postgres local)
#
# O QUE COPIA: as subcontas escolhidas com tudo o que é delas (contatos,
# conversas, mensagens, funis, negócios, agenda, automações publicadas, agentes
# de IA e conhecimento, integrações), a agência que as atende, os membros e
# identidades ligados a elas (login e senha continuam os mesmos), e a base de
# conhecimento global (linhas sem tenant_id das tabelas do RAG).
# O QUE NÃO COPIA (de propósito, para a produção não disparar nada antigo ao
# ligar): fila de eventos (outbox), execuções de automação em andamento e seus
# passos, entregas e follow-ups pendentes dos agentes, sessões (refresh tokens),
# convites e tokens de senha.
#
# Durante a carga, os gatilhos de usuário ficam DESLIGADOS (nada de evento
# "contato criado" falso) e a ordem segue as chaves estrangeiras. A carga usa
# o papel khub_service (BYPASSRLS); ativar/desativar gatilhos usa o dono.
# Integrações cifradas: a produção precisa do MESMO INTEGRATIONS_ENCRYPTION_KEY
# do dev, senão os tokens copiados não abrem (reconecte pela tela, se preferir).
# =====================================================================
set -euo pipefail

: "${NEON_ADMIN_URL:?defina NEON_ADMIN_URL (dono do banco de produção)}"
: "${KHUB_SERVICE_PASSWORD:?defina KHUB_SERVICE_PASSWORD}"
: "${SUBCONTAS:?defina SUBCONTAS com os nomes exatos das subcontas a copiar, separados por vírgula}"
DEV_CONTAINER="${DEV_CONTAINER:-orvyn-postgres}"
DEV_DB="${DEV_DB:-orvyn}"

src() { docker exec -i "$DEV_CONTAINER" psql -U postgres -d "$DEV_DB" -v ON_ERROR_STOP=1 -X "$@"; }
SERVICE_URL=$(node -e '
  const u = new URL(process.env.NEON_ADMIN_URL);
  u.username = "khub_service"; u.password = process.env.KHUB_SERVICE_PASSWORD;
  process.stdout.write(u.toString());')
if [ -n "${TARGET_CONTAINER:-}" ]; then
  # Teste local: o alvo é um Postgres em contêiner (as URLs só levam usuário e banco).
  TDB=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.NEON_ADMIN_URL).pathname.slice(1)))')
  TUSER=$(node -e 'process.stdout.write(decodeURIComponent(new URL(process.env.NEON_ADMIN_URL).username))')
  dono()    { docker exec -i "$TARGET_CONTAINER" psql -U "$TUSER" -d "$TDB" -v ON_ERROR_STOP=1 -X "$@"; }
  servico() { docker exec -i "$TARGET_CONTAINER" psql -U khub_service -d "$TDB" -v ON_ERROR_STOP=1 -X "$@"; }
elif command -v psql >/dev/null 2>&1; then
  dono()    { psql "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 -X "$@"; }
  servico() { psql "$SERVICE_URL" -v ON_ERROR_STOP=1 -X "$@"; }
else
  dono()    { docker run --rm -i postgres:16 psql "$NEON_ADMIN_URL" -v ON_ERROR_STOP=1 -X "$@"; }
  servico() { docker run --rm -i postgres:16 psql "$SERVICE_URL" -v ON_ERROR_STOP=1 -X "$@"; }
fi

# Tabelas que nunca vão (estado operacional ou de sessão).
PULAR=" schema_migrations outbox_events refresh_tokens agency_invites password_reset_tokens invites workflow_runs workflow_run_steps workflow_jobs workflow_dlq agent_delivery_queue agent_followups webhook_events custom_field_defs_legado "

echo "1/6 Conferindo o alvo…"
[ "$(dono -Atc "select to_regclass('public.contacts') is not null")" = "t" ] || { echo "O alvo não tem o schema. Rode antes o deploy/neon-init.sh." >&2; exit 1; }
# A migração 003 cria a subconta padrão "Sua Empresa" (a0000000-…-0001) em todo
# banco novo: ela é ignorada. Qualquer outra subconta ou contato = banco em uso.
SEMENTE="a0000000-0000-4000-8000-000000000001"
[ "$(dono -Atc "select count(*) from tenants where id::text <> '$SEMENTE'")" = "0" ] && [ "$(dono -Atc "select count(*) from contacts where tenant_id::text <> '$SEMENTE'")" = "0" ] \
  || { echo "O alvo já tem dados. Por segurança, a cópia só roda num banco recém-inicializado." >&2; exit 1; }

echo "2/6 Subcontas escolhidas…"
LISTA_SQL=$(node -e 'process.stdout.write(process.argv[1].split(",").map(s=>"\x27"+s.trim().replace(/\x27/g,"\x27\x27")+"\x27").join(","))' "$SUBCONTAS")
TENANTS=$(src -Atc "select string_agg(quote_literal(id::text), ',') from tenants where nome in ($LISTA_SQL)")
QTD=$(src -Atc "select count(*) from tenants where nome in ($LISTA_SQL)")
ESPERADO=$(node -e 'process.stdout.write(String(process.argv[1].split(",").length))' "$SUBCONTAS")
[ "$QTD" = "$ESPERADO" ] || { echo "Achei $QTD de $ESPERADO subcontas pelo nome. Confira SUBCONTAS." >&2; exit 1; }
src -Atc "select '   - '||nome from tenants where id::text in ($TENANTS) order by nome"
AGENCIAS="select agency_id from agency_client_accounts where tenant_id::text in ($TENANTS)"
IDENTIDADES="select identity_id from memberships where tenant_id::text in ($TENANTS) union select identity_id from agency_members where agency_id in ($AGENCIAS) union select owner_identity_id from agencies where id in ($AGENCIAS)"

filtro() { # $1 = tabela → cláusula WHERE da origem
  case "$1" in
    tenants) echo "where id::text in ($TENANTS)";;
    agencies) echo "where id in ($AGENCIAS)";;
    agency_members) echo "where agency_id in ($AGENCIAS)";;
    agency_member_client_access) echo "where client_account_id in (select id from agency_client_accounts where tenant_id::text in ($TENANTS))";;
    identities) echo "where id in ($IDENTIDADES)";;
    *)
      if [ "$(src -Atc "select is_nullable from information_schema.columns where table_schema='public' and table_name='$1' and column_name='tenant_id'")" = "YES" ]; then
        echo "where tenant_id is null or tenant_id::text in ($TENANTS)"
      else
        echo "where tenant_id::text in ($TENANTS)"
      fi;;
  esac
}

echo "3/6 Guardando as chaves estrangeiras do alvo…"
ORDEM=$(dono -Atc "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p') and not c.relispartition order by 1")
FKS_ARQ=$(mktemp)
# Só as declaradas na própria tabela (as herdadas pelas partições voltam junto).
dono -At -F $'\t' -c "select format('%I', conrelid::regclass::text), format('%I', conname), pg_get_constraintdef(oid) from pg_constraint where contype='f' and connamespace='public'::regnamespace and conparentid=0" > "$FKS_ARQ"
echo "   $(wc -l < "$FKS_ARQ" | tr -d ' ') chaves estrangeiras"

religar() {
  echo "   recolocando chaves estrangeiras e gatilhos…"
  local falhou=0
  # fd 3: o docker exec -i dentro do laço não pode consumir a lista.
  while IFS=$'\t' read -r tab nome def <&3; do
    [ -n "$tab" ] || continue
    if ! dono -qc "alter table public.$tab add constraint $nome $def" >/dev/null 2>"${FKS_ARQ}.err"; then
      if grep -q "already exists" "${FKS_ARQ}.err"; then continue; fi
      # Dado inconsistente: recoloca sem validar (o schema fica íntegro) e avisa.
      dono -qc "alter table public.$tab add constraint $nome $def not valid" >/dev/null 2>&1 || true
      echo "   AVISO: $tab.$nome não validou: $(head -c 200 "${FKS_ARQ}.err")" >&2
      falhou=1
    fi
  done 3< "$FKS_ARQ"
  for t in $ORDEM; do dono -qc "alter table public.\"$t\" enable trigger user" >/dev/null || true; done
  return $falhou
}
trap 'religar || true; echo "A cópia NÃO terminou. Recrie o banco (neon-init.sh) antes de tentar de novo." >&2' EXIT

echo "4/6 Desligando gatilhos de usuário e chaves estrangeiras durante a carga…"
for t in $ORDEM; do dono -qc "alter table public.\"$t\" disable trigger user" >/dev/null; done
while IFS=$'\t' read -r tab nome def <&3; do
  [ -n "$tab" ] && dono -qc "alter table public.$tab drop constraint if exists $nome" >/dev/null
done 3< "$FKS_ARQ"

echo "5/6 Copiando…"
TOTAL=0
for t in $ORDEM; do
  case "$PULAR" in *" $t "*) continue;; esac
  [ "$(src -Atc "select to_regclass('public.\"$t\"') is not null")" = "t" ] || continue
  # Colunas que existem nos dois lados e não são geradas no alvo.
  COLS=$(dono -Atc "select string_agg(quote_ident(a.attname), ',' order by a.attnum) from pg_attribute a where a.attrelid='public.\"$t\"'::regclass and a.attnum>0 and not a.attisdropped and a.attgenerated='' and a.attname in (select column_name from information_schema.columns where table_schema='public' and table_name='$t')")
  SRC_COLS=$(src -Atc "select string_agg(quote_ident(column_name), ',') from information_schema.columns where table_schema='public' and table_name='$t'")
  COMUNS=$(node -e 'const a=process.argv[1].split(","),b=new Set(process.argv[2].split(","));process.stdout.write(a.filter(c=>c&&b.has(c)).join(","))' "$COLS" "$SRC_COLS")
  [ -n "$COMUNS" ] || continue
  W=$(filtro "$t")
  N=$(src -Atc "select count(*) from public.\"$t\" $W")
  [ "$N" = "0" ] && continue
  src -c "copy (select $COMUNS from public.\"$t\" $W) to stdout" | servico -qc "copy public.\"$t\" ($COMUNS) from stdin"
  printf "   %-34s %6s linhas\n" "$t" "$N"
  TOTAL=$((TOTAL + N))
done
trap - EXIT
if ! religar; then echo "Há referências inconsistentes (avisos acima). Revise antes de pôr a API no ar." >&2; exit 1; fi

echo "6/6 Conferência…"
dono -Atc "select '   subcontas: '||count(*) from tenants"
dono -Atc "select '   identidades: '||count(*) from identities"
dono -Atc "select '   contatos: '||count(*) from contacts"
dono -Atc "select '   agentes: '||count(*) from agents"
echo "Pronto: $TOTAL linhas copiadas. Login e senha dos usuários são os mesmos do dev."

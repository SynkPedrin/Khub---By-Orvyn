# db/ — Migrações do RAG (R0)

Camada de banco do módulo RAG da Nyro IA. **R0 = schema + RLS + teste de vazamento, sem nenhuma linha de IA.** É o gate inegociável: vazamento cross-tenant em base de saúde/jurídico é incidente de LGPD, não bug.

## Pré-requisitos
- PostgreSQL 15+ com **pgvector 0.7+** (extensão `vector`), `pg_trgm`, `unaccent`, `uuid-ossp`.
- `psql` no PATH (ou um container `orvyn-postgres` rodando — o runner cai pra `docker exec` sozinho se não achar o `psql` local).

## Ordem de execução — runner com controle de versão

28 arquivos hoje, todos crus (`.sql`), aplicados em ordem numérica. Ninguém roda `psql -f` arquivo por
arquivo à mão: `apps/api/scripts/db-migrate.mjs` mantém uma tabela `schema_migrations` (filename +
checksum) e só aplica o que falta — idempotente, seguro pra rodar de novo, detecta se um arquivo já
aplicado foi editado depois (fecha [[Bugs|D-08]]).

```bash
export ADMIN_DATABASE_URL="postgres://postgres:postgres@localhost:5432/orvyn"
cd apps/api

pnpm db:migrate:status   # só mostra o que falta, não aplica nada
pnpm db:migrate          # aplica as migrations pendentes, em ordem, e registra cada uma
```

Banco que **já tem tudo** aplicado manualmente (ambiente antigo) e só precisa começar a usar o ledger:
```bash
node scripts/db-migrate.mjs --mark-applied   # registra as já aplicadas, sem rodar de novo
```

Teste de isolamento (bloqueante, roda à parte):
```bash
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002_isolation_test.sql  # BLOQUEANTE: falha o build se vazar
```

`002` deve terminar com `R0.2 OK — nenhum vazamento cross-tenant.` Qualquer vazamento faz `RAISE EXCEPTION` e o `psql` sai com código ≠ 0 (barra o merge no CI).

O runner de `002` precisa ser **superuser** ou membro de `khub_service` e `khub_app` (no Postgres do docker o usuário `postgres` já basta).

## Definir as senhas das roles (NUNCA no versionamento)

`000_foundation.sql` cria as roles **sem senha** de propósito. Defina fora do git (secret manager / `.env` não versionado):

```bash
psql "$DATABASE_URL" -c "ALTER ROLE khub_app     PASSWORD '<use um segredo>';"
psql "$DATABASE_URL" -c "ALTER ROLE khub_service PASSWORD '<use um segredo>';"
```

A aplicação (`apps/api`) conecta como **`khub_app`** (NOBYPASSRLS). Jobs de ingestão/publicação de bases global/nicho/sub conectam como **`khub_service`** (BYPASSRLS) e nunca são expostos ao request web.

## Arquivos
| Arquivo | Papel | Task |
|---|---|---|
| `000_foundation.sql` | `tenants` mínima (será estendida em F0-09) + roles `khub_app`/`khub_service` | pré-R0 |
| `001_rag_schema.sql` | Schema do RAG (fornecido, verbatim) — pgvector, tsvector pt, RLS, `rag_search_hybrid()` | R0.1 |
| `001a_rls_harden.sql` | FORCE RLS, RLS de `nyro_guardrail_hits`, grants das roles | R0.2 |
| `002_isolation_test.sql` | Teste de vazamento cross-tenant, self-cleaning (ROLLBACK), bloqueante no CI | R0.2 |

# db/ — Migrações do RAG (R0)

Camada de banco do módulo RAG da Nyro IA. **R0 = schema + RLS + teste de vazamento, sem nenhuma linha de IA.** É o gate inegociável: vazamento cross-tenant em base de saúde/jurídico é incidente de LGPD, não bug.

## Pré-requisitos (não instalados nesta máquina)
- PostgreSQL 15+ com **pgvector 0.7+** (extensão `vector`), `pg_trgm`, `unaccent`, `uuid-ossp`.
- `psql` no PATH.
- Recomendado em dev: subir via Docker Compose (Postgres+pgvector) — pendente do Bloco 2 de F0 (F0-08).

> ⚠️ Ambiente atual sem Node/pnpm/Docker/psql. Os arquivos abaixo estão **prontos e revisados estaticamente**, mas **ainda não foram executados** aqui. Rodar assim que a infra existir.

## Ordem de execução

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/orvyn"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/000_foundation.sql   # tenants mínima + roles orvyn_app/orvyn_service
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001_rag_schema.sql   # extensões, tabelas, RLS, HNSW, rag_search_hybrid()
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001a_rls_harden.sql  # FORCE RLS + RLS de guardrail_hits + grants
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/002_isolation_test.sql  # BLOQUEANTE: falha o build se vazar
```

`002` deve terminar com `R0.2 OK — nenhum vazamento cross-tenant.` Qualquer vazamento faz `RAISE EXCEPTION` e o `psql` sai com código ≠ 0 (barra o merge no CI).

O runner de `002` precisa ser **superuser** ou membro de `orvyn_service` e `orvyn_app` (no Postgres do docker o usuário `postgres` já basta).

## Definir as senhas das roles (NUNCA no versionamento)

`000_foundation.sql` cria as roles **sem senha** de propósito. Defina fora do git (secret manager / `.env` não versionado):

```bash
psql "$DATABASE_URL" -c "ALTER ROLE orvyn_app     PASSWORD '<use um segredo>';"
psql "$DATABASE_URL" -c "ALTER ROLE orvyn_service PASSWORD '<use um segredo>';"
```

A aplicação (`apps/api`) conecta como **`orvyn_app`** (NOBYPASSRLS). Jobs de ingestão/publicação de bases global/nicho/sub conectam como **`orvyn_service`** (BYPASSRLS) e nunca são expostos ao request web.

## Arquivos
| Arquivo | Papel | Task |
|---|---|---|
| `000_foundation.sql` | `tenants` mínima (será estendida em F0-09) + roles `orvyn_app`/`orvyn_service` | pré-R0 |
| `001_rag_schema.sql` | Schema do RAG (fornecido, verbatim) — pgvector, tsvector pt, RLS, `rag_search_hybrid()` | R0.1 |
| `001a_rls_harden.sql` | FORCE RLS, RLS de `nyro_guardrail_hits`, grants das roles | R0.2 |
| `002_isolation_test.sql` | Teste de vazamento cross-tenant, self-cleaning (ROLLBACK), bloqueante no CI | R0.2 |

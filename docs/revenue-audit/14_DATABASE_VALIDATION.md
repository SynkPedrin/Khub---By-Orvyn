# 14 — Validação do Banco de Dados

> Sprint 0. Banco novo e isolado `orvyn_qa` (PostgreSQL 16.14 + pgvector, container `orvyn-qa-pg`, volume exclusivo). Nenhum banco, volume ou migration existente foi alterado.

## 1. Pré-verificação das migrations (antes de aplicar)
Varredura por operações destrutivas em `db/000` a `db/027`:
- **Nenhum** `DROP TABLE`, `DROP COLUMN`, `DROP SCHEMA`, `DROP DATABASE`, `TRUNCATE` ou `DELETE FROM` fora do teste de isolamento (que faz `ROLLBACK`).
- Apenas padrão recriar-e-reaplicar: `DROP POLICY IF EXISTS`, `DROP TRIGGER IF EXISTS`, `DROP INDEX IF EXISTS`, `DROP CONSTRAINT IF EXISTS`, sempre seguidos do `CREATE` equivalente.
- Nenhum arquivo antigo foi editado para forçar sucesso.

## 2. Aplicação
| Item | Resultado |
|---|---|
| Ordem | `000 → 001 → 001a → (002 como teste) → 003 … 027`, `ON_ERROR_STOP=1`, um arquivo por vez |
| Resultado | **28/28 aplicadas sem erro** (`evidence/migrations-apply.log`) |
| Registro verificável | tabela `schema_migrations(filename, checksum sha256, applied_at)`, **28 linhas** (mesmo formato do runner `apps/api/scripts/apply-sql.mjs`) |
| Reaplicação completa (idempotência) | **0 de 28** arquivos falharam (`evidence/migrations-reapply.log`) |
| Extensões | `vector`, `pg_trgm`, `unaccent`, `uuid-ossp`, `plpgsql` |
| Roles | `orvyn_app` (LOGIN, **NOBYPASSRLS**, não-superuser), `orvyn_service` (**BYPASSRLS**) |

Observação: o repositório tem 3 mecanismos para aplicar migrations (psql manual, `apply-sql.mjs` só para arquivos com `==SPLIT==`, CI desativado). Não existe um comando único oficial que aplique tudo e registre. O registro de checksums acima foi criado nesta sprint **apenas no banco de QA**; adotá-lo no fluxo oficial é decisão pendente (ver 17).

## 3. Inventário
| Métrica | Valor |
|---|---|
| Tabelas (`public`, incl. 4 partições) | 59 |
| Tabelas-pai com `tenant_id` | 51 |
| Com RLS ligado | 47 |
| Com `FORCE ROW LEVEL SECURITY` | 47 |
| Policies | 50 |
| Funções `SECURITY DEFINER` | 5 |
| Chaves estrangeiras | 102 |
| `CHECK` / `UNIQUE` | 21 / 25 |
| Índices | 168 (4 HNSW/GIN) |

## 4. RLS e isolamento
### 4.1 Lacunas de RLS (catálogo do banco, fato)
Tabelas **com** `tenant_id` mas **sem** RLS: `memberships`, `invites`, `agency_client_accounts`, `refresh_tokens`.
Tabelas **sem** `tenant_id` e **sem** RLS: `tenants`, `identities`, `agencies`, `agency_members`, `agency_invites`, `agency_member_client_access` (+ `schema_migrations`).

A migration 026 documenta isso como decisão (tabelas "globais" sobre a relação entre tenants e identidades). Consequências verificadas:
- `orvyn_app` tem `SELECT/INSERT/UPDATE/DELETE` em `memberships`, `refresh_tokens`, `agencies`, `agency_client_accounts` e `SELECT/INSERT/UPDATE` em `tenants`. O isolamento dessas tabelas depende **só do código da aplicação**.
- Em runtime o código se comportou (14/15 verificações de isolamento entre agências e clientes passaram), **mas** o banco não protegeria um bug futuro de filtragem. É o `SEC-02` da auditoria estática, agora confirmado no catálogo.
- `SEC-01` (revogação de acesso) é consequência: não há `DELETE` de `memberships` em nenhum fluxo e nada impede o acesso depois da remoção do membro.

### 4.2 Teste de isolamento do repositório (`db/002_isolation_test.sql`)
**PASS** ("R0.2 OK — nenhum vazamento cross-tenant"). Cobre **apenas o RAG** (`rag_*`, `nyro_guardrail_hits`).

### 4.3 Matriz criada nesta sprint (`apps/api/scripts/qa/rls-matrix.sql`)
Roda **conectado como `orvyn_app`** (senha real, NOBYPASSRLS, não-superuser; a role foi confirmada por `pg_roles` antes). Self-cleaning (`ROLLBACK`). Três tenants (A1, A2, B1), uma linha semeada por tenant e por tabela, sempre sob o contexto do próprio tenant, como a aplicação faz.

13 tabelas × (controle positivo + SELECT, UPDATE e DELETE cruzados de A2→A1 e B1→A1 + SELECT sem contexto + linha intacta ao final) + 5 testes de `INSERT`/`UPDATE` que tentam gravar com `tenant_id` alheio:

`contacts`, `deals`, `pipelines`, `conversations`, `messages`, `workflows`, `crm_tags`, `agenda_compromissos`, `outbox_events`, `financeiro_cobrancas`, `tasks`, `notes`, `meta_pages`.

**Resultado: 122 PASS · 0 FAIL.** Os controles positivos garantem que o teste não é vazio (cada tenant enxerga a própria linha).
Registrado: `orvyn_app` **não tem `DELETE` em `outbox_events`** (bloqueio por GRANT, tratado como "bloqueado").

Cobertura que **não** existe nesta matriz (declarada, não escondida): `leads`/`opportunities` têm nomes próprios (`contacts`/`deals`), `conversations` está coberta; **memberships de agência, tabelas de agência e `meta_pages` por usuário de agência** só foram testados **pela API** (cenário 6), não por SQL, porque não têm RLS para testar. Também não cobertas: `ad_*`, `campaign*`, `nyro_*`, `workflow_*` (runs, steps, DLQ), `integrations`, `api_keys`, `audit_logs`, `webhook_events`, `ai_usage_events`.

## 5. Integridade e desempenho estrutural
| Verificação | Resultado |
|---|---|
| Integridade referencial | 102 FKs, todas aceitas na criação; testes de runtime não geraram violação |
| Constraints de domínio | `CHECK` de status (workflow, cobrança, agenda, outbox), de score e de janela de envio funcionam (inserções válidas passaram) |
| Idempotência de webhook | `UNIQUE (provider, event_id)` em `webhook_events` e `UNIQUE (tenant_id, dedupe_key)` em `outbox_events` impediram duplicidade em runtime |
| **FKs sem índice de apoio** | **48 de 102.** Entre elas `activities.contact_id`, `activities.deal_id`, `agencies.owner_identity_id`, `agency_client_accounts.tenant_id`, `agency_member_client_access.client_account_id`, `ad_*.integration_id`/`ad_account_id`. Em tabelas pequenas é inócuo; em escala gera varredura sequencial em `JOIN`/`ON DELETE CASCADE`. **P2 / `CODE_DEFECT` de desempenho latente** |
| Índice parcial único de instância Evolution | `uq_evolution_instance_conectada` presente (instância conectada pertence a 1 tenant) |
| Particionamento | 4 partições com RLS próprio (migration 014) |

## 6. Limites desta validação
- Banco com dados sintéticos mínimos: não há prova de comportamento de planos de execução, `EXPLAIN` com volume nem bloqueios sob concorrência.
- Não foram testados backup/restore, `pg_upgrade`, nem migrations contra um dump de produção.
- A matriz de RLS cobre 13 das 51 tabelas com `tenant_id`; as demais 38 são protegidas por política de mesmo padrão (`tenant_rw`), mas **sem prova individual**.
- Isolamento de `orvyn_service` (BYPASSRLS) não foi testado: ele existe para jobs de ingestão e não deve ser exposto a requisição web.

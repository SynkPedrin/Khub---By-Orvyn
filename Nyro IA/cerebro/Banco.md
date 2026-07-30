# Banco de Dados e Modelo Multi-tenant — Orvyn

> Schema, RLS, índices e migrações planejadas. Transcrição fiel do PRD §12 + decisões de implementação. Ver [[Arquitetura]] · [[PRD]].

---

## 1. Estratégia

**Banco único compartilhado com Row-Level Security (RLS) do Postgres** — toda tabela de negócio carrega `tenant_id` e as policies garantem isolamento no nível do banco, não apenas da aplicação. Tenants enterprise poderão migrar para schema dedicado no futuro.

Regras (de [[Arquitetura]] §5 / [[RegrasNegocio]]):
- Toda tabela de negócio: `tenant_id NOT NULL`.
- Toda transação: `SET LOCAL app.tenant_id`.
- App conecta com role **não-superusuário**, sujeito às policies (superuser e owner por padrão ignoram RLS — usar `FORCE ROW LEVEL SECURITY` na tabela).
- Todo PR que adiciona tabela: policy RLS + teste de isolamento.

---

## 2. Entidades principais (do PRD §12.1)

Transcrição literal da assinatura das entidades do PRD (a tipagem Prisma final será derivada destas):

```
tenants(id, nome, template_id, template_version, plano, status)
users(id, tenant_id, email, role, permissoes)
contacts(id, tenant_id, nome, telefones, emails, campos_custom jsonb, tags[])
companies(id, tenant_id, nome, cnpj, campos_custom jsonb)
pipelines(id, tenant_id, nome, tipo)
stages(id, pipeline_id, nome, ordem, sla)
deals(id, tenant_id, contact_id, pipeline_id, stage_id, valor, origem, owner_id)
conversations(id, tenant_id, contact_id, canal, status, assignee_id)
messages(id, conversation_id, direcao, autor_tipo[humano|nyro|contato], corpo, midia)
workflows(id, tenant_id, nome, versao, definicao jsonb, status)
workflow_runs(id, workflow_id, gatilho, contexto jsonb, status, iniciado_em)
workflow_run_steps(id, run_id, node_id, status, input, output, erro, tentativas)
integrations(id, tenant_id, provider, credenciais_cifradas, status, escopos)
nyro_memories(id, tenant_id, tipo, conteudo, embedding vector)
rag_documents(id, escopo[global|nicho|sub|tenant], nicho, sub, fonte, versao)
rag_chunks(id, document_id, conteudo, embedding vector, metadados jsonb)
invoices / subscriptions(...)
audit_logs(id, tenant_id, actor, acao, payload, ts)
```

### Observações do PRD §12.1
- Campos personalizados por template em **`jsonb` validado por schema** (rápido de evoluir, indexável com GIN).
- **Particionamento por tempo** em `messages`, `workflow_run_steps` e `audit_logs` (maior volume).
- **Backups contínuos (PITR)**, réplica de leitura para analytics.

> ⚠️ LACUNA: O PRD não define tipos exatos, PKs (uuid vs bigint), FKs com `ON DELETE`, enums, nem `created_at/updated_at`. Convenção adotada para o projeto (a validar no Bloco 2/3):
> - PK: `uuid` (`gen_random_uuid()`), pgcrypto/`gen_random_uuid`.
> - Timestamps: `created_at timestamptz default now()`, `updated_at timestamptz`.
> - `tenant_id uuid NOT NULL` referenciando `tenants(id)`.
> - Enums via Postgres enum ou colunas `text` + CHECK (decidir no ADR do schema).

---

## 2.1 Auth + Tenants (FASE 1 — `db/004_auth_tenants.sql`)
- `identities` (global, credenciais, **sem RLS**): email único (`lower`), `password_hash` (argon2id), `oauth_provider/subject`, `email_verified_at`, `twofa_secret?`.
- `memberships` (identidade↔tenant N:N, sem RLS), `refresh_tokens` (rotativos/revogáveis, sem RLS), `invites` (por token, sem RLS).
- `audit_logs` — **imutável** (RLS + `REVOKE UPDATE/DELETE` + trigger `audit_logs_immutable`) + `webhook_events` (RLS, dedupe `(provider,event_id)`).
- `tenants` +`nicho`,`subespecialidade`; `users` +`identity_id`,`permissoes`. Grants: `orvyn_app` INSERT em `tenants` (signup). Justificativa infra-sem-RLS: ADR-0006. Teste `002` estendido (audit_logs/webhook_events isolados). ✅

## 2.2 Integrações de anúncios (Sprint A — `db/005_integrations_schema.sql`)
7 tabelas, todas `tenant_id` + RLS + isolamento (`002`): `integrations` (credencial OAuth **cifrada** AES-256-GCM em `credentials_encrypted`), `ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_creatives`, `ad_insights` (**particionada por `date`** RANGE + partição default; unique `(tenant_id,provider,level,external_ref_id,date)`), `ad_sync_runs`. Grants `orvyn_app`/`orvyn_service`. Ver ADR-0007. ✅

## 2.3 Roteamento de webhook sem tenant (`db/008`, `db/009`)
Webhook público chega **sem tenant** e a app roda como `orvyn_app` (NOBYPASSRLS): um SELECT direto devolveria 0 linhas. Duas funções **SECURITY DEFINER** (owner `orvyn_service`) expõem **somente o `tenant_id` de roteamento** — nenhum dado de negócio atravessa, e logo depois a app entra em `withTenant()` e tudo volta para a RLS:
- `resolve_tenant_by_stevo_instance(text)` — via `integrations(provider='stevo', external_business_id=instância, status='connected')`, com unique index parcial garantindo instância→1 tenant.
- `resolve_tenant_by_meta_page(text)` — via `meta_pages(page_id UNIQUE)`, populada no OAuth (`listPages`).
Ambas cobertas pelo teste `002` (roteia certo **e** a linha do outro tenant continua invisível). Ver ADR-0008 e ADR-0010.

## 2.4 CRM F2 (Sprint D1 — `db/009_crm_f2.sql`)
Todas com `tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants `orvyn_app`/`orvyn_service`; isolamento no `002`. ✅
- `companies(id, tenant_id, nome, dominio, telefone, endereco, segmento, tamanho, site, campos_custom)` — unique `(tenant_id, lower(nome))`: não duplica conta dentro do tenant.
- `tasks(..., status aberta|concluida, prioridade baixa|media|alta, due_at, contact_id, deal_id, company_id, assignee_id, completed_at)` — CHECK em status/prioridade; índice parcial `(tenant_id, due_at) WHERE status='aberta'` (a fila do dia).
- `notes(..., corpo, contact_id, deal_id, company_id, author_id, author_nome)` — `author_nome` é **snapshot**: a nota continua legível se o autor sair do tenant.
- `meta_pages(page_id UNIQUE, tenant_id, integration_id)` — roteamento de Lead Ads (§2.3).
- `contacts` +`company_id` (SET NULL: excluir empresa não apaga pessoa) · `activities` +`contact_id`/`deal_id` (timeline do 360).
- **Paginação:** índice `(tenant_id, created_at DESC, id DESC)`. O cursor é resolvido pelo **Prisma no banco** — comparar timestamp serializado em JS perde os microssegundos do `timestamptz(6)` e derruba lotes inteiros ([[Bugs|BUG-009]]).

## 2.5 Configurações avançadas — Tags + Private Integrations ([[Arquitetura|ADR-0023]] · `db/018`, `db/019`)
Ambas com `tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants `orvyn_app`/`orvyn_service`; isolamento em `scripts/test-isolation-api-keys.mjs`. ✅
- `crm_tags(id, tenant_id, name, color, descricao, usos, created_at)` — catálogo canônico de tags (nome+cor); unique `(tenant_id, lower(name))`. Contatos referenciam por **nome** (`contacts.tags TEXT[]`), acoplamento frouxo.
- `api_keys(id, tenant_id, name, key_prefix, key_hash UNIQUE, scopes, created_by, last_used_at, revoked_at, created_at)` — chaves de API do tenant. Guardamos só `key_hash = sha256(chave)`; a chave em claro só existe na resposta da criação.
- **Auth cross-tenant controlada:** função `auth_lookup_api_key(hash)` `SECURITY DEFINER` (dona `orvyn_service`, BYPASSRLS) devolve **só** `(tenant_id, id)` da chave ativa e carimba `last_used_at`. É o único caminho que lê `api_keys` sem contexto de tenant — o CRUD passa pela `tenant_rw`. Revoke = `revoked_at` (soft).

## 2.6 Financeiro — cobranças ([[Arquitetura|ADR-0025]] · `db/020`)
`tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants; isolamento no `scripts/test-isolation-api-keys.mjs`. ✅
- `financeiro_cobrancas(id, tenant_id, contact_id→SET NULL, deal_id→SET NULL, descricao, valor_centavos CHECK>=0, moeda, status CHECK(rascunho|enviada|paga|vencida|cancelada), vencimento, pago_em, stripe_payment_intent, stripe_checkout_url, created_by, created_at, updated_at)`. Valores sempre em **centavos** (inteiro). Índices: `(tenant_id, created_at DESC)`, `(tenant_id, contact_id)`, parcial de vencidas. "vencida" é derivada em app (não persistida).

## 2.7 Agenda — compromissos ([[Arquitetura|ADR-0026]] · `db/021`)
`tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants; isolamento no `scripts/test-isolation-api-keys.mjs`. ✅
- `agenda_compromissos(id, tenant_id, contact_id→SET NULL, titulo, inicio, fim, status CHECK(agendado|confirmado|concluido|cancelado|nao_compareceu), local, notas, google_event_id, created_by, created_at, updated_at, CHECK(fim>inicio))`. Índices `(tenant_id, inicio)` e `(tenant_id, contact_id)`. Choque de horário barrado em app (409); horários livres calculados sem API externa.

## 3. Escopo de F0 — schema inicial

F0 entrega **apenas** (ver [[Sprint]] / [[Tasks]] F0-08):
- `tenants(id, nome, template_id, template_version, plano, status, created_at, updated_at)`
- `users(id, tenant_id, email, role, permissoes jsonb, password_hash?, oauth_provider?, created_at, updated_at)`
- `audit_logs(id, tenant_id, actor, acao, payload jsonb, ts)` — imutável (append-only)
- **Melhoria proposta #1 (a aprovar):** `ai_usage_events(id, tenant_id, ...)` desde F0 para medir uso de IA. **Não incluir sem aprovação** — ver [[PRD]] Anexo A.

Cada uma dessas tabelas (exceto `tenants`, cujo `tenant_id` é o próprio `id`) recebe policy RLS + teste de isolamento.

---

## 4. RLS — padrão de policy (a implementar no Bloco 3)

Padrão previsto para toda tabela de negócio com `tenant_id`:

```sql
-- 1. habilitar RLS e forçar mesmo para owner da tabela
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts FORCE ROW LEVEL SECURITY;

-- 2. policy de isolamento por tenant do contexto da transação
CREATE POLICY tenant_isolation ON contacts
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

Injeção de contexto por request (padrão a validar no ADR-0003):
```sql
SET LOCAL app.tenant_id = '<uuid-do-tenant>';
```

`audit_logs` é **append-only**: além da policy de isolamento, negar `UPDATE`/`DELETE` para o role da aplicação (imutabilidade). Detalhar no Bloco 3.

> ⚠️ LACUNA: O PRD exige RLS mas não especifica o mecanismo exato Prisma↔`SET LOCAL`. Ver ADR-0003 em [[Arquitetura]]. Critério de aceite fechado: teste automatizado onde o tenant A consulta dados do tenant B e recebe 0 linhas ([[Tasks]] F0-12).

---

## 5. Índices e performance (planejado)
- Índice em `tenant_id` em toda tabela de negócio (líder de índices compostos com colunas de filtro frequente).
- GIN em colunas `campos_custom jsonb` e `tags[]`.
- pgvector: índice ANN (HNSW ou IVFFlat — decidir com base na versão do pgvector) em `nyro_memories.embedding`, `rag_chunks.embedding`, **sempre filtrado por `tenant_id`/escopo**.
- Particionamento por tempo (RANGE em `ts`/`created_at`) para `messages`, `workflow_run_steps`, `audit_logs`.

> ⚠️ LACUNA: dimensão do vetor de embedding e tipo de índice ANN dependem do modelo de embeddings (não definido no PRD — ver [[PRD]] §6). Decidir em F3.

---

## 6. Migrações
- Prisma Migrate. Nenhuma migração destrutiva sem plano de rollback (regra de [[RegrasNegocio]]).
- Policies RLS não são geridas nativamente pelo Prisma schema → aplicar via SQL em migração dedicada (raw SQL na migration), versionada junto ao PR que cria a tabela.

---

## 7. Backup e retenção
- PITR (backup contínuo). Réplica de leitura para analytics.
- Retenção configurável de conversas/gravações; anonimização após encerramento de conta ([[PRD]] §14 / [[RegrasNegocio]]).

> ⚠️ LACUNA: janelas de retenção específicas (dias), política de storage de mídia do WhatsApp e custo — não definidos no PRD (melhoria proposta #5). Registrar quando abordado.

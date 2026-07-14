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

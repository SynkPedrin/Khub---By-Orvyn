# Banco de Dados e Modelo Multi-tenant — KHUB

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
- `memberships` (identidade↔tenant N:N, sem RLS), `refresh_tokens` (rotativos/revogáveis, sem RLS), `invites` (por token, sem RLS; `permissoes jsonb` desde db/065: módulos escolhidos no convite, ADR-0045). `users.permissoes` guarda `{modulos: [...]}` do colaborador (ausente = sem restrição).
- `audit_logs` — **imutável** (RLS + `REVOKE UPDATE/DELETE` + trigger `audit_logs_immutable`) + `webhook_events` (RLS, dedupe `(provider,event_id)`).
- `tenants` +`nicho`,`subespecialidade`; `users` +`identity_id`,`permissoes`. Grants: `khub_app` INSERT em `tenants` (signup). Justificativa infra-sem-RLS: ADR-0006. Teste `002` estendido (audit_logs/webhook_events isolados). ✅

## 2.2 Integrações de anúncios (Sprint A — `db/005_integrations_schema.sql`)
7 tabelas, todas `tenant_id` + RLS + isolamento (`002`): `integrations` (credencial OAuth **cifrada** AES-256-GCM em `credentials_encrypted`), `ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_creatives`, `ad_insights` (**particionada por `date`** RANGE + partição default; unique `(tenant_id,provider,level,external_ref_id,date)`), `ad_sync_runs`. Grants `khub_app`/`khub_service`. Ver ADR-0007. ✅

## 2.3 Roteamento de webhook sem tenant (`db/008`, `db/009`)
Webhook público chega **sem tenant** e a app roda como `khub_app` (NOBYPASSRLS): um SELECT direto devolveria 0 linhas. Duas funções **SECURITY DEFINER** (owner `khub_service`) expõem **somente o `tenant_id` de roteamento** — nenhum dado de negócio atravessa, e logo depois a app entra em `withTenant()` e tudo volta para a RLS:
- `integrations(provider='genna')` (ADR-0053): credencial do Genna por subconta (access/refresh token, validade, escopos, `client_id` do cadastro dinâmico) cifrada em `credentials_encrypted`; sem tabela nova.
- `resolve_tenant_by_stevo_instance(text)` — via `integrations(provider='stevo', external_business_id=instância, status='connected')`, com unique index parcial garantindo instância→1 tenant.
- `resolve_tenant_by_meta_page(text)` — via `meta_pages(page_id UNIQUE)`, populada no OAuth (`listPages`).
Ambas cobertas pelo teste `002` (roteia certo **e** a linha do outro tenant continua invisível). Ver ADR-0008 e ADR-0010.

## 2.4 CRM F2 (Sprint D1 — `db/009_crm_f2.sql`)
Todas com `tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants `khub_app`/`khub_service`; isolamento no `002`. ✅
- `companies(id, tenant_id, nome, dominio, telefone, endereco, segmento, tamanho, site, campos_custom)` — unique `(tenant_id, lower(nome))`: não duplica conta dentro do tenant.
- `tasks(..., status aberta|concluida, prioridade baixa|media|alta, due_at, contact_id, deal_id, company_id, assignee_id, completed_at)` — CHECK em status/prioridade; índice parcial `(tenant_id, due_at) WHERE status='aberta'` (a fila do dia).
- `notes(..., corpo, contact_id, deal_id, company_id, author_id, author_nome)` — `author_nome` é **snapshot**: a nota continua legível se o autor sair do tenant.
- `meta_pages(page_id UNIQUE, tenant_id, integration_id)` — roteamento de Lead Ads (§2.3).
- `contacts` +`company_id` (SET NULL: excluir empresa não apaga pessoa) · `activities` +`contact_id`/`deal_id` (timeline do 360).
- **Paginação:** índice `(tenant_id, created_at DESC, id DESC)`. O cursor é resolvido pelo **Prisma no banco** — comparar timestamp serializado em JS perde os microssegundos do `timestamptz(6)` e derruba lotes inteiros ([[Bugs|BUG-009]]).

## 2.5 Configurações avançadas — Tags + Private Integrations ([[Arquitetura|ADR-0023]] · `db/018`, `db/019`)
Ambas com `tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants `khub_app`/`khub_service`; isolamento em `scripts/test-isolation-api-keys.mjs`. ✅
- `crm_tags(id, tenant_id, name, color, descricao, usos, created_at)` — catálogo canônico de tags (nome+cor); unique `(tenant_id, lower(name))`. Contatos referenciam por **nome** (`contacts.tags TEXT[]`), acoplamento frouxo.
- `api_keys(id, tenant_id, name, key_prefix, key_hash UNIQUE, scopes, created_by, last_used_at, revoked_at, created_at)` — chaves de API do tenant. Guardamos só `key_hash = sha256(chave)`; a chave em claro só existe na resposta da criação.
- **Auth cross-tenant controlada:** função `auth_lookup_api_key(hash)` `SECURITY DEFINER` (dona `khub_service`, BYPASSRLS) devolve **só** `(tenant_id, id)` da chave ativa e carimba `last_used_at`. É o único caminho que lê `api_keys` sem contexto de tenant — o CRUD passa pela `tenant_rw`. Revoke = `revoked_at` (soft).

## 2.6 Financeiro — cobranças ([[Arquitetura|ADR-0025]] · `db/020`)
`tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants; isolamento no `scripts/test-isolation-api-keys.mjs`. ✅
- `financeiro_cobrancas(id, tenant_id, contact_id→SET NULL, deal_id→SET NULL, descricao, valor_centavos CHECK>=0, moeda, status CHECK(rascunho|enviada|paga|vencida|cancelada), vencimento, pago_em, stripe_payment_intent, stripe_checkout_url, created_by, created_at, updated_at)`. Valores sempre em **centavos** (inteiro). Índices: `(tenant_id, created_at DESC)`, `(tenant_id, contact_id)`, parcial de vencidas. "vencida" é derivada em app (não persistida).

## 2.6.1 Financeiro: gestão do caixa e comissões (FIN-GESTAO · `db/070`)
- `financeiro_categorias(id, tenant_id, nome 1..60, tipo entrada|saida, cor)`; único `(tenant_id, lower(nome), tipo)`. Kit padrão criado no 1º acesso (Serviços, Produtos, Aluguel, Comissões...).
- `financeiro_transacoes(id, tenant_id, tipo, categoria_id→SET NULL, descricao, valor_centavos INTEGER >0, data_competencia DATE, status pago|pendente, contact_id, cobranca_id, compromisso_id, responsavel_id→identities, origem manual|agenda|cobranca|importacao|comissao, chave_importacao, observacao, created_by)`. Únicos: `cobranca_id`, `compromisso_id` (uma entrada por cobrança paga / atendimento concluído) e `(tenant_id, chave_importacao)` (reimportar não duplica).
- `equipe_comissoes(tenant_id, identity_id, cargo, comissao_percent NUMERIC(5,2) 0..100)`: extensão do membership (FK composta para `memberships(identity_id, tenant_id)` ON DELETE CASCADE).
- `financeiro_comissoes(id, tenant_id, identity_id, transacao_id→CASCADE, base_centavos, percent, valor_centavos <= base, competencia = dia 1, status prevista|paga, pago_em, pagamento_transacao_id→SET NULL)`. Únicos: `transacao_id` (uma comissão por entrada) e `pagamento_transacao_id`. Arredondamento: meio para cima no centavo, aritmética inteira em pontos-base (`calcularComissaoCentavos`).
- `agenda_compromissos.valor_centavos` (nullable): concluído com valor vira entrada (origem agenda) + comissão do responsável; sair de concluído estorna; comissão já paga trava (409).
- Isolamento: RLS FORCE + `tenant_rw` nas 4 tabelas; `tenant_reference` (categoria, contato, cobrança, compromisso, transação) e `khub_fin_check_membro` (responsável/comissionado é membro). Teste: `db/070_financeiro_gestao_isolation_test.sql`. **Aplicada só no QA (orvyn_qa) em 2026-11-13**; dev e Neon pendentes.

## 2.7 Agenda — compromissos ([[Arquitetura|ADR-0026]] · `db/021`)
`tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw` + grants; isolamento no `scripts/test-isolation-api-keys.mjs`. ✅
- `agenda_compromissos(id, tenant_id, contact_id→SET NULL, titulo, inicio, fim, status CHECK(agendado|confirmado|concluido|cancelado|nao_compareceu), local, notas, google_event_id, created_by, created_at, updated_at, CHECK(fim>inicio))`. Índices `(tenant_id, inicio)` e `(tenant_id, contact_id)`. Choque de horário barrado em app (409); horários livres calculados sem API externa.

## 2.9 Agent Intelligence ([[Arquitetura|ADR-0038]] · `db/034_agent_intelligence.sql`)
Tabelas (todas `tenant_id NOT NULL`, RLS FORCE `tenant_rw`, gatilho `tenant_reference`): `agent_versions`, `agent_intent_categories`, `agent_knowledge_sources`, `agent_customer_profiles`, `agent_profile_facts`, `agent_extractions`, `agent_memories`, `agent_delivery_queue`, `agent_followup_rules`, `agent_followups`, `agent_tool_executions`, `agent_learning_events`, `agent_improvement_proposals`, `agent_eval_scenarios`, `agent_evaluations`, `agent_simulations`. Colunas novas: `agents.config` (JSONB), `agents.versao_publicada_id`, `agent_runs.{version_id,intencao,sentimento,urgencia,confianca,trace,blocos}`, `rag_documents.texto_fonte`. Funções: `agent_rag_search_hybrid/lexical` (filtro por documentos dentro do WHERE), `agent_tsquery_or`. Anti-duplicidade no banco: um follow-up agendado por contato e agente; uma linha por bloco de entrega (`idempotency_key`). Rollback no cabeçalho da migração. Teste: `db/034_agent_intelligence_isolation_test.sql`.

## 2.10 Conector MCP ([[Arquitetura|ADR-0049]] · `db/072_mcp_conector.sql`)
- `mcp_clientes` (sem tenant: registro da plataforma, só nome do app, redirect_uris e hash do segredo). GRANT só SELECT/INSERT para a app.
- `mcp_conexoes` (tenant_id, identity_id que autorizou, cliente, revogada_em) e `mcp_tokens` (tipo codigo/acesso/renovacao, hash sha256, code_challenge, expira_em, usado_em) com RLS `tenant_rw` + gatilho que exige token e conexão do mesmo tenant.
- `mcp_resolver_token(hash, tipo)` SECURITY DEFINER (dona `khub_service`): consome código/renovação de forma atômica, lê acesso; nunca devolve conexão revogada ou token vencido. `mcp_limpar_tokens()` apaga vencidos há +1 dia.
- Isolamento: `db/072_mcp_conector_isolation_test.sql`.

## 2.11 Daily da agência ([[Arquitetura|ADR-0050]] · `db/074_agency_daily.sql`)
- Escopo `agency_id` (FK `agencies` ON DELETE CASCADE), **sem tenant_id/RLS** como `db/026`: o isolamento é do `AgencyDailyService` (agência resolvida pela identidade; subcontas visíveis do membro).
- `agency_tasks(id, agency_id, numero identity, titulo, descricao, client_account_id→agency_client_accounts SET NULL, responsavel_id/criador_id→agency_members SET NULL, parent_id→self CASCADE, tipo CHECK, status CHECK, prioridade CHECK, inicio_em, prazo_em, posicao, concluida_em, arquivada_em, plataformas text[], objetivo, legenda, hashtags, cta, exige_legenda, publicar_em, aprovacao CHECK, publicado_em, created_at, updated_at)`; índices parciais por status/responsável/prazo/publicação (`arquivada_em IS NULL`).
- `agency_task_checklist(task_id CASCADE, texto, feito, posicao)`, `agency_task_comentarios(task_id CASCADE, autor_id SET NULL, corpo)`.
- `agency_events(agency_id, titulo, inicio_em, fim_em CHECK ≥ inicio, dia_inteiro, local, notas, client_account_id SET NULL, criador_id SET NULL)` + `agency_event_participantes(event_id, member_id)`.
- Rollback no cabeçalho da migração (DROP das 5 tabelas). Aditiva.

## 2.12 Caixa (PDV) ([[Arquitetura|ADR-0051]] · `db/075_caixa_pdv.sql`)
- `financeiro_transacoes`: + `forma_pagamento`, `parcelas` (CHECK só crédito), `produto_id`→produtos, `quantidade`, status `cancelada` (+ `cancelada_em`, `cancelada_por`, `motivo_cancelamento`).
- `estoque_movimentos`: + origem `venda`, `transacao_id`→financeiro_transacoes (baixa/reposição ligada à venda).
- `financeiro_config(tenant_id PK, senha_hash scrypt, updated_by, updated_at)` com RLS `tenant_rw`.

## 2.13 Agenda do Avec ([[Arquitetura|ADR-0052]] · `db/077_agenda_avec_sync.sql`)
- `agenda_compromissos`: + `origem` (`NULL` = nasceu no KHUB | `'avec'`), `externo_id` (chave da reserva no Avec, CHECK anda junto com origem), `sincronizado_em`. Índice único parcial `(tenant_id, origem, externo_id) WHERE externo_id IS NOT NULL`.
- `agenda_jornadas(tenant_id, profissional_id, data)` PK, `ini_min`/`fim_min` (minutos no fuso; ambos NULL = folga), `origem`, `atualizado_em`. RLS `tenant_rw`, `tenant_reference` para profissional. Teste `db/077_agenda_avec_sync_isolation_test.sql`.
- Rollback no cabeçalho da migração. Aditiva.

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

## 8. Onboarding KROMA (db/078, ADR-0054)
Tabelas **agency-scoped** (sem `tenant_id`/RLS — isolamento no service, padrão db/026/074): `agency_onboardings` (status coleta→imersao→implantacao→homologacao→pronto|bloqueado; escopo jsonb; `completion_locked`; índice único parcial = 1 não-finalizado por subconta) · `agency_onboarding_knowledge` (+`_hist`, 7 seções, nunca presumir) · `agency_onboarding_meetings` (imersão: pauta/decisões/pendências) · `agency_onboarding_reports` (Genna/manual; `bruto` = dado não-confiável) · `agency_onboarding_agents` (spec + 11 cenários de teste; `agent_id` referencia agente do tenant, sem FK) · `agency_onboarding_tasks` (vínculo com `agency_tasks` + critério de aceite + evidências) · `agency_onboarding_verifications` (critérios de homologação, `escopo_key` condiciona ao contrato) · `agency_onboarding_approvals` (ações sensíveis) · `agency_onboarding_events` (histórico).

## 9. Trava de tenant só no que mudou (db/081, ADR-0056)
`khub_check_tenant_reference()` (db/022, renomeada em db/035) agora, num UPDATE sem troca de `tenant_id`, pula a referência que não mudou. Motivo: a cascata `ON DELETE SET NULL` reconferia as outras colunas da linha (ex.: `agent_profile_facts.message_id`) apontando para linhas apagadas no mesmo comando → 23503, e excluir conversa com histórico da IA falhava. Referência nova ou alterada, e qualquer troca de tenant, continuam conferidas. Validado em dev (BEGIN/ROLLBACK): 3 conversas com IA, 62 mensagens, fatos anulados; cross-tenant segue barrado. Rollback: reaplicar o corpo de db/022 com o nome `khub_`.

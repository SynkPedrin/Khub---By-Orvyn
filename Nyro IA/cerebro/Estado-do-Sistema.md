# Estado do Sistema — KHUB OS (handoff atualizado)

> Fotografia técnica **do que existe hoje**: o que funciona de verdade (verificado), o que é parcial/fachada, e o que falta. Foco em **Auth · CRM · IA/Nyro (RAG)**. Legenda:
> ✅ **funciona** (real, verificado) · 🟡 **parcial / fachada / não ligado** · ⛔ **não existe ainda**.
> Marca: **KHUB OS** (identificadores internos seguem `khub`). Ver [[PRD]] · [[Arquitetura]] · [[Banco]] · [[APIs]] · [[Tasks]] · [[Bugs]].

---

## 0. Resumo executivo — o que roda hoje

**Stack no ar:** Postgres 16 + pgvector + Redis (Docker) · API NestJS `:3333` · Web Next `:3210`.

**✅ Funciona de verdade (verificado end-to-end):**
- **Auth real multi-tenant** — signup/login/refresh/logout, JWT + refresh rotativo, sessão em cookies httpOnly, **isolamento por tenant provado** (tenant A não vê dados de B).
- **CRM Core sobre Postgres com RLS** — Dashboard (KPIs/funil reais), Pipeline Kanban (**drag persiste no banco**), Contatos (listar/buscar/**criar persiste**), Inbox (lê conversas/mensagens reais), overview/atividades.
- **RAG (motor de conhecimento)** — schema + RLS + teste de isolamento (R0.2 fechado); **inteligência de marketing/operação da Nyro ingerida** (12 docs / 73 chunks, escopo global) e **buscável por BM25**.
- **Base de conhecimento** navegável (`/conhecimento`) e **Central de Marketing** (`/marketing`).

**🟡 Existe mas não opera:** o **chat da Nyro** (sem LLM ligado), envio no inbox, busca global do CRM, OAuth Google/GitHub (plugável), notificações/perfil/config, criar-editar negócio pela UI, perfil 360 do contato.

**⛔ Não existe:** `automations`, `integrations` (Meta/Google/WhatsApp/Stripe), `billing`, `analytics`, templates verticais/provisionamento por blueprint.

---

## 1. Como rodar

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"
cd "/Users/pedro/Downloads/Nyro IA"

docker compose up -d                       # Postgres+pgvector + Redis
# migrations (1ª vez / quando mudar schema), NA ORDEM:
for f in 000_foundation 001_rag_schema 001a_rls_harden 003_crm_schema 004_auth_tenants; do
  docker exec -i orvyn-postgres psql -U postgres -d orvyn -v ON_ERROR_STOP=1 < db/$f.sql; done
docker exec -i orvyn-postgres psql -U postgres -d orvyn -v ON_ERROR_STOP=1 < db/002_isolation_test.sql  # teste (rollback)

pnpm --filter @khub/api run build && (cd apps/api && node dist/main.js)   # API :3333 (usa apps/api/.env)
pnpm --filter @khub/web run dev            # Web :3210
```
⚠️ **Nunca rode `next build` com o `next dev` ligado** (corrompe `.next/` → BUG-005). Para produção: `next start`.

**Acesso admin (dados reais no CRM):** `admin@orvyn.app` / `OrvynAdmin2026` (role owner do tenant "Sua Empresa"). Ou crie sua conta em `/signup`.

---

## 2. Auth & Multi-tenant ✅ (FASE 1)

Arquitetura (ADR-0006): **identidade global × tenant**.
- `identities` (login global, argon2id) · `memberships` (identidade↔tenant N:N) · `refresh_tokens` (rotativos/revogáveis) · `users` (perfil por tenant).
- **JWT de acesso 15 min** `{sub, tenant_id, role}` + **refresh rotativo**. Guard global; **tenant vem do JWT** (nunca de header do browser). Front mantém sessão em **cookies httpOnly** via `/api/auth/*`.
- **Verificado:** 401 sem token · A vê só o seu (isolamento) · rotação de refresh · logout revoga.
- 🟡 falta: OAuth Google/GitHub (plugável, `501` até configurar), convites de equipe, 2FA, endurecer RLS em `tenants`.

---

## 3. CRM Core ✅/🟡 (F1 em andamento)

| Área | Status | Hoje |
|---|---|---|
| Dashboard | ✅ | KPIs (contatos, negócios, valor do funil, ganho), funil por etapa, atividades, contatos recentes — **do banco** |
| Pipeline (Kanban) | ✅ | etapas + negócios reais; **drag persiste** (`PATCH /v1/crm/deals/:id/stage`) |
| Contatos | 🟡 | listar/buscar/**criar** (persiste). ⛔ editar/excluir, **perfil 360**, empresas, campos custom, dedupe |
| Negócios | 🟡 | criar/mover via API; ⛔ **modal "Novo negócio"** e **card→detalhe** na UI (BUG-006) |
| Inbox | 🟡 | lê conversas/mensagens reais; ⛔ **enviar** (BUG-003), atribuição, sugestão dinâmica |
| Audit | 🟡 | tabela `audit_logs` imutável existe + alguns inserts (provision); ⛔ `AuditInterceptor` em toda mutação |
| Busca global (Cmd+K) | 🟡 | só navega + conhecimento; ⛔ **não pesquisa contatos/negócios** (BUG-004) |

---

## 4. IA / Nyro — o que existe (foco)

A **Nyro** foi projetada para 4 papéis (PRD §5): **Arquiteta · Operadora (SDR) · Estrategista de Growth · Consultora do Nicho**. Estado hoje:

### 4.1 Motor de conhecimento (RAG) — parcialmente ligado
| Componente | Status | Nota |
|---|---|---|
| Schema + RLS + isolamento (R0) | ✅ | `rag_documents/chunks/queries/feedback` + `nyro_guardrail_hits`; pgvector(1024) + HNSW + tsvector pt. **R0.2 fechado** (zero vazamento) |
| `ChunkingService` (R1.1) | ✅ | não corta tabela/código; testado |
| `EmbeddingsService` + provider Voyage (R1.2) | 🟡 | lógica testada; **exige `VOYAGE_API_KEY`** para gerar vetores |
| `RetrievalService` híbrido (R1.4) | ✅ | RRF + boost + `withTenant`; testado |
| `IngestionService`/processor (R1.3) | 🟡 | idempotente; fila **in-process** (BullMQ = escala, não ligado) |
| Reranker (R2.2) | 🟡 | só `IdentityReranker` (baseline) — cross-encoder ⛔ |
| Contextualizer (R2.1) | ⛔ | Haiku + prompt caching — não existe |
| Guardrails CFM/OAB (R2.4) | ⛔ | validador pós-resposta — não existe |
| Tool `search_knowledge` (R1.5) | ✅ | tenant só da sessão; testado |
| **Unit tests do RAG** | ✅ | **24 verdes** (jest) |

**Inteligência de marketing/operação da Nyro (camada global):** ✅ **ingerida e buscável**.
- 12 frameworks C-Level (6 marketing: STP, Funil de Demanda, Go-to-Market, Arquitetura de Marca, Atribuição, Pirâmide de Conteúdo; 6 operação: OKR, Dashboards, Design Org., Mapeamento de Processos, Matriz de Alocação, Prontidão para Escalar) → **73 chunks, escopo global**, com `metadados` (dominio/framework/plano/intenções).
- Seed: `apps/api/scripts/seed-global-rag.mjs` (como `khub_service`, fora do request path). **Buscável por BM25 agora** (ex.: "posicionar"→STP, "lançar serviço"→GTM); **busca semântica** entra com a chave Voyage (backfill de embeddings).
- Superfície no produto: **`/marketing`** (Central de Marketing) lista os frameworks; `/conhecimento` abre cada um. Ver [[RAG/conhecimento/global/_INDICE|_INDICE]].

### 4.2 Nyro como agente/operadora — ⛔ ainda não opera
- ⛔ `POST /v1/nyro/chat` (SSE), orquestrador multi-agente, memória em 3 níveis, tools de escrita (`create_pipeline`, `send_message`…), human-in-the-loop (`nyro_pending_actions` + approve).
- 🟡 UI da Nyro é **fachada**: página `/nyro` diz "Chega na F3"; dock flutuante tem sugestões estáticas (não conversa); "Insights da Nyro" no dashboard são textos fixos; sugestão no inbox é estática.
- ⛔ `ai_usage_events` (créditos/custo de IA).
- **Resumo:** a Nyro **já tem conhecimento** (RAG global + corpus de nicho anterior), mas **ainda não conversa nem age** — isso é a **FASE 5 (Nyro chat + tools)**, que precisa de `ANTHROPIC_API_KEY` (chat/contextualizer/guardrails) e `VOYAGE_API_KEY` (embeddings).

---

## 5. Back-end (apps/api) — módulos

| Módulo | Status | O que faz |
|---|---|---|
| `health` | ✅ | `/v1/health` (checa banco) |
| `auth` | ✅ | signup/login/refresh/logout/me + oauth/callback (501) |
| `tenants` | ✅ | provisionamento (tenant+owner+funil) + `/v1/tenants/me` |
| `crm` | ✅ | overview, contatos, pipeline, deals, conversas — via RLS |
| `rag` | 🟡 | ingestão/busca/feedback; precisa chaves p/ operar de ponta a ponta |
| `prisma`/`common`/`config` | ✅ | `withTenant`, filtro RFC 7807 + correlation-id, env zod (fatal se faltar `JWT_SECRET`) |
| `nyro`(chat) · `inbox`(envio) · `automations` · `integrations` · `billing` · `analytics` | ⛔ | não existem |

---

## 6. Banco — 20 tabelas

- **Tenant/negócio (RLS):** `tenants`* , `users`, `contacts`, `deals`, `pipelines`, `stages`, `conversations`, `messages`, `activities`, `audit_logs` (imutável), `webhook_events`, `rag_documents/chunks/queries/feedback`, `nyro_guardrail_hits`. (*`tenants` sem RLS ainda — endurecer)
- **Infra de auth (sem RLS, ADR-0006):** `identities`, `memberships`, `refresh_tokens`, `invites`.
- Migrations: `000_foundation · 001_rag_schema · 001a_rls_harden · 003_crm_schema · 004_auth_tenants` (+ `002_isolation_test`).
- ⛔ faltam: `companies`, `tasks`, `notes`, `custom_fields`, `tags`, `workflows/runs/steps`, `integrations`, `invoices/subscriptions`, `ai_usage_events`, `nyro_pending_actions`.

---

## 7. APIs

### Existentes ✅ (NestJS `/v1`; CRM/RAG exigem **JWT**, tenant do token)
`GET /health` · `POST /auth/{signup,login,refresh,logout}` · `GET /auth/me` · `POST /auth/oauth/callback` (501) · `GET /tenants/me` · `GET /crm/overview` · `GET|POST /crm/contacts` · `GET /crm/pipeline` · `POST /crm/deals` · `PATCH /crm/deals/:id/stage` · `GET /crm/conversations` · `POST /rag/{documents,search,feedback}`.
**Next (front):** `/api/auth/{login,signup,refresh,logout,me}` (cookies httpOnly) · `/api/crm/[...]` (proxy Bearer) · `/api/cerebro[/...]`.

### Faltantes ⛔ (para completar)
- **CRM:** `GET /crm/contacts/:id` (360) · `PATCH|DELETE /crm/contacts/:id` · `companies` CRUD · `PATCH|DELETE /crm/deals/:id` · `GET /crm/search?q=` (BUG-004) · `tasks`/`notes` · paginação cursor.
- **Inbox/WhatsApp:** `POST /messages` · `POST /webhooks/whatsapp` (Evolution, idempotente) · WebSocket.
- **Nyro:** `POST /nyro/chat` (SSE) · `POST /nyro/actions/:id/approve|reject`.
- **Integrações/Billing:** Meta/Google/Stripe + `POST /webhooks/stripe` · `GET /analytics/kpis`.
- **Auth:** OAuth real (Google/GitHub) · convites.

---

## 8. Não funciona / é fachada (bugs registrados)
- **BUG-003** — Inbox: botão enviar **sob o FAB da Nyro** (z-index) + envio não implementado; sugestão estática.
- **BUG-004** — Cmd+K não pesquisa contatos/negócios ("Marina" → nada).
- **BUG-005** — crash `./352.js`: causado por `next build` com `dev` ligado (não é a digitação). Mitigado.
- **BUG-006** — controles sem ação: "Novo negócio", card do deal, linha de contato, "Usar"/telefone/"..." no inbox, sino, perfil/config, Insights "Ativar/Priorizar". São FASE 2/3/5, não regressões.

---

## 9. Config manual (chaves) — o que destrava o quê
| Variável | Onde | Destrava |
|---|---|---|
| `VOYAGE_API_KEY` | `apps/api/.env` | embeddings → **busca semântica** do RAG + backfill dos 73 chunks |
| `ANTHROPIC_API_KEY` | `apps/api/.env` | **chat da Nyro** + contextualizer + guardrails (FASE 5) |
| `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET`, `AUTH_SECRET` | api/web | **OAuth real** Google/GitHub |
| Evolution/Meta/Google/Stripe | integrações | Inbox real, Ads, cobrança (F5) |
| Trocar `JWT_SECRET` + senhas das roles | prod | segurança fora de dev |

---

## 10. Ordem sugerida do que falta
1. **FASE 2 — CRM completo + Audit:** `companies/tasks/notes/custom_fields`, editar/excluir, **modal criar/editar negócio**, **perfil 360**, paginação, `AuditInterceptor`, **busca CRM** (mata BUG-004/006).
2. **FASE 3 — Inbox real + WhatsApp:** envio (`POST /messages`) + Evolution + WebSocket + fix z-index (BUG-003).
3. **FASE 4 — Ligar o RAG (R1→R2):** `VOYAGE_API_KEY` → backfill de embeddings; BullMQ; reranker cross-encoder; contextualizer; guardrails CFM/OAB.
4. **FASE 5 — Nyro chat + tools:** `POST /nyro/chat` (SSE) usando o RAG (incl. inteligência de marketing) + tools de escrita + human-in-the-loop + `ai_usage_events`. **Aqui a Nyro passa a conversar e agir.**
5. **FASE 6/7/8 — Integrações+Billing · Automações · CI/CD + hardening.**

> Invariantes ao construir: toda tabela de negócio com `tenant_id` + RLS + teste de isolamento; **Nyro só age por tools tipadas com audit log**; guardrails de nicho em 2 camadas; segredo nunca no código. Ver [[RegrasNegocio]].

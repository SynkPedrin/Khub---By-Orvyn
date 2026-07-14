# Estado do Sistema — Orvyn (handoff para "montar o que falta")

> Fotografia técnica **do que existe hoje**, o que funciona de verdade, o que é placeholder, e **todas as APIs** (existentes + as que faltam). Legenda de status:
> ✅ **funciona** (real, verificado) · 🟡 **parcial / demo / placeholder** · ⛔ **não existe ainda**.
> Atualizado nesta sessão. Fonte da verdade: este cérebro. Ver [[PRD]] · [[Arquitetura]] · [[Banco]] · [[APIs]] · [[Tasks]].

---

## 0. Como rodar (ambiente local)

Node vem do nvm; Docker do Docker Desktop. Nesta máquina os binários **não estão no PATH padrão**:

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:/Applications/Docker.app/Contents/Resources/bin:$PATH"

# 1) Infra (Postgres+pgvector + Redis)
cd "/Users/pedro/Downloads/Nyro IA"
docker compose up -d

# 2) Migrations (ordem importa) — só na 1ª vez / quando mudar schema
for f in 000_foundation 001_rag_schema 001a_rls_harden 003_crm_schema; do
  docker exec -i orvyn-postgres psql -U postgres -d orvyn -v ON_ERROR_STOP=1 < db/$f.sql
done
# teste de isolamento (não deixa resíduo):
docker exec -i orvyn-postgres psql -U postgres -d orvyn -v ON_ERROR_STOP=1 < db/002_isolation_test.sql

# 3) API (NestJS) — conecta como orvyn_app (RLS)
pnpm --filter @orvyn/api run build
DATABASE_URL="postgresql://orvyn_app:orvyn@localhost:5432/orvyn?schema=public" PORT=3333 node apps/api/dist/main.js

# 4) Front (Next) — em outro terminal
pnpm --filter @orvyn/web run dev   # http://localhost:3210
```

Portas: **web 3210 · API 3333 · Postgres 5432 · Redis 6379**. Senha das roles (`orvyn_app`/`orvyn_service`): `orvyn` (definida via `ALTER ROLE`; trocar em produção).

Fluxo de dados atual:
```
Browser → Next (3210) → /api/crm/* (proxy injeta x-tenant-id) → NestJS (3333) → Prisma → Postgres (RLS por tenant)
                       → /api/cerebro/* (lê o vault Obsidian direto do filesystem)
```

---

## 1. Monorepo — estrutura

```
apps/web    Next.js 14 (App Router) — front + proxy + leitor do cérebro
apps/api    NestJS 10 + Prisma — API REST /v1 (crm, rag, health)
packages/   config (tsconfig base), types (contratos compartilhados)
db/         migrations SQL (schema + RLS + testes)
Nyro IA/cerebro/  vault Obsidian (documentação = fonte da verdade + base RAG)
docker-compose.yml, turbo.json, pnpm-workspace.yaml
```
Stack fixada (ADR-0002): Node 20.20.2, pnpm 9.12.3, Turborepo 2.10.5, Next 14.2.35, React 18.3.1, Tailwind 3.4, NestJS 10.4.22, Prisma 5.22, TypeScript 5.5.

---

## 2. FRONT-END (apps/web) — o que está feito

### 2.1 Telas (rotas)
| Rota | Arquivo | Status | Observação |
|---|---|---|---|
| `/login` | `app/(auth)/login` | 🟡 | UI completa; Google/GitHub e e-mail entram via **sessão demo** (cookie client-side), **não é OAuth real** |
| `/signup` | `app/(auth)/signup` | 🟡 | Idem; coleta nome/empresa/nicho mas **não provisiona tenant** |
| `/` (Dashboard) | `app/(app)/page.tsx` | ✅ | KPIs, funil, atividades, contatos recentes — **dados reais do banco** |
| `/pipeline` | `app/(app)/pipeline` | ✅ | Kanban; **drag-and-drop persiste** (`PATCH /v1/crm/deals/:id/stage`) |
| `/contatos` | `app/(app)/contatos` | 🟡 | Listar + buscar + **criar (persiste)**. Falta editar/excluir/perfil 360 |
| `/inbox` | `app/(app)/inbox` | 🟡 | Lê conversas/mensagens reais. **Enviar mensagem NÃO funciona** (input sem ação) |
| `/conhecimento` + `/conhecimento/[...slug]` | `app/(app)/conhecimento` | ✅ | Navega a base de conhecimento (markdown do vault) |
| `/agenda` `/marketing` `/financeiro` `/nyro` | `app/(app)/*` | 🟡 | Telas "em construção" (ComingSoon) — **não funcionais** |

### 2.2 Componentes / infra de UI
| Item | Status | Observação |
|---|---|---|
| Design system (tokens roxo `#7B2FBE` + off-white, dark mode) | ✅ | `globals.css` + `tailwind.config.ts` |
| UI kit (`components/ui.tsx`): Button, Card, Badge, Avatar, Input, Field | ✅ | |
| Ícones SVG próprios (`components/icons.tsx`) | ✅ | sem dependência externa |
| Charts SVG (`components/charts.tsx`): Sparkline, BarChart, Funnel | ✅ | |
| App shell: `AppSidebar`, `AppTopbar` | ✅ | |
| Command bar `Cmd/Ctrl+K` (`CommandBar`) | ✅ | navega + busca conhecimento (real, via `/api/cerebro`) |
| Toggle de tema (claro/escuro) | ✅ | |
| Sino de notificações | 🟡 | ícone estático, **sem notificações reais** |
| Menu do usuário | 🟡 | "Meu perfil"/"Configurações" **não fazem nada**; "Sair" funciona |
| Dock da Nyro (botão ✦) | 🟡 | abre painel com sugestões fixas; **input não envia nada** (sem IA) |
| Auth client (`lib/auth.tsx`) + `middleware.ts` | 🟡 | guard de rota por cookie funciona; **sessão é demo** |
| `lib/crm.ts` (fetchers do CRM) | ✅ | |
| `lib/cerebro.ts` (leitor do vault) | ✅ | |
| Proxy `/api/crm/[...path]` (injeta tenant) | ✅ | tenant **fixo de dev** (`ORVYN_TENANT_ID`) |

### 2.3 O que o front **não** tem (front)
⛔ Edição/exclusão de contato · perfil 360 · criar/editar negócio pela UI (só move) · empresas · tarefas/notas · envio de mensagem no inbox · agenda/calendário · campanhas · financeiro/Stripe · chat real da Nyro · tempo real (WebSocket) · onboarding com entrevista da Nyro · configurações/equipe/permissões.

---

## 3. BACK-END (apps/api) — o que está feito

### 3.1 Módulos NestJS
| Módulo | Status | O que faz hoje |
|---|---|---|
| `health` | ✅ | `GET /v1/health` (checa conexão do banco) |
| `prisma` | ✅ | `PrismaService` + `withTenant()` (seta `app.current_tenant_id` parametrizado → RLS) |
| `common` | ✅ | filtro de erro **RFC 7807** (`application/problem+json`) + correlation-id |
| `config` | ✅ | validação de env com zod |
| `crm` | ✅ | overview, contatos (list/create), pipeline, deals (create/move), conversas — tudo via RLS |
| `rag` | 🟡 | lógica completa + **24 unit tests verdes**, mas **precisa de chaves** (Voyage/Anthropic) e ingestão real para funcionar de ponta a ponta |
| `auth` | ⛔ | **não existe** — sem login real/JWT/refresh/OAuth |
| `tenants` | ⛔ | **não existe** — sem provisionamento; tenant é fixo de dev |
| `inbox` (envio/canais) | ⛔ | só leitura via `crm`; sem envio nem webhooks |
| `automations` | ⛔ | motor de workflows (F4) |
| `integrations` | ⛔ | Meta/Google/LinkedIn/Stripe/WhatsApp |
| `billing` | ⛔ | Stripe + créditos de IA |
| `analytics` | ⛔ | KPIs materializados |
| `audit` | 🟡 | há tabela `activities` (feed), mas **não** o `audit_logs` imutável formal |

### 3.2 Módulo RAG — detalhe (`apps/api/src/rag/`)
- ✅ `ChunkingService` (não corta tabela/código, breadcrumb, p95 tokens) — testado.
- ✅ `EmbeddingsService` (batch 96 + retry) sobre **provider abstrato**; `VoyageEmbeddingProvider` real **exige `VOYAGE_API_KEY`**.
- ✅ `RetrievalService` (busca híbrida `rag_search_hybrid` + RRF + boost + cache + `withTenant`) — testado.
- ✅ `IngestionService`/`IngestionProcessor` idempotentes; fila **in-process** (🟡 BullMQ é o path de escala, não ligado).
- 🟡 `RerankerService`: só `IdentityReranker` (baseline) — **cross-encoder real (R2.2) não existe**.
- ⛔ `ContextualizerService` (Haiku + prompt caching, R2.1) — **não existe**.
- ⛔ `GuardrailsService` (CFM/OAB, R2.4) — **não existe**.
- ✅ Tool `search_knowledge` (tenant só da sessão) — testado.
- **Corpus** pronto em `Nyro IA/cerebro/RAG/conhecimento/` + seed `apps/api/scripts/seed-rag.mjs` (🟡 ainda não ingerido — precisa da chave).

---

## 4. BANCO DE DADOS — o que existe

Migrations em `db/` (aplicar na ordem): `000_foundation` → `001_rag_schema` → `001a_rls_harden` → `003_crm_schema`. Teste: `002_isolation_test` (✅ **passou** — zero vazamento cross-tenant).

| Tabela | Origem | RLS | Observação |
|---|---|---|---|
| `tenants` | 000 (mínima) | — | 🟡 falta estender (users completos, plano, template) |
| roles `orvyn_app` (NOBYPASSRLS) / `orvyn_service` (BYPASSRLS) | 000 | — | ✅ |
| `rag_documents`, `rag_chunks`, `rag_queries`, `rag_feedback`, `nyro_guardrail_hits` | 001/001a | ✅ | pgvector(1024) + HNSW + tsvector pt |
| `users` | 003 | ✅ | básico (sem senha/2FA/permissões) |
| `pipelines`, `stages` | 003 | ✅ | 1 pipeline seed |
| `contacts` | 003 | ✅ | falta `companies`, campos custom usados |
| `deals` | 003 | ✅ | |
| `conversations`, `messages` | 003 | ✅ | leitura ok; sem envio |
| `activities` | 003 | ✅ | feed do dashboard |
| `audit_logs` (imutável) | — | ⛔ | ainda não criado |
| `companies`, `tasks`, `notes`, `workflows`, `integrations`, `invoices`, `ai_usage_events` | — | ⛔ | não criados |

---

## 5. APIs — TODAS as rotas

### 5.1 Existentes (funcionam) ✅
**NestJS (`http://localhost:3333`, prefixo `/v1`)** — CRM exige header `x-tenant-id`:
| Método | Rota | Descrição |
|---|---|---|
| GET | `/v1/health` | status + conexão do banco |
| GET | `/v1/crm/overview` | KPIs + funil + atividades + contatos recentes |
| GET | `/v1/crm/contacts?q=` | lista/busca contatos |
| POST | `/v1/crm/contacts` | cria contato |
| GET | `/v1/crm/pipeline` | etapas + negócios agrupados |
| POST | `/v1/crm/deals` | cria negócio |
| PATCH | `/v1/crm/deals/:id/stage` | move negócio de etapa |
| GET | `/v1/crm/conversations` | conversas + mensagens |
| POST | `/v1/rag/documents` | 🟡 ingere documento (precisa DB; embeddings exigem chave) |
| POST | `/v1/rag/search` | 🟡 busca no RAG (precisa chave Voyage) |
| POST | `/v1/rag/feedback` | 🟡 feedback de resposta |

**Next (`http://localhost:3210`)**:
| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/health` | health do front + cérebro |
| GET | `/api/cerebro` · `/api/cerebro/[...slug]` | índice/documento do vault |
| GET/POST/PATCH/DELETE | `/api/crm/[...path]` | **proxy** para o NestJS com `x-tenant-id` |

### 5.2 APIs que **faltam** (necessárias para completar) ⛔
> Contratos-alvo em [[APIs]]. Prioridade sugerida entre colchetes.

**Auth & Tenant [P0]**
- `POST /v1/auth/signup` · `POST /v1/auth/login` · `POST /v1/auth/refresh`
- `GET /v1/auth/google` · `GET /v1/auth/github` (OAuth real + callback)
- `GET /v1/auth/me` · `POST /v1/tenants` (provisiona conta) · convites de equipe
- Resolver **tenant a partir do JWT** (hoje é header/tenant fixo)

**CRM (completar) [P1]**
- `GET /v1/crm/contacts/:id` (perfil 360) · `PATCH`/`DELETE /v1/crm/contacts/:id`
- `GET/POST/PATCH/DELETE /v1/crm/companies`
- `PATCH`/`DELETE /v1/crm/deals/:id` · `GET /v1/crm/pipelines` (múltiplos) · CRUD de `stages`
- `POST /v1/crm/tasks` · `POST /v1/crm/notes`

**Inbox & WhatsApp [P1]**
- `POST /v1/messages` (enviar) · `POST /v1/webhooks/whatsapp` (Evolution API, idempotente)
- atribuição de conversa · WebSocket para tempo real

**Nyro IA [P2]**
- `POST /v1/nyro/chat` (SSE/stream) · `POST /v1/nyro/actions/:id/approve` (human-in-the-loop)
- RAG: ligar `VOYAGE_API_KEY` + Anthropic (contextualizer/guardrails)

**Integrações & Billing [P2]**
- Meta (Lead Ads + Conversions) · Google (Calendar/Ads) · Stripe (checkout + `POST /v1/webhooks/stripe`)
- `GET /v1/analytics/kpis`

**Automações [P3]**
- CRUD de `workflows` · engine BullMQ · `GET /v1/workflows/:id/runs`

---

## 6. Funcionalidades que EXISTEM mas NÃO funcionam corretamente (🟡)

1. **Login/Cadastro Google & GitHub** — botões e telas prontos, mas fazem **login demo** (cookie local). Não há OAuth real, JWT, nem provisionamento de tenant. → precisa módulo `auth` (NextAuth/Auth.js + NestJS) e credenciais.
2. **Multi-tenant no front** — o proxy usa um **tenant fixo de dev**. Todo usuário demo cai no mesmo tenant. → mapear sessão→tenant após auth real.
3. **Inbox — enviar mensagem** — a caixa de texto e o botão de enviar **não disparam nada**; sugestão da Nyro ("Usar") é estática. → `POST /v1/messages` + Evolution API.
4. **Dock da Nyro / chat** — abre, mas o campo de mensagem **não conversa** (sem LLM). Sugestões são fixas. → `POST /v1/nyro/chat`.
5. **Insights da Nyro (dashboard)** — textos **fixos**, não gerados por IA.
6. **RAG (busca de conhecimento pela IA)** — implementado e testado em unit, mas **não responde de verdade** sem `VOYAGE_API_KEY` (embeddings) e ingestão do corpus. Reranker é baseline (sem cross-encoder); sem contextualização; sem guardrails CFM/OAB.
7. **Agenda / Marketing / Financeiro** — telas **placeholder** ("em construção").
8. **Sino de notificações / Perfil / Configurações** — **sem ação**.
9. **Criar negócio pela UI** — o botão "Novo negócio" no Pipeline **não abre formulário** (só o de contato existe). Mover negócio funciona.
10. **Busca de contatos** — funciona no servidor, mas **sem paginação** (carrega tudo).
11. **RAG ingestion** — usa fila **in-process** (sem durabilidade/retry/DLQ do BullMQ) e **role de escrita**: publicar base global/nicho deve rodar como `orvyn_service` (hoje a API conecta como `orvyn_app`).
12. **CI/CD** — os testes existem mas **não há pipeline** que rode lint/typecheck/testes/isolamento a cada PR.

---

## 7. Config manual necessária (chaves / env)
| Onde | Variável | Para quê |
|---|---|---|
| `apps/api/.env` | `DATABASE_URL` | conexão (orvyn_app) — já configurada em dev |
| `apps/api/.env` | `VOYAGE_API_KEY` | embeddings do RAG (obrigatório p/ RAG real) |
| `apps/api/.env` | `ANTHROPIC_API_KEY` | Nyro (chat) + contextualizer/guardrails (R2) |
| `apps/api/.env` | `COHERE_API_KEY` | rerank fallback (opcional) |
| auth | `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET` | OAuth real |
| integrações | tokens Meta/Google/WhatsApp(Evolution)/Stripe | F5 |
| `apps/web/.env.local` | `ORVYN_API_URL`, `ORVYN_TENANT_ID` | proxy do front (dev) |

---

## 8. Ordem sugerida para "montar o que falta"
1. **Auth real (F0-11)** — NextAuth (Google/GitHub) + módulo `auth`/`tenants` no NestJS → resolve tenant do JWT (mata os itens 1, 2 da seção 6).
2. **Completar CRM (F1)** — perfil 360, editar/excluir, criar negócio na UI, empresas, tarefas/notas, `audit_logs`.
3. **Inbox real (F1/F5)** — envio + Evolution API + WebSocket.
4. **Ligar o RAG (R1→R2)** — `VOYAGE_API_KEY`, ingerir corpus (`seed-rag.mjs`), reranker cross-encoder, contextualizer, guardrails CFM/OAB.
5. **Nyro chat (F3)** — `POST /v1/nyro/chat` (SSE) + tools tipadas + human-in-the-loop.
6. **Integrações + Billing (F5)** — Meta/Google/Stripe/WhatsApp + créditos de IA (`ai_usage_events`).
7. **Automações (F4)** — engine BullMQ + workflow builder.
8. **CI/CD** — pipeline com lint/typecheck/testes + **teste de isolamento bloqueante**.

> Regra que não muda ao construir: **toda** tabela nova com `tenant_id` + policy RLS + teste de isolamento; **Nyro só age por tools tipadas com audit log**; guardrails de nicho em duas camadas; nada de segredo no código. Ver [[RegrasNegocio]].

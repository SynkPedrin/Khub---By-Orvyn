# Sprint Atual — Orvyn

> Sprint única em andamento. Objetivo único, ≤5 tasks, Definition of Done. Ver [[Tasks]] · [[PRD]].

---

## Sprint 1 — Fundação: Cérebro + gate de aprovação

- **Fase:** F0 — Fundação
- **Semana:** 1
- **Ambiente:** local
- **Objetivo único:** **Estabelecer o cérebro (fonte única de verdade) completo e aprovado, antes de escrever qualquer código.**

### Tasks da sprint
1. **F0-01** — Criar vault `Nyro IA/cerebro/` com os 8 arquivos. ✅
2. **F0-02** — Transcrever o PDF para o cérebro com marcação de lacunas. ✅
3. **F0-03** — Popular `Tasks.md` (backlog F0+F1 com aceite testável). ✅
4. **F0-04 / F0-05** — Escrever este `Sprint.md` + `CLAUDE.md` na raiz. ✅
5. **F0-06 [GATE]** — Obter aprovação do cérebro pelo usuário. ⏳ **BLOQUEIA todo o código.**

### Definition of Done (Sprint 1)
- [x] 8 arquivos do cérebro criados dentro do vault Obsidian.
- [x] PDF transcrito sem resumir; lacunas marcadas com `⚠️ LACUNA`.
- [x] Backlog F0 e F1 com critérios de aceite testáveis.
- [x] `CLAUDE.md` na raiz aponta para o cérebro e replica o protocolo/regras.
- [ ] **Usuário aprovou o cérebro** (gate F0-06).

### Fora de escopo desta sprint (NÃO fazer)
- Qualquer código: monorepo, Prisma, auth, RLS, design system. Só depois do gate F0-06.
- Melhorias propostas (MP-01..05) — só entram se aprovadas.

---

## Redirecionamento do product owner — RAG R0
O product owner forneceu o pacote do RAG e mandou "iniciar o desenvolvimento". Decisão registrada em **ADR-0004**: entregar a **fundação de dados do RAG (R0)** já, por não depender de toolchain nem de chaves externas.

### Entregue nesta sessão (R0 — camada de banco)
- [x] `db/000_foundation.sql` — `tenants` mínima + roles `orvyn_app` (NOBYPASSRLS) / `orvyn_service` (BYPASSRLS).
- [x] `db/001_rag_schema.sql` — schema RAG fornecido, transcrito verbatim (UTF-8 limpo).
- [x] `db/001a_rls_harden.sql` — FORCE RLS + RLS de `nyro_guardrail_hits` + grants.
- [x] `db/002_isolation_test.sql` — teste de vazamento cross-tenant, bloqueante, self-cleaning.
- [x] `db/README.md` — pré-requisitos e ordem de execução.
- [x] Spec integrada ao cérebro: [[RAG/RAG]]; backlog R0-R4 em [[Tasks]]; invariantes no `CLAUDE.md`; ADR-0004 em [[Arquitetura]]; findings em [[Bugs]] (BUG-001/002).

### Pendente (não executável nesta máquina — sem Node/pnpm/Docker/psql)
- [ ] **Executar** as 4 migrations e provar o `002` verde. Precisa de Postgres 15+ com pgvector (via Docker Compose — F0-08) ou uma `DATABASE_URL` acessível.
- [ ] **R0.3** (Prisma) e **R1+** (serviços TS, incl. `retrieval.service.ts` fornecido): dependem do monorepo `apps/api` (F0-07).

## Entregue nesta sessão (2) — `apps/web` (cérebro como backend, ADR-0005)
- [x] App Next.js 14 (App Router) em `apps/web`, verificado em runtime (typecheck + build + endpoints na porta 3221).
- [x] Backend = cérebro Obsidian: `lib/cerebro.ts` + `/api/cerebro`, `/api/cerebro/[...slug]`, `/api/health`. Guard anti path-traversal.
- [x] UI de marca (`#7B2FBE`, creme, dark mode, `logo.png`), mobile-first, painel Nyro, command bar `Cmd/Ctrl+K`, zero tela em branco.
- [x] Cobre parcialmente F0-15/16 e fecha F0-17. Next fixado em 14.2.35 (patch de segurança).
- Nota de ambiente: porta 3000 ocupada por outro projeto ("SmartFood"); rodar o Orvyn em outra porta.

## Entregue nesta sessão (3) — Monorepo + API (ADR-0002)
- [x] Monorepo **pnpm + Turborepo**: `apps/web`, `apps/api`, `packages/config`, `packages/types`. `pnpm build` → 2/2 apps (verificado).
- [x] `apps/api` **NestJS 10** sobe: `/v1/health` (db:false sem Postgres), erros **RFC 7807** (`application/problem+json` + correlation-id), env validada por zod.
- [x] **R0.3**: Prisma 5.22 com `Unsupported("vector(1024)")`, `prisma generate` OK; `PrismaService.withTenant()` (padrão correto do BUG-001, `set_config` parametrizado).
- [x] `docker-compose.yml` (pgvector pg16 + redis) e `.env.example`. Porta do `apps/web` movida para **3210** (evita conflito com "SmartFood" na 3000).
- [x] ADR-0002 fixado com versões reais.

### Ainda pendente (só falta infra — sem Docker/Postgres nesta máquina)
- [ ] `docker compose up` → rodar `db/000→002` → **`002` verde fecha o R0.2** (único item que falta do R0).
- [ ] Wire dos serviços RAG (R1): ingestão, embeddings, retrieval (com o helper `withTenant`), tool `search_knowledge`. Precisa de chaves Voyage/Cohere/Anthropic.

## Entregue nesta sessão (4) — R1 do RAG (lógica implementada + testada em unit)
Módulo `apps/api/src/rag/` com **24 unit tests verdes** (jest + ts-jest), sem depender de chaves externas:
- [x] **R1.1** `ChunkingService` (estrutural-semântico; não corta tabela/código; breadcrumb; p95 tokens).
- [x] **R1.2** `EmbeddingsService` + provider abstrato Voyage (batch 96, retry exponencial, `toSqlVector` validado).
- [x] **R1.3** `IngestionService`/`IngestionProcessor` idempotentes (hash + delete-then-insert). Fila **in-process** (BullMQ = escala, ADR-08).
- [x] **R1.4** `RetrievalService` (RRF+boost via `rag_search_hybrid`, `withTenant` corrigindo BUG-001, cache, rerank plugável, contexto anti-injection).
- [x] **R1.5** Tool `search_knowledge` — tenant só da sessão; args maliciosos descartados.
- [x] `RagModule` sobe na API (DI ok); `POST /v1/rag/search` sem `x-tenant-id` → 400 RFC-7807.
- Baseline `IdentityReranker` (R2.2 traz cross-encoder) e sem contextualização (R2.1) — documentado.

### Pendente (só falta infra + chaves)
- [ ] **Integração R0.2/R1**: Postgres+pgvector (Docker) + `VOYAGE_API_KEY` → rodar `db/002` (isolamento) e uma busca real (jargão no top-3).

## Entregue nesta sessão (5) — Front no localhost + corpus do RAG
- [x] **Front rodando**: `http://localhost:3210` (Next dev em background; cérebro Obsidian como backend). Porta 3210 (não conflita com "SmartFood" na 3000).
- [x] **Corpus inicial do RAG** em `Nyro IA/cerebro/RAG/conhecimento/` (8 docs): global (vendas/copy/growth), medico (áreas + CFM), juridico (áreas + leis reais com links planalto + OAB), contabil (regimes + obrigações + CFC). Já navegável no front (19 docs no total).
- [x] **Seed** `apps/api/scripts/seed-rag.mjs` (`--dry-run` verde) para ingerir o corpus no RAG real.
- ⚠️ **Curadoria** marcada nos docs: leis/prazos/protocolos exigem validação da operação; nenhuma lei/texto foi inventado (só referências verificáveis + links oficiais).

## Entregue nesta sessão (6) — CRM front (UI/UX) no localhost
- [x] **Redesign completo** do `apps/web` como CRM: paleta roxo `#7B2FBE` + off-white, dark mode, mobile-first, design system (tokens, UI kit, ícones SVG próprios, charts SVG sem dependência).
- [x] **Auth**: telas `/login` e `/signup` (split-screen de marca) com **Google + GitHub** e e-mail. Sessão **demo** (client-side) + **middleware de guard** (rota protegida → redireciona a /login). Verificado: guard 307, login/signup 200, dashboard 200 com sessão.
- [x] **App shell**: sidebar, topbar (busca ⌘K, menu de usuário, toggle de tema), dock da Nyro, command bar.
- [x] **Telas**: Dashboard (KPIs+sparklines, receita, funil, insights Nyro, atividade), Pipeline **Kanban com drag-and-drop**, Contatos (tabela+busca), Inbox omnichannel (thread + sugestão Nyro), Conhecimento (base RAG navegável), e Agenda/Marketing/Financeiro/Nyro com estados "em construção" (zero tela em branco).
- Rodando em **http://localhost:3210**. Dados do CRM são **demo** (rotulados); auth demo até o back real.

> Nota: cobre bem F0-14/15/16/17 (design system + shell + mobile-first + zero tela em branco). **Auth real** (OAuth Google/GitHub server-side) é **F0-11** com NextAuth/Auth.js — o middleware e o `AuthProvider` já são os pontos de plugue.

## Entregue nesta sessão (7) — Infra no ar + CRM Core REAL (F1)
- [x] **Docker up**: Postgres 16 + pgvector + Redis (`docker-compose.yml`, sem initdb.d — migrations manuais).
- [x] **R0.2 FECHADO**: `db/002_isolation_test.sql` passou contra Postgres real → *"R0.2 OK — nenhum vazamento cross-tenant"*.
- [x] **CRM schema** `db/003_crm_schema.sql`: users, pipelines, stages, contacts, deals, conversations, messages, activities — todas com **RLS** (`app.current_tenant_id`) + grants; seed de 1 tenant com dados reais (8 contatos, 8 negócios, 3 conversas).
- [x] **API CRM** (NestJS `crm` module): `/v1/crm/overview|contacts|pipeline|deals|conversations` — tudo via `withTenant` (RLS). Conecta como `orvyn_app` (NOBYPASSRLS). Isolamento provado via API (tenant errado → 0).
- [x] **Front ligado ao banco**: proxy `/api/crm/*`, `lib/crm.ts`; Dashboard, Pipeline (drag **persiste**), Contatos (criar **persiste**), Inbox — **dados reais**, zero array demo. Verificado end-to-end.
- Rodando: web **http://localhost:3210** · API **:3333** · Postgres **:5432**.

## Entregue nesta sessão (8) — FASE 1: Auth real + Tenants ✅
- [x] `db/004_auth_tenants.sql`: `identities` (global), `memberships`, `refresh_tokens`, `invites`, `audit_logs` **imutável** (trigger + REVOKE), `webhook_events`; RLS nas de tenant + casos novos no `002` (isolamento passa).
- [x] NestJS `auth` + `tenants`: signup/login/refresh/logout/me; **argon2id**; **JWT 15min** + **refresh rotativo revogável**; guard global `JwtAuthGuard`; provisionamento (tenant+owner+funil default). OAuth `/v1/auth/oauth/callback` plugável (501 explícito).
- [x] CRM/RAG passam a tirar o **tenant do JWT** (`@TenantId`); `x-tenant-id` sai do request path.
- [x] Front real: rotas `/api/auth/*` (cookies httpOnly), `middleware` por sessão, refresh silencioso, login/signup/logout reais, proxy `/api/crm` manda Bearer.
- [x] **git init** + baseline; **verificado end-to-end** (2 tenants isolados por JWT, rotação/revogação, 401 sem token, signup→CRM→logout no front).
- Config pendente p/ OAuth real: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET`, `AUTH_SECRET`.

## Entregue nesta sessão (9) — Inteligência de marketing da Nyro (RAG global)
- [x] Corpus "MARKETING NYRO" (12 frameworks C-Level: 6 marketing + 6 operação) integrado ao cérebro em `RAG/conhecimento/global/{marketing,operacao}/` (dup descartada, pasta solta removida).
- [x] Seeder `apps/api/scripts/seed-global-rag.mjs` (frontmatter→metadados, chunk por seção, escopo=global via `orvyn_service`). **Ingerido: 12 docs / 73 chunks**; buscável por BM25 (STP p/ "posicionar", GTM p/ "lançar serviço"). Embeddings entram com `VOYAGE_API_KEY`.
- [x] UI: `/marketing` vira a **Central de Marketing da Nyro** (lista os frameworks, abre no leitor de conhecimento). Verificado.
- [x] Índice `RAG/conhecimento/global/_INDICE.md` (recuperação por dominio + plano + gate de intenção).

## Roadmap de finalização (A→G) — "pronto faltando só a Anthropic"
Ordem do brief do operador. Cada sprint: doc-first → plano → executar → testes (unit + isolamento) → atualizar cérebro.
- **A** — Integrations foundation + **Meta Ads** (entrega visível) ← **PRÓXIMO, plano abaixo**
- **B** — TikTok Ads + Google Ads (mesmo contrato `AdsConnector`)
- **C** — Stripe (billing + pagamentos no funil)
- **D** — Fechar CRM (F2) + Inbox real + WhatsApp (fecha BUG-003/004/006)
- **E** — Motor de automações (BullMQ + React Flow, ~15 nós)
- **F** — Nyro chat + tools (gated em `ANTHROPIC_API_KEY`; 501 sem a chave)
- **G** — Embeddings plugáveis + backfill (`VOYAGE_API_KEY`; fallback BM25)

Base já entregue: `.env.example` (contrato completo) e RegrasNegocio §6.1/§6.2 (OAuth por tenant + cripto AES-256-GCM; fallback Voyage→BM25).

---

## SPRINT A — Integrations foundation + Meta Ads  *(proposto — aguardando aprovação)*

**Objetivo único:** um tenant conecta uma conta **Meta Ads** por OAuth, os insights populam o banco por BullMQ, e `/marketing/ads` mostra campanhas ordenadas por performance + galeria de criativos com "melhor performando" — tudo isolado por tenant.

### Tasks
1. **`db/005_integrations_schema.sql`** (aditiva): `integrations`, `ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_creatives`, `ad_insights` (particionada por `date`), `ad_sync_runs`. Todas `tenant_id NOT NULL` + RLS (padrão `003/001a`). + casos no `002_isolation_test`. Prisma models + generate.
2. **Env/cripto:** adicionar as chaves ao `env.ts` (zod) como **opcionais** (só `JWT_SECRET` fatal); `CryptoService` AES-256-GCM (`INTEGRATIONS_ENCRYPTION_KEY`) para credenciais por tenant. Se a chave de cripto faltar e houver tentativa de conectar → erro claro.
3. **Módulo `integrations`:** contrato `AdsConnector` + `MetaAdsConnector` (buildAuthUrl → callback grava credencial cifrada → listAdAccounts → syncCampaigns/Creatives/Insights → healthCheck). Última versão estável da Graph API (confirmar na doc na hora).
4. **BullMQ ligado:** fila `ads-sync` (job on-demand pós-conexão + periódico por integration), idempotente; grava `ad_sync_runs`.
5. **Webhook:** `POST /v1/webhooks/meta` (verify token + Lead Ads) idempotente via `webhook_events`.
6. **Rotas:** `GET /v1/integrations` · `GET /v1/integrations/:provider/auth-url` · `GET /v1/integrations/meta/callback` · `POST /v1/integrations/:id/sync` · `GET /v1/ads/overview|campaigns|creatives`.
7. **Front `/marketing/ads`:** onboarding "Conecte suas contas" (botão Meta OAuth) → seleção de ad account → sync; overview (spend/leads/CPL/ROAS), tabela de campanhas ordenável, galeria de criativos com badge "melhor performando", health das conexões. Estado vazio com CTA (zero tela em branco).
8. **Testes:** unit do `MetaAdsConnector` com **HTTP mockado** (sem rede); isolamento das 7 tabelas novas; e2e da rota de overview com dados semeados.

### Definição de pronto (Sprint A)
- Migração aplica limpa; `002` verde incluindo as 7 tabelas novas.
- Com `META_APP_ID/SECRET` presentes: fluxo OAuth → conta conectada → `ad_insights` populado → `/marketing/ads` renderiza campanhas por performance + melhor criativo. **Sem** as chaves: a tela mostra "Conecte sua conta Meta" (CTA), nada quebra.
- Nenhum segredo no código; token do cliente cifrado em repouso; suíte verde.
- Cérebro atualizado: ADR-0007 (arquitetura de conectores + cripto), Banco.md (7 tabelas), APIs.md (novas rotas), Tasks/Bugs.

### Pré-requisito externo (não é código)
Conectar uma conta **real** exige `META_APP_ID/SECRET` + permissões `ads_read`/`ads_management` (App Review da Meta). Enquanto não houver, entrego construído + testado com mocks; o aceite "conecta conta real" fecha quando as credenciais existirem (RegrasNegocio §6.1).
2. **Integração R1** (RAG): `VOYAGE_API_KEY` → `node apps/api/scripts/seed-rag.mjs` popula o RAG e liga a busca à Nyro.
3. Evoluir F1: perfil 360 do contato, edição de deal, envio real no inbox (Evolution API).
2. **R2**: `ContextualizerService` (Haiku + prompt caching), `RerankerService` (cross-encoder calibrado → liga o corte `RAG_MIN_SCORE`), cache Redis, `GuardrailsService` (CFM/OAB). Consultar skill `claude-api` para o model id do Haiku ao implementar R2.1.

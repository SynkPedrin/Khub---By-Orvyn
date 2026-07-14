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

## Próxima sprint (proposta)
1. **Auth real (F0-11)**: NextAuth/Auth.js (Google+GitHub) + mapear sessão→tenant (hoje tenant fixo de dev).
2. **Integração R1** (RAG): `VOYAGE_API_KEY` → `node apps/api/scripts/seed-rag.mjs` popula o RAG e liga a busca à Nyro.
3. Evoluir F1: perfil 360 do contato, edição de deal, envio real no inbox (Evolution API).
2. **R2**: `ContextualizerService` (Haiku + prompt caching), `RerankerService` (cross-encoder calibrado → liga o corte `RAG_MIN_SCORE`), cache Redis, `GuardrailsService` (CFM/OAB). Consultar skill `claude-api` para o model id do Haiku ao implementar R2.1.

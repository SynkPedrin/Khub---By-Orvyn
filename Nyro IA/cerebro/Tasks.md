# Backlog — Orvyn

> Backlog priorizado. **Nenhuma feature entra no código sem estar aqui com critério de aceite testável.** Estados: `[ ]` a fazer · `[~]` em andamento · `[x]` concluída · `[!]` bloqueada.
> Ver [[Sprint]] (sprint atual) · [[PRD]] · [[Arquitetura]] · [[Banco]] · [[APIs]] · [[RegrasNegocio]].

---

## F0 — Fundação
Critério de sucesso da fase (PRD §16): **conta criada e isolada por RLS; deploy automatizado; design system publicado; vault Obsidian completo. Teste automatizado prova que tenant A não lê dado do tenant B.**

### Bloco 1 — Cérebro
- [x] **F0-01** — Criar vault `Nyro IA/cerebro/` com os 8 arquivos.
  - Aceite: existem `PRD.md`, `Arquitetura.md`, `Banco.md`, `APIs.md`, `RegrasNegocio.md`, `Tasks.md`, `Bugs.md`, `Sprint.md` + pasta `Blueprints/`.
- [x] **F0-02** — Transcrever o PDF para PRD/Arquitetura/Banco/APIs/RegrasNegocio, marcando `⚠️ LACUNA` no que o documento não define.
  - Aceite: cada seção do PDF (1–19) presente sem resumo; toda lacuna marcada.
- [x] **F0-03** — Popular `Tasks.md` com backlog F0 e F1, cada task com critério de aceite testável.
  - Aceite: este arquivo, com IDs e critérios verificáveis.
- [x] **F0-04** — Escrever `Sprint.md` com objetivo único da semana 1.
  - Aceite: [[Sprint]] com 1 objetivo, ≤5 tasks e Definition of Done.
- [x] **F0-05** — Criar `CLAUDE.md` na raiz apontando para o cérebro e replicando as regras.
  - Aceite: `CLAUDE.md` existe na raiz, referencia `Nyro IA/cerebro/*` e o protocolo de tarefa.
- [ ] **F0-06** — **[GATE] Aprovação do cérebro pelo usuário.** Nenhuma linha de código antes disso.
  - Aceite: usuário aprova explicitamente o conteúdo do cérebro.

### Bloco 2 — Monorepo e infra
- [x] **F0-07** — Monorepo (`apps/web` Next.js, `apps/api` NestJS, `packages/config`, `packages/types`; `packages/ui` adiado → F0-15).
  - Aceite: `pnpm install` resolve; `pnpm build` (turbo) → 2/2 apps; API sobe e responde `/v1/health`. **Verificado.** ADR-0002 fixado com versões. `packages/ui` pendente.
- [~] **F0-08** — Docker Compose local: Postgres + pgvector + Redis.
  - Escrito: `docker-compose.yml` (`pgvector/pgvector:pg16` + `redis:7`, migrations montadas em `initdb.d`). **Não executado** (sem Docker nesta máquina). Aceite fecha ao rodar `docker compose up` e a extensão `vector` habilitar.
- [ ] **F0-09** — Prisma: schema inicial (`tenants`, `users`, `audit_logs`) + migração com policies RLS.
  - Aceite: `prisma migrate` aplica; tabelas existem; `ENABLE/FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` presentes na migração SQL; `audit_logs` append-only (UPDATE/DELETE negados ao role da app).
- [ ] **F0-10** — CI/CD: lint, typecheck, testes, build, deploy preview.
  - Aceite: pipeline verde num PR de exemplo; falha se lint/typecheck/teste falham; preview do `web` publicado.

### Bloco 3 — Auth e multi-tenant
- [ ] **F0-11** — `auth`: signup, login, OAuth Google, JWT curto + refresh, convites de equipe, roles.
  - Aceite: signup cria tenant + user; login retorna access+refresh; refresh renova; OAuth Google conclui; convite gera e aceita membro; testes de integração passam.
- [ ] **F0-12** — `tenants` + contexto de tenant: middleware faz `SET LOCAL app.tenant_id` em toda request autenticada.
  - Aceite: request sem tenant válido → 401/403; com tenant → queries enxergam só o próprio tenant; ADR-0003 registrado.
- [ ] **F0-13** — `audit`: log imutável de toda ação (`actor` = user_id | 'nyro').
  - Aceite: ações de escrita geram linha em `audit_logs`; tentativa de UPDATE/DELETE no log falha; `GET /v1/audit-logs` lista só do tenant.
- [ ] **F0-14** — **[CRITÉRIO DE ACEITE DE F0] Teste automatizado de isolamento entre tenants.**
  - Aceite: teste cria tenant A e B com dados; autenticado como A, consulta recurso de B → **0 linhas / 404**; roda no CI e barra o merge se falhar.

### Bloco 4 — Design system  *(parcialmente entregue via `apps/web` — ADR-0005)*
- [x] **F0-CW** — App `apps/web` (Next.js 14) com o **cérebro Obsidian como backend** (MVP direcionado pelo product owner).
  - Aceite: `npm run build` verde; `/api/health` retorna `backend:cerebro-obsidian` + contagem de docs; `/api/cerebro/[...slug]` serve documento e bloqueia path-traversal (404). **Verificado em runtime** (porta 3221).
- [~] **F0-15** — Tokens de marca a partir dos assets reais (`logo.png`, `Identidade visual.png`): base clara, roxo `#7B2FBE` como ação.
  - Parcial: tokens em `globals.css` + `tailwind.config.ts`, `logo.png` em `public/`. Falta: amostrar a escala 50-900 do asset com precisão + checagem WCAG AA formal + mover assets para `packages/ui`.
  - Aceite: `packages/ui` exporta tokens (CSS vars + Tailwind preset); paleta amostrada do asset; contraste texto/ação ≥ WCAG AA; assets copiados para `packages/ui/assets/`.
- [~] **F0-16** — Mobile-first + componentes base + layout de app com painel lateral da Nyro e command bar (`Cmd/Ctrl+K`).
  - Entregue em `apps/web`: layout responsivo (sidebar colapsa, painel Nyro vira FAB no mobile), command bar `Cmd/Ctrl+K` funcional (consome `/api/cerebro`), painel Nyro presente como placeholder explícito. Falta: adotar shadcn/ui formalmente e mover componentes para `packages/ui`.
- [x] **F0-17** — Zero tela em branco: todo estado vazio tem CTA da Nyro.
  - Aceite: dashboard, not-found e telas "em construção" (agenda/marketing/financeiro) renderizam CTA da Nyro. ✓ em `apps/web`.
- [x] **F0-CRM** — Front CRM completo (UI/UX): login/signup (Google+GitHub), shell (sidebar/topbar/command bar/Nyro dock), Dashboard, Pipeline Kanban (drag-and-drop), Contatos, Inbox omnichannel, Conhecimento. Paleta roxo + off-white, dark mode, mobile-first.
  - Aceite: `pnpm build` 14 rotas verdes; middleware protege rotas; verificado em runtime (localhost:3210). Dados **demo**; auth **demo** (client-side).
- [ ] **F0-11 (auth real)** — Substituir a sessão demo por **NextAuth/Auth.js** (Google + GitHub OAuth server-side) + integração com o `auth` do NestJS.
  - Aceite: login OAuth real conclui; sessão httpOnly; `x-tenant-id`/JWT do back. **Precisa:** GOOGLE_CLIENT_ID/SECRET, GITHUB_ID/SECRET.
- [ ] **F0-18** — Relatório de prontidão de F0 + proposta de `Sprint.md` da semana seguinte.
  - Aceite: relatório do que está pronto/pendente/config manual; próxima sprint proposta.

---

## F1 — CRM Core
Critério de sucesso da fase (PRD §16): **um cliente real da agência operando o dia a dia.** Canal: WhatsApp via Evolution API.

- [~] **F1-01** — Entidades CRM com `tenant_id` + RLS + isolamento.
  - Feito: `db/003_crm_schema.sql` (users, pipelines, stages, contacts, deals, conversations, messages, activities) com RLS `tenant_rw` + FORCE + grants. Isolamento provado (0/8/0 via API). Falta: `companies`, `tasks`, `notes` e teste de isolamento por tabela no CI.
- [~] **F1-02** — Contatos: CRUD real (list/create) persistido, busca. Falta: editar, perfil 360, empresas, campos custom, dedupe.
- [~] **F1-03** — Pipeline Kanban: drag-and-drop **persiste** (`PATCH /v1/crm/deals/:id/stage`). Falta: criar/editar deal na UI, filtros salvos, tempo real (WebSocket).
- [ ] **F1-04** — Tarefas e agenda básica ligadas a deals/contatos.
  - Aceite: criar tarefa com prazo; concluir; aparece no card do deal.
- [ ] **F1-05** — Inbox WhatsApp via Evolution API (inbox unificado, envio/recebimento, atribuição, notas internas).
  - Aceite: mensagem recebida no número conectado aparece no inbox; resposta chega no WhatsApp; `messages.autor_tipo` correto; idempotência no webhook de entrada.
- [ ] **F1-06** — Dashboard de KPIs básicos do funil (Recharts).
  - Aceite: dashboard mostra nº de deals por stage e conversão; dados só do tenant.
- [ ] **F1-07** — Deals API (`GET /v1/pipelines`, `POST /v1/deals`, `PATCH /v1/deals/:id/stage`) com validação Zod e audit log.
  - Aceite: rotas com payload validado; erro RFC 7807; toda escrita audita.

> ⚠️ LACUNA (F1): schema exato de `tasks`/`notes`, contrato do webhook Evolution e formato de campos custom por template ainda não fechados — detalhar ao entrar em F1.

---

## RAG da Nyro IA (R0→R4) — pacote do product owner ([[RAG/RAG]])
> Direcionado pelo product owner ("inicie o desenvolvimento do RAG"). Sequenciado antes do resto por decisão explícita (ADR-0004). **R0 é bloqueante: nenhuma linha de IA antes do teste de vazamento passar.** Escopo de produto do RAG segue sendo F3 no roadmap; aqui adianta-se a fundação de dados.

### R0 — Fundação (bloqueia tudo)
- [~] **R0.1** — Migration do schema RAG aplicada (pgvector, pt_unaccent, HNSW, GIN, `rag_search_hybrid`).
  - Aceite: `SELECT rag_search_hybrid(...)` executa sem erro em base vazia.
  - Status: SQL **escrito e revisado** (`db/000_foundation.sql`, `db/001_rag_schema.sql`, `db/001a_rls_harden.sql`). **Execução pendente de infra** (sem Postgres/psql nesta máquina).
- [x] **R0.2** — RLS ativa + role de aplicação SEM `BYPASSRLS` + role de serviço separada; teste de vazamento bloqueante.
  - Aceite: `db/002_isolation_test.sql` **passou contra Postgres real** → "R0.2 OK — nenhum vazamento cross-tenant". FORCE RLS + roles + grants em `001a`. ✅ **Fechado.** (Falta só plugar no CI.)
- [x] **R0.3** — Prisma com `Unsupported("vector(1024)")` + helpers de `$queryRaw`.
  - Aceite: `prisma generate` OK; modelos do RAG mapeados (`apps/api/prisma/schema.prisma`). **Verificado.** Helper `PrismaService.withTenant()` seta `app.current_tenant_id` via `set_config` parametrizado (padrão correto do BUG-001). Falta apenas rodar contra Postgres real (migrations `db/`).

### R1 — Ingestão e busca  *(implementado em `apps/api/src/rag/`, 24 unit tests verdes)*
- [~] **R1.1** — `ChunkingService` respeita headings, tabelas e blocos de código.
  - Aceite (unit): nenhum chunk corta tabela/código; breadcrumb por heading; p95 tokens ≤ 700. **Verificado.** Falta validar com playbook real de nicho.
- [~] **R1.2** — `EmbeddingsService` (provider abstrato Voyage) com retry/backoff e batch 96 + `toSqlVector` validado.
  - Aceite (unit): batch 200→[96,96,8]; retry sucede na 3ª; esgota e propaga; `toSqlVector` rejeita NaN/Infinity. **Verificado.** Provider real Voyage precisa de `VOYAGE_API_KEY` (config manual).
- [~] **R1.3** — `IngestionService` + `IngestionProcessor`, idempotente por hash.
  - Aceite (unit): dedupe por `content_hash`; reprocessar mantém contagem (delete-then-insert); falha → doc `failed`. **Verificado.** **Nota:** transporte é fila **in-process** agora; **BullMQ** é o path de escala (ADR-08) quando houver Redis.
- [~] **R1.4** — `RetrievalService` (híbrido + RRF + boost via `rag_search_hybrid`), com `withTenant` (corrige BUG-001), rerank plugável, cache, log.
  - Aceite (unit): tenant vem da sessão; cache evita reembed; contexto anti prompt-injection; sem candidatos → vazio. **Verificado.** Falta rodar o SQL híbrido contra Postgres (jargão "DCTFWeb" no top-3) — precisa de DB + embeddings.
- [x] **R1.5** — Tool `search_knowledge`, `tenant_id` da sessão (nunca do LLM).
  - Aceite (unit): schema da tool **não** expõe `tenantId`; args com `tenantId` malicioso são descartados (`.strip()`) e a busca usa o tenant da sessão. **Verificado.**

> Falta para fechar R1 (todos `[~]` → `[x]`): rodar ponta-a-ponta contra Postgres+pgvector com embeddings reais (Voyage). Sem isso, a lógica está testada em unit mas não em integração.

- [~] **R1.6** — Corpus inicial de conhecimento (`Nyro IA/cerebro/RAG/conhecimento/`) + seed (`apps/api/scripts/seed-rag.mjs`).
  - Entregue: 8 docs (global vendas/copy/growth; medico/juridico/contabil com áreas, marcos legais reais + links oficiais, compliance CFM/OAB/CFC). Já visíveis no front. `seed-rag.mjs --dry-run` verde (classifica escopo/nicho). **Falta:** rodar a ingestão real (API+DB+Voyage) e a **curadoria** com a operação (marcada `⚠️` nos docs) — leis/prazos/protocolos precisam de validação humana; nada de texto legal inventado.

### R2 — Qualidade
- [ ] **R2.1** — `ContextualizerService` com prompt caching. Aceite: custo/1.000 chunks documentado; Recall@8 sobe vs baseline (medir).
- [ ] **R2.2** — `RerankerService` + corte `RAG_MIN_SCORE`.
- [ ] **R2.3** — Cache Redis com invalidação no publish.
- [ ] **R2.4** — `GuardrailsService` (blocklist por nicho + grounding + preço sem fonte). Aceite: 20 prompts adversariais por nicho → 100% bloqueados.
- [ ] **R2.5** — Citação `[#chunk_id]` no audit_log de toda resposta.

### R3 — Avaliação
- [ ] **R3.1** — Golden set: 60+ perguntas por nicho, escritas com a operação.
- [ ] **R3.2** — `pnpm rag:eval` no CI. Alvos: Recall@8 ≥ 0,90 · MRR ≥ 0,70 · Injection 100% · Leak 0.
- [ ] **R3.3** — Ablação (vetorial → +BM25 → +contextual → +rerank) registrada como ADR em [[Arquitetura]].

### R4 — Operação
- [ ] **R4.1** — Upload self-service de documentos pelo tenant (limite por plano).
- [ ] **R4.2** — Tela de curadoria (candidato → aprovado).
- [ ] **R4.3** — Medição de créditos de IA por tenant (embed + rerank + tokens) → `billing`.
- [ ] **R4.4** — Job `rag.reembed` para troca de modelo.

---

## Backlog de melhorias propostas (só após aprovação — ver [[PRD]] Anexo A)
- [ ] **MP-01** — `ai_usage_events` no schema inicial (medição de IA desde F0).
- [ ] **MP-02** — Entrevista da Nyro (F2) gera *diff JSON* aprovável, não aplica direto.
- [ ] **MP-03** — Roteamento por complexidade de modelo (F3).
- [ ] **MP-04** — Congelar 15 nós de automação (F4).
- [ ] **MP-05** — Política de retenção/custo de mídia WhatsApp + permissões granulares.

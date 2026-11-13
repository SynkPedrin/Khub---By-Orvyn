# RELEASE SPRINT LEDGER — KHUB Revenue OS

> Criado em 2026-09-22 em resposta ao "AUTONOMOUS FINALIZATION & RELEASE SPRINT ENGINE".
> **Antes de qualquer sprint desta ledger, ver a nota de conflito de contrato no topo do relatório desta sessão.**
> Formato por sprint: STATUS · OBJECTIVE · FILES_CHANGED · TESTS · BUGS_FOUND · BUGS_FIXED · EXTERNAL_BLOCKERS · REMAINING_RISK.

---

## BASELINE — 2026-09-22

### Gates reais executados agora (não lidos do código, rodados de verdade)

| Gate | Comando | Resultado |
|---|---|---|
| Typecheck | `pnpm typecheck` (turbo: api+web) | ✅ PASS |
| Lint | `pnpm lint` | ✅ PASS (1 warning pré-existente não-bloqueante em `automacoes/[id]/page.tsx:204`, `react-hooks/exhaustive-deps`) |
| Testes API | `cd apps/api && npx jest` | ✅ **267/267**, 31/31 suites |
| Testes Web | — | ⚠️ **0 arquivos de teste no `apps/web`** (`*.spec.ts`/`*.test.ts`) — cobertura frontend é só typecheck + lint + QA visual manual, nunca testes automatizados de componente/integração |
| Build | `pnpm build` (com dev server parado) | ✅ PASS — web + api |

### Estrutura real do monorepo
- `pnpm-workspace.yaml`: `apps/*`, `packages/*`
- Apps: `apps/api` (NestJS 10 + Prisma 5), `apps/web` (Next 14 App Router)
- Packages: `packages/config`, `packages/types`
- Módulos reais em `apps/api/src/`: `agenda`, `ai`, `analytics`, `auth`, `automations`, `blueprints`, `common`, `config`, `crm`, `events`, `financeiro`, `health`, `integrations`, `marketplace`, `nyro`, `operations`, `rag`, `realtime`, `settings`, `tenants`
- Rotas reais em `apps/web/app/(app)/`: `agenda`, `analytics`, `automacoes`, `campanhas`, `configuracoes`, `conhecimento`, `contatos`, `conversas`, `empresas`, `financeiro`, `ia`, `inbox`, `leads`, `marketing`, `nyro`, `onboarding`, `pipeline`, `tarefas`
- Migrations: `db/000` → `db/024` (25 arquivos), todas com RLS + `FORCE ROW LEVEL SECURITY` no padrão estabelecido
- Credenciais configuradas em `apps/api/.env` (nomes, não valores): `DATABASE_URL`, `REDIS_URL`, `EVOLUTION_*`, `GOOGLE_CLIENT_*`, `GITHUB_*`, `META_APP_*`, `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, `VOYAGE_API_KEY`, `INTEGRATIONS_ENCRYPTION_KEY`, `JWT_SECRET`, `AUTH_SECRET`. **`OLLAMA_BASE_URL` não está setado** — o provider de IA ativo hoje é Anthropic/Groq, não Ollama.

### ⚠️ Achado de baseline: o cérebro está desatualizado
`Nyro IA/cerebro/Sprint.md` e `Tasks.md` param em **2026-07-21** (Sprint W1). Desde então, **nesta mesma conversa** (não documentada no cérebro):
- WhatsApp migrado de STEVO (não oficial) para **Evolution API** (oficial/self-hosted) — provider, webhook, connection service, controller, migration `024`, 100% testado inclusive contra instância real (QR real escaneado, decodificado, instância criada com isolamento por tenant).
- Meta OAuth — separação de capability (`ads` vs `leads`) para resolver falha em cascata de "Invalid Scopes"; diagnóstico via `/me/permissions` real.
- Dashboard — trocado de dados demo para `crm.overview()`/`crm.tasks()` reais.
- Redirect loop crítico (361→1 requests) corrigido.
- Bug cross-cutting de `config_required` (`body.code` vs `body.status`) corrigido — afetava **todo** provider gated.
- Tela de autenticação — **três iterações completas de redesign** nesta sessão (split-screen 52/48, vídeo real `crystal-video.mp4`, glass card, confirmar-senha, checkbox de termos, ícones em inputs).

Isso viola a Regra 5 do `Brief-Finalizacao.md` ("Atualizar o cérebro ao terminar... Código nunca diverge da doc") — pré-existente a este pedido, não causado por ele. Deveria ser corrigido antes ou durante a Sprint 1 desta ledger.

### Cross-referência: o plano de 22 sprints deste pedido vs. o que JÁ EXISTE no `Tasks.md`/`Sprint.md` reais

O plano novo usa numeração/escopo próprios (Sprint 1–22) que **não correspondem** ao roadmap já rastreado no cérebro (Sprint 0, D1, D2, E, E.2, F, W1, trilha B/C/G/H). Boa parte do que o plano pede **já está implementada e testada**, não é trabalho novo:

| Sprint do pedido novo | Estado real (evidência) |
|---|---|
| 1 — Auth & First Impression | ✅ **Feito nesta sessão** — ver entrada abaixo |
| 2 — Onboarding & Tenant Provisioning | ✅ Já existe: signup provisiona tenant+owner+pipeline default (`AuthService`, Sprint "FASE 1" do Sprint.md) + rota `/onboarding` no front |
| 3 — WhatsApp/Evolution Production | ✅ Já existe: `EvolutionProvider`, `WhatsAppConnectionService`, webhook, estados de conexão, testado E2E contra Evolution real (fase anterior desta mesma conversa) |
| 4 — Real Inbound Lead Pipeline | ✅ Já existe: `LeadsService.upsertFromLead`, dedupe por telefone normalizado/e-mail, idempotência por `webhook_events`, `resolve_tenant_by_*` roteamento |
| 5 — Inbox/Conversations | ✅ Já existe: Sprint D2 (realtime via Socket.IO, `message.created`, `conversation.updated`) |
| 6 — Leads & Contact Workspace | ✅ Já existe: Sprint D1 (perfil 360, CRUD, paginação por cursor) |
| 7 — Pipeline & Opportunity Engine | ✅ Já existe: Kanban drag-and-drop persistente, `deal.moved` real-time |
| 8 — Tasks/Agenda | ✅ Já existe: `tasks`/`notes` (D1) + módulo `agenda` (`db/021_agenda.sql`) |
| 9 — Follow-up Engine | ⚠️ **Parcial** — `controle.esperar_resposta` (Sprint E.2) cobre "esperar resposta cancela follow-up", mas não há entidade dedicada de SLA de resposta (`firstInboundAt`/`respondedWithinSla`) documentada — provável gap real |
| 10 — Automation Engine | ✅ Já existe: BullMQ, ~22-28 nós, estado por run, DLQ, retry, idempotência, waits persistentes (Sprint E/E.2/W1) |
| 11 — NYRO Intelligence | ✅ Já existe: orquestrador multi-agente, ~19 tools tipadas (Zod), guardrails 2 camadas, human-in-the-loop, gated em `ANTHROPIC_API_KEY` (Sprint F) |
| 12 — Dashboard | ✅ Feito nesta sessão (fase anterior): dados reais, zero hardcode |
| 13 — Analytics | ❓ Não auditado nesta sessão — módulo `analytics` existe no backend, cobertura/honestidade de métricas não verificada |
| 14 — Meta/Social Integrations | ⚠️ **Parcial** — Meta Ads real e testado; Meta Leads depende de Advanced Access (blocker externo real); Instagram/Messenger não verificados |
| 15 — Integration Experience | ❓ Não auditado — marketplace existe, diagnostics detalhados (versão Evolution, expiração de token Meta) não confirmados |
| 16 — Security Hardening | ❓ Não auditado nesta sessão |
| 17 — Observability | ❓ Não auditado — não há Sentry/OTel confirmado no baseline |
| 18 — Empty/Loading/Error States | ⚠️ Parcial — Dashboard tem (fase anterior desta sessão); resto não auditado |
| 19 — Real E2E | ❌ Não executado como fluxo único ponta a ponta nesta sessão |
| 20 — Clean Build Reproduction | ❌ Não executado (`pnpm build` rodou na mesma máquina/mesmos node_modules, não em worktree limpo) |
| 21 — Final Product QA | ⚠️ Parcial — só a tela de auth passou por QA visual extensa nesta sessão |
| 22 — Final Release Gate | ❌ Não executado |

**Implicação prática:** tratar isto como "Sprint 1 de 22, começando do zero" faria retrabalho de meses de código já funcional e testado — contra a Regra 4 do `Brief-Finalizacao.md` ("Nunca quebre o que funciona... não refatorar sem ADR") e contra "não construir fora do PRD". O gap real está nos itens marcados ⚠️/❓/❌ acima, não nos ✅.

---

## Sprint 1 — Auth & First Impression

**STATUS:** 🟢 GREEN

**OBJECTIVE:** Login, cadastro, sessão, convite, logout, fluxo de senha, experiência responsiva — visual enterprise premium, split-screen 52/48 com vídeo real + painel off-white.

**FILES_CHANGED:** `components/app/AuthShell.tsx`, `LoginForm.tsx`, `SignupForm.tsx`, `PasswordInput.tsx`, `IconInput.tsx` (novo), `components/icons.tsx` (+`eyeOff`), `app/globals.css` (`.auth-card` + sistema off-white), `app/(auth)/signup/page.tsx`.

**TESTS:**
- Typecheck ✅ · Lint ✅ · Testes API 267/267 ✅ · Build web+api ✅
- Funcional (Playwright contra API real, não mockada): toggle mostrar/esconder senha ✅; login com credencial inválida → `401` real do backend + mensagem exibida ✅; cadastro com senhas divergentes → bloqueado, API nunca chamada ✅; cadastro sem aceitar termos → bloqueado, API nunca chamada ✅; cadastro válido → `200` real, conta criada de fato ✅
- Visual QA: 1440/1280/1024/768/430/390 sem overflow horizontal (verificado programaticamente); reduced-motion → vídeo cai para poster estático (0 elementos `<video>` no DOM, confirmado); mobile empilha vídeo (faixa ~32vh) + card off-white, nunca formulário sobre vídeo

**BUGS_FOUND:**
1. `pnpm build` sobrescrevendo `.next` enquanto o dev server rodava → 500 em toda rota (corrompeu o webpack runtime do processo de dev).
2. Checkbox de termos com `required` nativo escondia a mensagem de erro customizada atrás do tooltip nativo do navegador (validação nativa bloqueava o handler antes de rodar).
3. Gradiente claro no acento do headline perdia contraste contra frames muito brancos do vídeo real.
4. Logo duplicada no mobile (barra superior + lockup extra específico de mobile).

**BUGS_FIXED:** todos os 4 acima — evidência: rebuild limpo do `.next` + restart do dev server parado durante `build`; `required` removido do checkbox (validação só via JS, mesmo padrão do "senhas não coincidem"); acento trocado de gradiente para cor sólida `#a78bfa`→depois exata do spec; lockup mobile duplicado removido.

**EXTERNAL_BLOCKERS:** nenhum.

**REMAINING_RISK:** zero teste automatizado de componente para os formulários de auth (typecheck+lint+Playwright ad-hoc cobrem hoje, mas não há suíte permanente no repo — ver gap geral "0 testes no `apps/web`" no baseline).

---

## Sprint 2 (numeração desta ledger) — Security Hardening

**STATUS:** 🟢 GREEN

**OBJECTIVE:** Auditoria real de RLS/FORCE, RBAC, cookies/sessão, CORS, headers de segurança, log de segredos, verificação de assinatura de webhook, injeção SQL, XSS.

**TESTS / EVIDÊNCIA (contra o sistema real, não leitura de código):**
- RLS: `SELECT relrowsecurity, relforcerowsecurity FROM pg_class` no Postgres real (container `orvyn-postgres`) → **53/53 tabelas com RLS ativo têm FORCE também**.
- Cookies de sessão (`lib/server-auth.ts`): `httpOnly:true, sameSite:'lax', secure` (condicionado a `NODE_ENV==='production'`), `maxAge` correto em access (15min) e refresh (30 dias).
- CORS (`main.ts`): restrito a `WEB_URL` em produção, `CORS_ORIGINS` explícito tem prioridade, `credentials:true`.
- Headers de segurança (`common/security-headers.ts`): `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cross-Origin-Resource-Policy`, `Permissions-Policy`, HSTS em produção, `X-Powered-By` removido.
- Log de segredos: grep por `console.log`/`logger.log` cruzado com `password|senha|token|secret|api_key|authorization` em todo `apps/api/src` → **0 ocorrências**. Sem middleware tipo morgan/pino-http que despejaria headers completos.
- Webhook signatures: Meta usa HMAC (`createHmac`) + `timingSafeEqual` sobre o corpo cru; Evolution usa `timingSafeEqual` com checagem de tamanho antes, sobre o token no path. Ambos corretos.
- SQL: todo uso de `$queryRawUnsafe`/`$executeRawUnsafe` (6 ocorrências, `auth/jwt-auth.guard.ts`, `rag/retrieval.service.ts`, `rag/ingestion/ingestion.processor.ts`) inspecionado individualmente — **100% parametrizado** (`$1`,`$2`...), nenhuma interpolação de string do usuário na query.
- XSS: `grep dangerouslySetInnerHTML` e `eval(`/`new Function(` em todo `apps/web` → **0 ocorrências**.

**BUGS_FOUND:**
1. **Falso positivo do meu próprio grep estático**: um primeiro passe achou 5 tabelas "sem FORCE" comparando arquivo de migration por arquivo. A checagem contra o banco real provou que as 5 têm FORCE (o `ALTER TABLE FORCE` estava em outro arquivo/statement que meu grep não capturou). Registrado aqui para não repetir o padrão: **checagem estática de segurança precisa ser validada contra o estado real antes de virar "bug encontrado".**
2. **RBAC é só para gestão de time** (`settings.service.ts` — troca de role, remoção de membro): qualquer membro autenticado do tenant pode executar qualquer outra mutação (deletar pipeline, revogar integração, etc.), sem distinção por papel.

**BUGS_FIXED:** nenhum código foi alterado nesta sprint — não havia bug real de segurança para corrigir (achado #1 foi falso alarme meu, achado #2 é um gap de *produto*, não de *código*, ver abaixo).

**Por que o achado #2 não foi "corrigido" nesta sprint:** `RegrasNegocio.md:98` já documenta isso como `⚠️ LACUNA` conhecida: *"o modelo de permissões granulares (o PRD só cita `role`) não estão definidos."* Não existe spec de qual ação deveria exigir qual papel. Inventar uma matriz de permissões agora seria decidir arquitetura de produto sem aprovação — exatamente o que o `Brief-Finalizacao.md` proíbe ("não construir fora do PRD", "nunca resolva ambiguidade inventando"). Fica registrado como gap real, não fingido como resolvido.

**EXTERNAL_BLOCKERS:** nenhum.

**REMAINING_RISK:**
- RBAC granular ainda não especificado (gap de produto pré-existente, documentado).
- Nenhuma varredura de dependências (`npm audit`/`pnpm audit`) rodada nesta sprint — não incluída no escopo original desta sessão, candidata a próxima sprint de segurança.
- Rate limiting existe (`common/rate-limit.guard.ts`) mas cobertura (quais rotas o usam) não foi mapeada rota-a-rota nesta sprint.

---

## Sprint 3 — Observability & Failure Recovery

**STATUS:** 🟡 GREEN COM BLOCKER EXTERNO (não bloqueia o resto)

**OBJECTIVE:** Correlation-id, logging estruturado, captura de erro, cobertura de falha em filas/IA.

**TESTS / EVIDÊNCIA:**
- `common/correlation.middleware.ts` + `common/request-context.ts`: correlation-id por request, presente em todo log via `JsonLogger` (`common/json-logger.ts`) — formato JSON de uma linha (`time,level,context,correlationId,msg`), pronto pra Loki/CloudWatch/Datadog.
- `common/error-reporter.service.ts`: seam de captura de erro **já wired** no `ProblemDetailsFilter` global (todo erro HTTP não tratado passa por aqui) — loga estruturado com correlation-id hoje; comentário no próprio arquivo mostra exatamente onde `Sentry.captureException` entraria.
- `automations/automations.processor.ts` trata falha de job (retry/DLQ já cobertos nos testes existentes do motor de automação).

**BUGS_FOUND:** nenhum bug — gap de infraestrutura, não de comportamento incorreto.

**EXTERNAL_BLOCKERS:**
1. **`CODE_READY_EXTERNAL_BLOCKER` — Sentry real**: `@sentry/node` não está instalado, `SENTRY_DSN` não está setado. O seam (`ErrorReporter`) já existe e já está no caminho certo (`ProblemDetailsFilter`) — falta só `pnpm add @sentry/node` + `SENTRY_DSN` real + 3 linhas descomentadas no próprio arquivo. Ação humana necessária: fornecer o DSN (conta Sentry).
2. **OpenTelemetry**: não existe nenhum seam ainda (gap real, não é só "falta credencial") — tracing distribuído entre API/worker/DB não está instrumentado. Fica registrado como trabalho futuro genuíno, não blocker externo.

**REMAINING_RISK:** sem tracing distribuído, diagnosticar uma falha que atravessa API → BullMQ worker → provider externo depende só de correlation-id casado manualmente entre logs — funcional, mas manual.

---

## Sprint 4 — Analytics honesto

**STATUS:** 🟢 GREEN

**OBJECTIVE:** Classificar cada métrica do Analytics (REAL/DERIVED_REAL/INSUFFICIENT_DATA/UNAVAILABLE) e corrigir o que for fingido.

**FILES_CHANGED:** `apps/web/app/(app)/analytics/page.tsx` (+`AnalyticsReal`), `apps/api/src/analytics/analytics.service.spec.ts` (novo, 0 testes → 8 testes).

**BUGS_FOUND (real, não hipotético):**
`/analytics` tinha **dois caminhos, nenhum real**: `modoDemo()` verdadeiro → `AnalyticsComDados()` renderizando 100% de `lib/demo/dataset` (incluindo um painel "Insights da IA KHUB" com recomendações que são texto estático, não geradas por IA nenhuma); `modoDemo()` falso → `AnalyticsVazio()` sempre, pra sempre, não importa quantos dados reais o tenant acumulasse. Existia um client `lib/analytics.ts` **completo, tipado, correto** e um backend **honesto** (`AnalyticsService.aiUsage()`/`automacoes()` — sem dado fabricado, `taxaSucesso: null` quando não há amostra) — mas **nada no app chamava esse client**. Confirmado dead code (`grep` não achou nenhum import).

Achado colateral: `NEXT_PUBLIC_KHUB_DEMO` é hard-travado a `false` sempre que `NODE_ENV==='production'` (`lib/demo/flag.ts`) — **cliente real nunca vê dado de demonstração**, então isto não era um risco de confiança do tipo "mostra número fake pro cliente"; era um bug de "funcionalidade real existe e nunca aparece pra ninguém, nem em prod".

**BUGS_FIXED:**
Adicionado `AnalyticsReal()`: busca `analytics.aiUsage()`+`analytics.automacoes()` reais, estados de loading/erro/vazio honestos, mostra só o que tem fonte de dado real hoje (custo/execuções de IA, taxa de sucesso de automação, fila de DLQ) — e **deliberadamente não fabrica** CAC/ROI/receita-por-canal/funil/comparecimento (não existe cálculo definido pra eles no produto; nota explicativa no lugar, sem inventar fórmula).

**TESTS:**
- `analytics.service.spec.ts` (novo, 8/8 verde): cobre tenant vazio (zeros reais, `taxaSucesso: null`), agregação com dado real, e o caso específico "runs 'rodando' não entram no denominador da taxa de sucesso" (70% = 7 concluídas / 10 finalizadas, ignorando 5 rodando) — a mesma conta que a KPI real do frontend usa.
- Funcional (Playwright, tenant novo via signup real): `/analytics` com `NEXT_PUBLIC_KHUB_DEMO=0` → mostra corretamente o estado vazio honesto (`"Ainda não há dados"`), sem selo demo, zero erro de página.
- **Não verificado ao vivo**: o caminho "tenant COM dado real" — consultei o Postgres real e **não existe nenhuma linha em `ai_usage_events` nem `workflow_runs` em nenhum tenant** neste ambiente agora. Coberto pelo teste unitário (que prova a agregação certa), não por screenshot com número real na tela.
- Typecheck ✅ · Lint ✅ · Testes API **275/275** (era 267) ✅ · Build ✅ (dev server parado antes, reiniciado limpo depois).

**EXTERNAL_BLOCKERS:** nenhum.

**REMAINING_RISK:**
- Caminho "tenant com dado real" nunca visto renderizado (só testado por unit test) — risco baixo (mesmo padrão já provado funcionar no Dashboard, mesma estrutura de KpiCard/loading/erro), mas registrado com honestidade.
- CAC/ROI/receita-por-canal/funil/comparecimento continuam sem cálculo real — não é bug, é escopo de produto não definido (não inventei).

---

## Sprints 5–22 (numeração do pedido original)

**STATUS:** ⏸ NÃO INICIADAS NESTA SESSÃO.

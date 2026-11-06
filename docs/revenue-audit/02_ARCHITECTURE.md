# 02 — Arquitetura e status por domínio (ORVYN Revenue OS)

Auditoria somente leitura, 2026-10-14. Nada foi alterado, nenhuma migration foi executada, nenhum teste de banco foi rodado.
Única execução: `tsc --noEmit` em `apps/api` (saída limpa, exit 0), o que contradiz os "2 erros de typecheck" citados em `docs/ORVYN_REVENUE_AUDIT.md` (já corrigidos).

Método: leitura de código, SQL e specs. "Existe código" não foi tratado como "funciona". Nenhum domínio recebe
`PRODUCTION_VERIFIED`, porque não há evidência de execução em produção/staging neste repositório (ver §6).
Afirmações marcadas **[inferido]** vêm de leitura estática, não de execução.

Legenda: PRODUCTION_VERIFIED / FUNCTIONAL_NOT_E2E_VERIFIED (código + testes unitários, sem E2E) / PARTIAL / MOCK_ONLY / BROKEN / MISSING / EXTERNAL_BLOCKER.

---

## 1. Mapa do sistema

### 1.1 Monorepo
- `apps/api` NestJS 10 + Prisma 5.22 (`prisma/schema.prisma`, 1003 linhas, 53 models). Dois entrypoints: `src/main.ts` (HTTP + Socket.IO) e `src/worker.ts` (contexto Nest sem HTTP, `ORVYN_PROCESS_ROLE=worker`). Processors BullMQ só são registrados quando `isWorker()` (`common/queue-connection.ts:12`).
- `apps/web` Next 14 App Router. Proxies: `app/api/v1/[...path]/route.ts` (cookie httpOnly -> Bearer), `app/api/crm`, `app/api/auth/*`, `app/api/agency/*`, `app/api/hooks/[chave]`, `app/api/cerebro`.
- `db/*.sql`: 30 arquivos (000..027 + 001a, 002 teste). Aplicados manualmente com psql/`apps/api/scripts/apply-sql.mjs`. Não há tabela de histórico de migrations (confirmado: nenhum `schema_migrations`).
- `packages/types` (contratos de realtime), `packages/config`.
- `docs/production/` está vazio (sem runbook, sem IaC de deploy). `docker-compose.yml` só cobre Postgres (pgvector pg16) + Redis para dev.

### 1.2 Módulos da API (`apps/api/src`)
| Módulo | Conteúdo real |
|---|---|
| auth | login/signup/refresh rotativo/convite/OAuth (Google, GitHub)/ws-ticket; `JwtAuthGuard`, `PermissionsGuard` (ambos APP_GUARD) |
| tenants | `provision()` (tenant + owner + funil de 5 estágios) |
| agency | `AgencyService` (contexto, clientes, ativar cliente), `AgencyAdminService` (settings, convites de agência) |
| crm | contatos, empresas, deals/pipeline, conversas/mensagens, tarefas, notas, score (`lead-score.ts`), messaging (Stevo, Evolution) |
| automations | workflows + versões, executor de nós, runs, DLQ, triggers, hooks públicos |
| events / realtime | `DomainEventsService` (só empurra para socket; eventos duráveis vêm de triggers SQL da migration 022), gateway Socket.IO `/rt` |
| operations | `OperationsService.reconcile()` a cada 5 s (outbox + runs vencidos), snapshot de saúde |
| integrations | Meta Ads/Leads (OAuth, sync, webhook), `CryptoService` AES-256-GCM |
| nyro / ai | agente com tool-calling fechado; `AIProvider` (Anthropic, OpenAI) |
| rag | chunking, embeddings Voyage, busca híbrida, ingestão in-process |
| settings | perfil, negócio, membros/convites, tags, API keys, audit, notificações |
| analytics, financeiro, agenda, marketplace, blueprints, health | pequenos, tenant-scoped |

### 1.3 Rotas web (`apps/web/app`)
`(marketing)/`; `(auth)/login|signup|agency-invite`; `(app)/dashboard|leads|leads/[id]|contatos|contatos/[id]|empresas|empresas/[id]|pipeline|conversas|inbox|tarefas|agenda|campanhas|automacoes|automacoes/[id]|automacoes/[id]/execucoes|ia|nyro|analytics|marketing|marketing/ads|financeiro|conhecimento|configuracoes|onboarding|agency|agency/clients|agency/clients/[id]|agency/equipe|agency/configuracoes`.
`middleware.ts` lista `/esqueci-senha` e `/redefinir-senha` como públicas, mas **não existe página nem endpoint** para elas (ver ARQ-09).

### 1.4 Banco
- 53 models Prisma. Tabelas com RLS (`tenant_id = current_setting('app.current_tenant_id')`): contacts, deals, stages, pipelines, conversations, messages, activities, users, companies, tasks, notes, workflows*, workflow_runs/steps/dlq/drip, nyro_*, ai_usage_events, integrations, ad_*, audit_logs, webhook_events, outbox_events, meta_pages, api_keys, agenda_compromissos, financeiro_cobrancas, crm_tags, campaigns*, rag_* (modelo próprio), automation_templates (leitura global).
- Tabelas globais **sem RLS** por desenho (ADR-0006): tenants, identities, memberships, refresh_tokens, invites, **agencies, agency_members, agency_client_accounts, agency_member_client_access, agency_invites** (026/027). Isolamento entre agências depende só de filtros na aplicação.
- Funções `SECURITY DEFINER` (owner `orvyn_service`, BYPASSRLS): `auth_lookup_api_key`, `resolve_tenant_by_stevo_instance`, `resolve_tenant_by_evolution_instance`, `resolve_tenant_by_meta_page`, `resolve_workflow_by_webhook_key`. Todas com `SET search_path = public`, `REVOKE ALL FROM PUBLIC`, retornam só o roteamento. Ver 09_SECURITY_RELIABILITY.md.
- Tenant por request: `PrismaService.withTenant()` (`prisma/prisma.service.ts`) abre `$transaction` e roda `set_config('app.current_tenant_id', $1, true)` com UUID validado. No boot de produção a role é checada (`rolsuper`/`rolbypassrls` derrubam o boot).
- Divergência SQL x Prisma: as 4 tabelas de campanha (023) **não existem no `schema.prisma`** (nenhuma ocorrência de `campaign_steps`/`campaign_enrollments`/`campaign_metrics`; só `ad_campaigns`).

### 1.5 Filas e workers
| Fila | Produtor | Consumidor | Observação |
|---|---|---|---|
| `orvyn-maintenance` | scheduler `reconcile` a cada 5 s + jobs `event` | `OperationsProcessor` (concurrency 4) | consome `outbox_events` (stevo/evolution inbound, meta.lead, workflow.hook, eventos de domínio) |
| `automation-steps` | `reconcile()` + `RunsService` | `PassosProcessor` (8) | 4 tentativas, backoff exponencial, `paraDlq` na última falha |
| `automation-triggers` | (ver nota) | `GatilhosProcessor` (8) | `DomainEventsService.publicar` **não enfileira mais** (comentário em `events/domain-events.service.ts:46`); a entrada durável é o outbox SQL |
| `ads-sync` | `AdsSyncService` | `AdsSyncProcessor` | sem retry/DLQ configurados no processor |
| ingestão RAG | `InProcessIngestionQueue` | in-process | fire-and-forget, não durável |
Redis: BullMQ, rate limit (`RedisService`), adapter Socket.IO, heartbeat do worker (`orvyn:worker:heartbeat`, EX 30).

### 1.6 Auth, sessões, orgs, Agency Mode
- Access JWT HS256 15 min (`JWT_ACCESS_TTL`), refresh opaco 30 d, hash sha256 em `refresh_tokens`, rotação com claim atômico (`token.service.ts:62-72`). Cookies httpOnly `orvyn_access`/`orvyn_refresh`, `SameSite=lax`, `secure` em produção (`web/lib/server-auth.ts`).
- A cada request o guard confere `membership` + `tenant.status` no banco (`jwt-auth.guard.ts:60-63`), então rebaixar papel vale na hora (access token não carrega o papel).
- API keys `orv_live_*` (sha256, função SECURITY DEFINER), papel `api` com `scopes`.
- RBAC: papéis owner/admin/manager/member/viewer; permissão derivada do **nome do controller + rota** (`permissions.guard.ts:6-22`), não de decorators por rota.
- Agency Mode: "entrar no cliente" = emitir novo JWT com o `tenant_id` do cliente para a mesma identidade, após upsert de `Membership` (`agency.service.ts:119-157`). Não há impersonation nem segunda camada de tenancy.

---

## 2. Status por domínio

| Domínio | Status | Resumo |
|---|---|---|
| Auth | FUNCTIONAL_NOT_E2E_VERIFIED | funciona e tem specs; faltam reset de senha, verificação de e-mail, 2FA, lockout |
| Orgs/Tenants | PARTIAL | cria tenant, convida, muda papel; **não remove membro**, provisionamento não atômico |
| Agency | PARTIAL | fluxo feliz existe; membro não-admin não consegue ativar cliente [inferido]; sem revogação |
| Leads/Contatos | PARTIAL | contatos reais e paginados; "Leads" na UI é só a lista de contatos; score não está ligado |
| Pipeline | FUNCTIONAL_NOT_E2E_VERIFIED | board real + mover deal; um único funil; carrega todos os deals |
| Oportunidades (deals) | FUNCTIONAL_NOT_E2E_VERIFIED | CRUD + stage + eventos |
| Conversas | PARTIAL | `/inbox` real; `/conversas` MOCK_ONLY; lista sem paginação; canal WhatsApp EXTERNAL_BLOCKER |
| Tarefas | FUNCTIONAL_NOT_E2E_VERIFIED | CRUD, filtros, `take: 200` |
| Agenda | PARTIAL | backend completo; UI de produção mostra só estado vazio |
| Follow-ups | PARTIAL | sem entidade própria; existe via tarefas + drip/espera de resposta em automações |
| Campanhas | MOCK_ONLY (UI) / MISSING (backend) | só tabelas SQL e dados de demo |
| Automações | FUNCTIONAL_NOT_E2E_VERIFIED | motor, DLQ, retry, lease; SSRF fraco no nó webhook |
| IA | PARTIAL | Nyro funcional; `/ia` MOCK_ONLY; RAG BROKEN sob RLS [inferido]; chaves EXTERNAL_BLOCKER |
| Analytics | PARTIAL | só `ai-usage` e `automacoes`; sem receita/atribuição |
| Dashboard | FUNCTIONAL_NOT_E2E_VERIFIED | `crm.overview` real; custo O(deals) |
| Settings | FUNCTIONAL_NOT_E2E_VERIFIED | perfil, negócio, membros, tags, API keys, audit |

### 2.1 Auth — FUNCTIONAL_NOT_E2E_VERIFIED
- Código: `auth/auth.service.ts`, `token.service.ts`, `jwt-auth.guard.ts`, `oauth.service.ts`, `oauth.providers.ts`; web `app/api/auth/*`, `middleware.ts`.
- Rotas: `POST /v1/auth/signup|login|refresh|logout|invites/accept|oauth/callback|ws-ticket`, `GET /v1/auth/me`, `GET /v1/auth/oauth/:provider/url`.
- Tabelas: identities, memberships, refresh_tokens, invites.
- Testes: `auth.service.spec.ts` (189 l), `token.service.spec.ts` (131 l) — unitários com mocks de Prisma.
- Evidência/lacunas: argon2 (`@node-rs/argon2`), rotação atômica, aceite de convite uso único. **Faltam**: reset de senha, troca de senha, verificação de e-mail, 2FA (`twofa_secret` existe no schema e não é lido em nenhum lugar), lockout/throttle específico de login, detecção de reuso de refresh. OAuth sem credenciais responde 501 `config_required` (EXTERNAL_BLOCKER de configuração).

### 2.2 Orgs/Tenants — PARTIAL
- `tenants/tenants.service.ts`, `settings/settings.service.ts` (convites, `changeRole` com lock de linha e proteção do último owner).
- **Faltam**: remover/desativar membro (nenhum `membership.delete` no código), transferir propriedade fora de `changeRole`, deletar tenant. `provision()` faz 3 gravações em transações separadas (ARQ-10).

### 2.3 Agency — PARTIAL
- `agency/*`, web `components/agency/*`, `app/(app)/agency/*`, `app/api/agency/*`. Migrations 026/027. Teste: `agency.service.spec.ts` (202 l, mocks; não há teste SQL de isolamento entre agências, `002_isolation_test.sql` não toca agência).
- O que funciona por leitura: contexto, listagem com métrica por cliente via `CrmService.overview(tenantId)` (tenant-scoped), criação de cliente, ativação com troca de JWT, convite de membro com acesso restrito a clientes (`agency_member_client_access`), aceite público com hash e claim atômico.
- Defeitos: ARQ-01 (RBAC bloqueia ativação por membro não-admin), SEC-02 (sem revogação), N+1 de overview por cliente (SEC-12). Detalhes no arquivo 09.

### 2.4 Leads/Contatos — PARTIAL
- `crm/crm.service.ts` (listContacts por cursor `idx_contacts_cursor`), `leads.service.ts`, `companies.service.ts`, `notes.service.ts`. Web `/contatos`, `/contatos/[id]`, `/leads`.
- `/leads` em produção renderiza `LeadsReal`, que apenas lista `crm.contacts()` (`leads/page.tsx:350-371`); o perfil `/leads/[id]` fora de demo sempre mostra "Lead não encontrado" (`leads/[id]/page.tsx:49-60`).
- `crm/lead-score.ts` (`calcularScore`) tem spec, mas **não é importado por nenhum serviço** (grep). As colunas `score*`, `owner_id`, `proxima_acao_*` (023) existem no Prisma e nunca são escritas. Score = código morto.
- Busca usa `contains/insensitive` sem índice trigram (ARQ-08).

### 2.5 Pipeline e Oportunidades — FUNCTIONAL_NOT_E2E_VERIFIED
- `GET /v1/crm/pipeline`, `POST /deals`, `PATCH /deals/:id/stage`, `PATCH|DELETE /deals/:id`. Web `/pipeline` (746 l) chama `crm.pipeline()`/`crm.moveDeal()`.
- Triggers SQL de referência cross-tenant (022). Único funil por tenant (`pipeline()` lê todos os stages/deals sem filtro). `pipeline()` e `overview()` carregam todos os deals com `include: contact` (ARQ-05).

### 2.6 Conversas — PARTIAL
- `/inbox` real (`crm.conversations()`, `crm.sendMessage`). `/conversas` (584 l) é demo-only: sem `modoDemo()` mostra vazio.
- `CrmService.listConversations` (`crm.service.ts:512`) traz **todas** as conversas com **todas** as mensagens (ARQ-04).
- Envio: reserva idempotente antes de enviar, advisory lock, `unknown` nunca reenvia, opt-out e `lastInboundAt` cancelam (`messaging/messages.service.ts:44-83`). Bom desenho; testado por `messages.service.spec.ts`.
- EXTERNAL_BLOCKER: Stevo/Evolution exigem instância real e QR; `evolution-webhook.controller.ts:9-16` admite que o payload de mensagem nunca foi observado ao vivo. `docs/EVOLUTION_SETUP.md` citado no código **não existe**.

### 2.7 Tarefas — FUNCTIONAL_NOT_E2E_VERIFIED
`crm/tasks.service.ts` (filtros hoje/atrasadas/abertas, `take: 200`), web `/tarefas`. Sem paginação além de 200.

### 2.8 Agenda — PARTIAL
Backend: `agenda/agenda.service.ts` (conflito de horário, horários livres, sync de calendário gated). Migration 021 com RLS.
Web `/agenda` renderiza `demo ? <Calendario/> : <AgendaVazia/>` (`agenda/page.tsx:36`); `web/lib/agenda.ts` existe e nenhuma tela o importa. Resultado: em produção o usuário não vê nem cria compromissos pela UI.
RBAC: `POST /agenda/compromissos` cai no fallback `organization.manage` (só owner/admin) — ARQ-02.

### 2.9 Follow-ups — PARTIAL
Não há entidade nem tela. O equivalente é `tasks` + nós de espera/"esperar resposta"/janela/drip (`automations/*`, specs `esperar-resposta.spec.ts`, `janela.spec.ts`). Campos `proxima_acao_at/tipo` em contacts não são usados.

### 2.10 Campanhas — MOCK_ONLY (UI) / MISSING (backend)
- SQL 023 cria campaigns, campaign_steps, campaign_metrics, campaign_enrollments com RLS+FORCE, mas não há models Prisma, serviço, controller nem job. A própria migration diz que o disparo está desligado.
- Web `/campanhas`: `{demo ? <CampanhasComDados/> : <CampanhasVazio/>}` (`campanhas/page.tsx:40`).
- Não confundir com campanhas de anúncios Meta (`ad_campaigns`, `/marketing/ads`), que são outro domínio (ver Integrações).

### 2.11 Automações — FUNCTIONAL_NOT_E2E_VERIFIED
- `automations/*` (3153 l com specs). Editor ReactFlow (`/automacoes/[id]`, 557 l). Runs com lease/generation/attempts, DLQ (`workflow_dlq`, `POST /automations/dlq/:id/reprocessar`), reconciliador, hooks públicos com Idempotency-Key obrigatório.
- Specs: executor, runs, triggers, janela, esperar-resposta. Sem teste de integração com Redis/Postgres real.
- Defeito: SSRF do nó `acao.webhook` (SEC-04).
- Alerta de capacidade: `reconcile()` percorre todos os tenants ativos a cada 5 s (ARQ-06).

### 2.12 IA — PARTIAL
- Nyro (`nyro/*`): tools fechadas com Zod, aprovação humana, guardrails, auditoria `actor: nyro`, custo em `ai_usage_events`. Specs: guardrails, tools, tool-executor. `NyroService` ainda injeta `AnthropicProvider` direto (a abstração `AIProvider` só vale para `AiService`/automações).
- Permissões: `POST /nyro/*` exige `automations.write`, então `member` e `viewer` não conversam com o Nyro.
- RAG: **BROKEN sob RLS de produção [inferido]** (ARQ-03): `IngestionService`/`IngestionProcessor` usam `this.prisma` sem `withTenant`, e `rag_chunks` não tem policy de escrita. Ingestão in-process, perdida em restart.
- `/ia` é demo-only; sem demo mostra "IA não configurada" (`ia/page.tsx:72`).
- EXTERNAL_BLOCKER: `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` (a ausência degrada limpo para 501/BM25).

### 2.13 Analytics — PARTIAL
Controller com 2 rotas (`/analytics/ai-usage`, `/analytics/automacoes`). A página `/analytics` consome só essas duas em produção; o resto é demo. Não existe endpoint de receita, funil, atribuição, apesar das colunas `contacts.ad_creative_id/ad_campaign_id` (025). Ads: `/ads/overview|campaigns|creatives` reais, dependem de sync Meta (EXTERNAL_BLOCKER: app Meta, app review, `META_APP_SECRET`).

### 2.14 Dashboard — FUNCTIONAL_NOT_E2E_VERIFIED
`/dashboard` usa `crm.overview()` + `crm.tasks('hoje')`. Cálculo em memória sobre todos os deals (ARQ-05).

### 2.15 Settings — FUNCTIONAL_NOT_E2E_VERIFIED
`settings/*`: perfil, negócio, membros/convites (e-mail via Resend/SMTP; sem SMTP volta link manual), tags, API keys, audit (limit 200), notificações derivadas. RBAC por regex de rota (`permissions.guard.ts:9-12`): `GET /settings/business` exige `organization.manage`, logo `member`/`viewer` não leem os dados do próprio negócio.

---

## 3. Problemas de arquitetura

### ARQ-01
- ISSUE: Membro/viewer de agência não consegue "entrar" no cliente: `POST /v1/agency/clients/:id/activate` exige `organization.manage`.
- SEVERITY: P1 (por leitura estática; não executado)
- ROOT CAUSE: `permissionFor` não tem ramo para o controller `agency`; cai no fallback `read ? 'contacts.read' : 'organization.manage'`. `hasPermission` só concede `organization.manage` a owner/admin. Convidado de agência com papel `member` tem `Membership` apenas nos clientes (papel `member`/`viewer`, `agency-admin.service.ts:74-77`), logo toda mutação em `/agency/*` retorna 403 "permissão insuficiente", inclusive a ativação. O próprio `AgencyService` já faz o controle fino (`membroDe`, `clientesVisiveis`).
- FILES: `apps/api/src/auth/permissions.guard.ts:22,26-33`; `apps/api/src/agency/agency.controller.ts:55-61`; `apps/api/src/agency/agency-admin.service.ts:72-86`.
- IMPACT: o fluxo central do Agency Mode só funciona para admins; convites `member`/`viewer` aceitos viram contas que não operam. Nenhum teste cobre guard + controller juntos.
- RECOMMENDED FIX: ramo explícito `agency` em `permissionFor` (`agency.read`/`agency.activate`/`agency.manage`) ou `@SkipPermissions()` no controller delegando ao serviço; revalidar `agency_members.role` no serviço.
- ACCEPTANCE CRITERIA: teste e2e: convidar `member` -> aceitar -> `GET /agency/clients` 200 -> `POST .../activate` 200 só para clientes permitidos e 403/404 para os demais; viewer não ativa/cria.

### ARQ-02
- ISSUE: Mapeamento de permissão por nome de controller produz resultados incoerentes para vários módulos.
- SEVERITY: P2
- ROOT CAUSE: fallback único (`permissions.guard.ts:22`). Consequências verificáveis: `POST|DELETE /agenda/*` só owner/admin; `POST /rag/documents|search` só owner/admin; `GET /financeiro/*` e `/analytics/*` legíveis por `viewer` (contacts.read); `/ads/*` e `/integrations/*` GET só admin; `POST /nyro/*` exige `automations.write` (member/viewer excluídos); `GET /settings/business` só admin.
- FILES: `apps/api/src/auth/permissions.guard.ts:6-33`.
- IMPACT: ou funcionalidade bloqueada para quem deveria usar (agenda, RAG) ou dado financeiro exposto a viewer.
- RECOMMENDED FIX: decorator `@Permission('x.y')` por rota/classe, falhar fechado (negar) quando faltar, e teste que percorre todas as rotas do `Reflector` exigindo permissão declarada.
- ACCEPTANCE CRITERIA: teste enumera todos os handlers e falha se algum não tiver permissão declarada; matriz papel x rota versionada em teste.

### ARQ-03
- ISSUE: Ingestão RAG não grava sob as políticas de RLS da role `orvyn_app` [inferido, não executado contra Postgres].
- SEVERITY: P1
- ROOT CAUSE: (a) `IngestionService.register` e `IngestionProcessor` chamam `this.prisma.ragDocument.*` fora de `withTenant`; com `current_setting` vazio a policy `rag_documents_write` (USING/WITH CHECK `tenant_id = NULLIF(...)::uuid`) nunca é verdadeira. (b) `rag_chunks` só tem policy `FOR SELECT` (`001_rag_schema.sql:176-180`); nenhuma migration posterior cria policy de INSERT/DELETE, e há `FORCE ROW LEVEL SECURITY` (`001a_rls_harden.sql:14`). Escrita em `rag_chunks` pela role da aplicação é negada.
- FILES: `apps/api/src/rag/ingestion/ingestion.service.ts:34,43`; `apps/api/src/rag/ingestion/ingestion.processor.ts:32,62-66,87`; `db/001_rag_schema.sql:176-180`; `db/001a_rls_harden.sql:14`; `apps/api/src/rag/rag.controller.ts:18-33`.
- IMPACT: `POST /v1/rag/documents` retorna 202 e o documento fica `failed`/ausente; base de conhecimento por tenant não popula. Os specs usam mocks e não pegam isso. Os seeds (`seed-rag.mjs`) provavelmente rodam como `orvyn_service` e mascaram o problema.
- RECOMMENDED FIX: envolver tudo em `withTenant(doc.tenantId)`, adicionar policy `FOR ALL` em `rag_chunks` restrita a `escopo='tenant'` e ao tenant, manter publicação global/nicho só pela role de serviço; mover ingestão para BullMQ.
- ACCEPTANCE CRITERIA: teste de integração com Postgres real como `orvyn_app`: registrar documento -> chunks criados -> busca retorna só chunks do tenant; tenant B não vê; `002_isolation_test.sql` ganha caso de INSERT em `rag_chunks`.

### ARQ-04
- ISSUE: `GET /v1/crm/conversations` devolve todas as conversas com todas as mensagens, sem limite.
- SEVERITY: P1 (performance/disponibilidade)
- ROOT CAUSE: `findMany` com `include: { messages }` sem `take`/cursor.
- FILES: `apps/api/src/crm/crm.service.ts:512-523`; consumido por `apps/web/app/(app)/inbox/page.tsx:58,72` (polling).
- IMPACT: payload e memória crescem linearmente com o histórico; a tela repete a chamada (linha 72). Também conta contra o rate limit por tenant.
- RECOMMENDED FIX: listar conversas paginadas por cursor (sem mensagens); mensagens por conversa sob demanda, paginadas.
- ACCEPTANCE CRITERIA: resposta limitada (<=50 conversas, mensagens <=50 por conversa); teste com 10k mensagens mantém p95 < 300 ms.

### ARQ-05
- ISSUE: `overview()` e `pipeline()` carregam todos os deals (com `include: contact`) e agregam em memória.
- SEVERITY: P2
- ROOT CAUSE: sem agregação SQL.
- FILES: `apps/api/src/crm/crm.service.ts:95-128,376-380`; reutilizado por `agency.service.ts:75,92`.
- IMPACT: custo O(deals) por carregamento de dashboard; em Agency, multiplicado por cliente a cada abertura de `/agency`.
- RECOMMENDED FIX: `groupBy`/`SUM` por stage; paginar ou limitar o board por coluna; cache curto.
- ACCEPTANCE CRITERIA: `overview` executa <=5 queries independentes do número de deals; teste de carga com 50k deals.

### ARQ-06
- ISSUE: Reconciliador varre todos os tenants ativos a cada 5 s, com ao menos 1 transação por tenant.
- SEVERITY: P2
- ROOT CAUSE: `upsertJobScheduler('reconcile', {every: 5000})` + `reconcile()` itera `tenant.findMany` paginado e abre `withTenant` por tenant, sem checar se a execução anterior terminou (concurrency 4 da fila).
- FILES: `apps/api/src/operations/operations.service.ts:21,26-57,89-95`.
- IMPACT: custo cresce com nº de tenants, não com trabalho pendente; execuções podem se sobrepor; failed jobs de outbox ficam com `removeOnFail:false` (acúmulo no Redis).
- RECOMMENDED FIX: tabela/índice global de "trabalho vencido" lido por role de serviço, ou LISTEN/NOTIFY; lock de execução única; TTL para jobs falhos.
- ACCEPTANCE CRITERIA: com 1.000 tenants ociosos, `reconcile` faz O(1) queries; duas execuções simultâneas nunca rodam em paralelo.

### ARQ-07
- ISSUE: Eventos `outbox_events` com `status='failed'` (5 tentativas) não têm DLQ, alerta nem reprocessamento; `meta.lead` falho é lead perdido.
- SEVERITY: P2
- ROOT CAUSE: `event()` só marca `failed`; sem endpoint/tela; a role não tem DELETE em `outbox_events` (`GRANT SELECT,INSERT,UPDATE`), logo sem expurgo (crescimento ilimitado).
- FILES: `apps/api/src/operations/operations.service.ts:58-78`; `db/022_production_foundation.sql:38`.
- IMPACT: perda silenciosa de lead/mensagem após falha persistente; tabela sem retenção.
- RECOMMENDED FIX: rota de reprocessamento + métrica/alerta; job de retenção (processed > N dias) por role de serviço.
- ACCEPTANCE CRITERIA: evento forçado a falhar 5x aparece em `GET /operations` e pode ser reenfileirado; retenção documentada e testada.

### ARQ-08
- ISSUE: Busca de contatos por `ILIKE` em 5 colunas sem índice trigram.
- SEVERITY: P3
- ROOT CAUSE: `contains + mode: insensitive`; os únicos índices de `contacts` são `(tenant_id, created_at)`, `(tenant_id, created_at, id)`, company, score e atribuição.
- FILES: `apps/api/src/crm/crm.service.ts:146-153,466`; `db/003_crm_schema.sql:55`; `db/009_crm_f2.sql:81`.
- IMPACT: varredura sequencial por tenant em bases grandes.
- RECOMMENDED FIX: `pg_trgm` GIN em nome/email/telefone normalizado.
- ACCEPTANCE CRITERIA: `EXPLAIN` mostra Bitmap Index Scan para busca por nome em 100k contatos.

### ARQ-09
- ISSUE: Não existe recuperação de senha (rotas listadas como públicas sem implementação), nem troca de senha, nem verificação de e-mail.
- SEVERITY: P2
- ROOT CAUSE: `middleware.ts:14` lista `/esqueci-senha` e `/redefinir-senha`; `apps/web/app/(auth)` só tem login/signup/agency-invite; a API não tem endpoint. `emailVerifiedAt` é gravado e nunca exigido.
- FILES: `apps/web/middleware.ts:14`; `apps/api/src/auth/auth.controller.ts`; `apps/api/src/auth/auth.service.ts:29-40`.
- IMPACT: usuário que esquece a senha fica sem acesso; contas com e-mail não verificado operam normalmente.
- RECOMMENDED FIX: tokens de reset de uso único com expiração + `revokeAllForIdentity` (hoje nunca chamado); exigir verificação onde fizer sentido.
- ACCEPTANCE CRITERIA: fluxo completo testado; após reset, todos os refresh tokens da identidade ficam revogados.

### ARQ-10
- ISSUE: `TenantsService.provision()` não é atômico (tenant, membership e dados do tenant em 3 transações).
- SEVERITY: P2
- ROOT CAUSE: `prisma.tenant.create`, `prisma.membership.create` e `withTenant` separados; falha no meio deixa tenant/membership órfãos (e login usando `isDefault` cai num tenant sem funil/usuário). `signup` também cria `identity` antes.
- FILES: `apps/api/src/tenants/tenants.service.ts:25-50`; `apps/api/src/auth/auth.service.ts:33-39`.
- IMPACT: contas parcialmente criadas; reexecução do signup falha com 409 "e-mail já cadastrado".
- RECOMMENDED FIX: uma transação única (tenant+membership sem RLS e dados com `set_config` na mesma tx) ou compensação.
- ACCEPTANCE CRITERIA: teste injeta falha após `membership.create` e comprova que nada persiste.

### ARQ-11
- ISSUE: Drift de configuração: `config.service.ts` exige `EVOLUTION_BASE_URL`, `env.ts` declara `EVOLUTION_API_URL`; `EVOLUTION_WEBHOOK_TOKEN` e `EVOLUTION_BASE_URL` não estão no schema Zod.
- SEVERITY: P3
- ROOT CAUSE: duas fontes de verdade (`env.ts` vs `ConfigService.REQUIRED`).
- FILES: `apps/api/src/config/env.ts:43`; `apps/api/src/config/config.service.ts:15`; `apps/api/src/crm/messaging/evolution.provider.ts:69`; `evolution-webhook.controller.ts:79`.
- IMPACT: operador configura a variável "errada" (documentada em `env.ts`) e o provedor aparece como não configurado.
- RECOMMENDED FIX: unificar nomes e validar no boot por provedor habilitado.
- ACCEPTANCE CRITERIA: teste de consistência entre `env.ts` e `REQUIRED`.

### ARQ-12
- ISSUE: Campanhas (outbound), score e Leads de primeira classe estão só em SQL/código sem uso.
- SEVERITY: P2 (produto: promessa do Revenue OS não entregue)
- ROOT CAUSE: migration 023 adiantada em relação ao código; models Prisma ausentes; `calcularScore` sem chamador; UI demo-only.
- FILES: `db/023_revenue_os.sql:51-175`; `apps/api/src/crm/lead-score.ts`; `apps/web/app/(app)/campanhas/page.tsx:40`; `apps/web/app/(app)/leads/[id]/page.tsx:49`.
- IMPACT: telas novas são vitrine; `docs/ORVYN_REVENUE_AUDIT.md` classifica várias dessas peças como READY/PARTIAL e isso superestima o estado real.
- RECOMMENDED FIX: ligar score no `LeadsService`/trigger; implementar módulo de campanhas (models, serviço, worker com opt-out e janela); rota `/leads/[id]` apontando para o contato real.
- ACCEPTANCE CRITERIA: criar campanha via API persiste e respeita `opted_out_at`/janela; score preenchido ao criar/atualizar contato; `/leads/:id` abre dado real.

---

## 4. Dívida e riscos operacionais

- Sem registro de migrations aplicadas (`db/README.md` também está desatualizado: diz "ainda não foram executados"). Ordem manual; 026 e 027 têm `agency_invites` só na 027 (Prisma já espera).
- `apps/web` sem nenhum teste (0 arquivos `*.test.*`); API tem 34 specs, cobertura registrada 69% linhas / 51% branches (`src/coverage/coverage-summary.json`, data desconhecida).
- Nenhum teste E2E, nenhum workflow de CI no repositório auditado (não há `.github`/pipeline visível na raiz).
- `docs/production/` vazio; sem runbook de worker/Redis/backup.

## 5. O que é sólido (verificado)
- Todo acesso de dado de negócio passa por `withTenant` (varredura de `this.prisma.<model>.*` fora de `withTenant` só encontrou auth, agency, tenants, rag e o reconciliador).
- `PrismaService.onModuleInit` derruba o boot de produção se a role for superuser/BYPASSRLS.
- Idempotência de mensagens (`messages_idempotency`), outbox com `UNIQUE(tenant_id, dedupe_key)`, triggers anti-referência cross-tenant (022), `audit_logs` imutável por trigger.
- Typecheck da API limpo.

## 6. Limites desta auditoria
Sem Postgres/Redis em execução: RLS, filas e fluxos foram lidos, não exercitados. Nenhum item deve ser promovido a PRODUCTION_VERIFIED sem: migrations aplicadas com `002_isolation_test.sql` verde como `orvyn_app`, e fluxo ponta a ponta (signup -> lead -> deal -> mensagem -> automação) em ambiente com Redis+Postgres reais.

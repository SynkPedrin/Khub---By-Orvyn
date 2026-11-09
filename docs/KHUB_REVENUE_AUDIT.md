# ORVYN Revenue OS — Auditoria do Repositório

> Documento gerado na Fase 0 da transformação `ORVYN OS → ORVYN Revenue OS`.
> Base: `main @ 51edbf0` + working tree com alterações não commitadas (preservadas).
> Data da auditoria: 2026-09-20.

---

## 1. Estado atual

Monorepo **pnpm workspaces + Turborepo**, com dois aplicativos e dois pacotes:

```
Orvyn-OS/
├── apps/
│   ├── api/     NestJS 10 (monólito modular) + Prisma 5 + Postgres/pgvector + BullMQ + Socket.IO
│   └── web/     Next.js 14 (App Router) + Tailwind 3 + React 18 + ReactFlow
├── packages/
│   ├── config/  tsconfig base compartilhado
│   └── types/   contratos TS compartilhados (1 arquivo)
├── db/          23 migrations SQL numeradas, aplicadas via psql
├── docker/      docker-compose: postgres + redis
└── docs/        ENV.md + production/
```

O sistema **não é um protótipo**. É um produto com autenticação real (JWT + refresh
rotativo + OAuth), multi-tenancy com RLS no Postgres, motor de automações com fila,
RAG com pgvector, agente de IA com tool-calling fechado e integração Meta Ads funcional.

**Estado de build no momento da auditoria (baseline, antes de qualquer alteração):**

| Gate | Resultado |
|---|---|
| `pnpm typecheck` @orvyn/web | ✅ limpo |
| `pnpm typecheck` @orvyn/api | ❌ **2 erros pré-existentes** |
| Testes | 28 arquivos `.spec.ts` (100% na API; web sem testes) |

Os 2 erros são anteriores a esta execução, em código **não commitado**:
- `src/automations/hooks.controller.ts:39` — `Record<string, unknown>` não atribuível a `InputJsonValue` do Prisma.
- `src/operations/operations.service.ts:54` — `.call()` inexistente em `IRedisClient`.

---

## 2. Stack atual

| Camada | Tecnologia | Observação |
|---|---|---|
| Runtime | Node >= 20.11 (rodando em v24.20) | pnpm 9.12.3 |
| Monorepo | Turborepo 2.x | tasks: build/dev/typecheck/lint |
| Backend | NestJS 10 | monólito modular, 27 módulos |
| ORM | Prisma 5.22 | **50 models**, schema de 904 linhas |
| Banco | Postgres + pgvector | 23 migrations SQL incrementais |
| Fila | BullMQ + ioredis | worker separado (`worker.ts`) |
| Realtime | Socket.IO + Redis adapter | `events.gateway` |
| Auth | JWT (`@nestjs/jwt`) + argon2 | refresh rotativo, OAuth, convites |
| Validação | Zod 3 + class-validator | Zod já é padrão nas tools da IA |
| Frontend | Next.js 14 App Router | React 18, Server/Client components |
| Estilo | Tailwind 3 + CSS vars | tokens em `globals.css` (512 linhas) |
| Canvas | ReactFlow 11 | editor de automações já existente |
| IA | Anthropic (Claude) | **acoplado**: `AnthropicProvider` injetado direto |
| Testes | Jest + ts-jest | 28 suites, só backend |

---

## 3. Funcionalidades existentes

Legenda: **READY** = funciona e serve ao produto novo · **PARTIAL** = existe, precisa
evoluir · **BROKEN** = quebrado/bloqueante · **MISSING** = não existe.

### Plataforma / Identity

| Funcionalidade | Estado | Nota |
|---|---|---|
| Autenticação e-mail/senha (argon2) | READY | `auth.service.ts` + specs |
| Refresh token rotativo | READY | `token.service.ts` + specs |
| OAuth (provider genérico) | READY | rota `/api/auth/oauth/[provider]/callback` |
| Convites de equipe | READY | model `Invite`, expiração + hash |
| Multi-tenancy (`Tenant` + `Membership`) | READY | identity → N tenants, `isDefault` |
| RLS no Postgres | READY | policies em 16 migrations; teste de isolamento dedicado (`002_isolation_test.sql`) |
| RBAC granular | PARTIAL | `role` string + `permissoes` Json; `permissions.guard.ts` novo e não commitado |
| Audit log | READY | model `AuditLog` com actor/entidade/correlationId |
| Rate limit | READY | `rate-limit.guard.ts` |
| Outbox / eventos de domínio | READY | `OutboxEvent` + `domain-events.service.ts` |

### CRM / Revenue

| Funcionalidade | Estado | Nota |
|---|---|---|
| Contatos (CRUD, tags, campos custom) | READY | model `Contact`, 524 linhas em `crm.service.ts` |
| Empresas | READY | model `Company` |
| Pipeline + Stages + Deals | READY | models + página `/pipeline` (198 linhas) |
| Drag-and-drop no pipeline | PARTIAL | página existe; precisa validar persistência/histórico |
| Tarefas | READY | model `Task` + `tasks.service.ts` |
| Notas | READY | model `Note` |
| Atividades / timeline | READY | model `Activity` |
| **Leads como entidade de 1ª classe** | PARTIAL | existe `leads.service.spec.ts` e `Contact.tag='Lead'`, mas **não há módulo Leads** com listagem, filtros, score e perfil do mockup |
| **Score ORVYN** | MISSING | nenhuma referência no schema ou serviços |
| Agenda / compromissos | PARTIAL | model `AgendaCompromisso` + página (145 linhas), simples |
| Financeiro / cobranças | READY | fora do escopo do nav alvo — **preservar** |

### Communications

| Funcionalidade | Estado | Nota |
|---|---|---|
| Conversas + Mensagens | READY | models `Conversation`/`Message` com `deliveryStatus`, `idempotencyKey`, `providerId` |
| Inbox (UI) | PARTIAL | `/inbox` 238 linhas, estilo WhatsApp; precisa do layout 4-colunas do mockup |
| WhatsApp via Stevo | READY | `stevo.provider.ts` + webhook + specs |
| **Abstração `MessagingProvider`** | MISSING | Stevo está acoplado; não há interface para Meta Cloud/Evolution |
| Instagram / E-mail / Webchat | MISSING | canais previstos no mockup |

### Automation

| Funcionalidade | Estado | Nota |
|---|---|---|
| Workflows + versões | READY | `Workflow`, `WorkflowVersion` |
| Motor de execução | READY | `executor.service.ts` (521 linhas) + specs (278) |
| Runs, steps, DLQ, retry | READY | `WorkflowRun`, `WorkflowRunStep`, `WorkflowDlq` |
| Triggers | READY | `triggers.service.ts` + specs |
| Janela de envio / drip | READY | `janela.spec.ts`, `WorkflowDripCounter` |
| Editor visual (ReactFlow) | READY | `/automacoes/[id]` 557 linhas + 4 componentes |
| Catálogo de blocos | READY | `catalogo.ts` (320 linhas) |
| Nós de IA no fluxo | READY | `AiService` com tarefas classificar/pontuar/resumir/responder/extrair |
| n8n | MISSING | **não existe integração**; motor é próprio (e é bom) |

### AI

| Funcionalidade | Estado | Nota |
|---|---|---|
| Agente com tool-calling | READY | `nyro.service.ts` (379 linhas), loop completo |
| Tool set fechado + Zod | READY | `tools.ts` (243 linhas), 3 níveis de sensibilidade |
| Executor de tools com autorização | READY | `tool-executor.service.ts` + specs |
| Guardrails (anti prompt-injection) | READY | `guardrails.ts` + specs |
| Aprovação humana para ações sensíveis | READY | `NyroAction` + `Sensibilidade='sensivel'` |
| Memória do agente | READY | `NyroMemory` |
| Custo por execução | READY | `AiUsageEvent` + tabela de preços |
| Circuit breaker no provider | READY | `circuit-breaker.ts` + specs |
| RAG (chunking, embeddings, rerank, cache) | READY | módulo completo, pgvector, busca híbrida |
| **Abstração `AIProvider`** | MISSING | **vendor lock-in em Anthropic** — ver §9 |
| UI do Copiloto | PARTIAL | `/nyro` 90 linhas; mockup pede layout rico com painéis de oportunidades/riscos |

### Campaigns / Analytics

| Funcionalidade | Estado | Nota |
|---|---|---|
| **Campanhas** | MISSING | **módulo inteiro inexistente** (nem schema, nem UI) |
| Analytics | PARTIAL | `/analytics` 118 linhas — muito abaixo do mockup (6 KPIs + 6 widgets + insights) |
| Meta Ads (OAuth, sync, insights) | READY | `AdAccount`/`AdCampaign`/`AdSet`/`AdCreative`/`AdInsight`/`AdSyncRun` + connector + specs |
| Marketplace de integrações | READY | `marketplace.service.ts` + specs |

---

## 4. Reutilização — o que será mantido

Praticamente **todo o backend**. Esta é a maior descoberta da auditoria: a engenharia
de domínio existente é sólida e não deve ser reescrita.

**Mantido sem alteração:**
- Toda a camada de auth/identity/tenants/RLS.
- Motor de automações inteiro (executor, runs, DLQ, triggers, janela, drip).
- Loop de agente, guardrails, tool executor, aprovação humana, `AiUsageEvent`.
- Módulo RAG completo.
- Integração Meta Ads e marketplace.
- Financeiro, marketplace, blueprints, realtime, outbox.
- As 28 suites de teste.
- As 23 migrations existentes (nenhuma será reescrita ou revertida).

**Mantido e reaproveitado com nova casca visual:**
- `/pipeline`, `/inbox`, `/automacoes/[id]` (ReactFlow), `/agenda`, `/analytics`,
  `/configuracoes`, `/contatos` — a lógica e o data-fetch ficam; muda a apresentação.
- `lib/crm.ts`, `lib/automations.ts`, `lib/nyro.ts`, `lib/agenda.ts`, `lib/analytics.ts`
  — clientes de API já existentes, reutilizados pelos módulos novos.

---

## 5. Refatoração — o que precisa mudar

| # | Item | Motivo |
|---|---|---|
| R1 | **Design system** (`globals.css` + `tailwind.config.ts`) | Identidade atual é glassmorphism + "studio-bg" com gradientes, radius 24px, off-white quente `#f8f6f2`. O alvo é flat, cool grays `#FAFAFC/#F7F7FA`, radius 8–16, sombras quase nulas. Conflito direto com o briefing ("evitar glassmorphism exagerado, gradientes agressivos, radius excessivo"). |
| R2 | **Shell global** (`(app)/layout.tsx`) | Hoje: sidebar de vidro flutuante + "dynamic island" + logo no topo-centro + TopRight separado. Alvo: sidebar fixa branca com logo ORVYN Revenue OS + rodapé de plano, e topbar única com busca `⌘K` + notificações + avatar + workspace. |
| R3 | **Navegação** | Hoje 12 itens (Dashboard, Pipeline, Contatos, Empresas, Tarefas, Inbox, Automações, Agenda, Anúncios, Biblioteca, Financeiro, Análises). Alvo: 10 itens (Dashboard, Leads, Pipeline, Conversas, Automações, Campanhas, Agenda, Analytics, IA, Configurações). |
| R4 | **`AiService` → `AIProvider`** | Injeção direta de `AnthropicProvider` cria vendor lock-in. Extrair interface (`generate`/`stream`/`structuredOutput`/`toolCall`) + registry de providers. |
| R5 | **Nomenclatura Nyro → ORVYN AI** | Marca do produto novo. Rota `/nyro` → `/ia`, mantendo alias. |
| R6 | **`Contact` → Lead com score** | Adicionar `score`, `scoreVersion`, `scoreAt`, `ownerId`, `origem`, `cargo`, `proximaAcaoAt` — sem quebrar `Contact` existente. |
| R7 | **Dashboard** | Hoje 279 linhas genéricas; alvo é dashboard de receita (KPIs de leads/resposta/follow-up/receita + funil + crescimento + insights de IA). |
| R8 | **Analytics** | 118 linhas → 6 KPIs + receita por canal + funil + tempo de resposta por equipe + meta vs realizado + evolução + leads por status + insights. |
| R9 | **Copiloto de IA** | 90 linhas → layout do mockup (chat + top oportunidades + negócios em risco + leads sem resposta + automações para disparar). |

---

## 6. Remoção — o que deve deixar de existir

Muito pouco. A estratégia é **preservar**.

| Item | Ação | Justificativa |
|---|---|---|
| `studio-bg`, `.glass`, `.crystal-edge`, `--cristal-*` | Remover do design system | Conflitam diretamente com a direção visual exigida. |
| `DynamicIsland`, `TopCenterLogo` | Aposentar do shell | Substituídos pela topbar única. Arquivos podem ser removidos após migração. |
| Diretórios `_to_delete/`, `_backup-completo-antes-do-reset/`, `_front-antes-de-reverter/` (fora do repo git, na pasta-mãe) | **Não tocar nesta execução** | São backups do usuário. Remoção é decisão dele. |
| Módulos fora do nav alvo (Financeiro, Empresas, Tarefas, Marketing/Ads, Conhecimento) | **NÃO remover** | São funcionalidades reais e testadas. Decisão: realocá-los como sub-navegação/Configurações, preservando rotas. Removê-los destruiria valor sem ganho. |

---

## 7. Novos módulos

| Módulo | Escopo |
|---|---|
| **Design System** (`lib/design`/tokens) | colors, spacing, radius, typography, shadow, border, motion, breakpoints, z-index |
| **Shell** (`components/shell/`) | `Sidebar`, `Topbar`, `GlobalSearch`, `WorkspaceMenu`, `PlanCard` |
| **Leads** | `/leads` (listagem com KPIs, filtros, tabela, painel lateral) e `/leads/[id]` (perfil 8 tabs) |
| **Score ORVYN v0** | motor determinístico de regras (`score_version = "v0_rules"`) |
| **Campanhas** | schema (`campaigns`, `campaign_steps`, `campaign_metrics`) + `/campanhas` |
| **`AIProvider`** | interface + `AnthropicProvider` adaptado + registry |
| **`MessagingProvider`** | interface + `StevoProvider` adaptado |
| **Demo/seed** | seed explicitamente separado de dados de produção |

---

## 8. Dívida técnica encontrada

| # | Item | Severidade |
|---|---|---|
| D1 | 2 erros de TypeScript na API (§1) bloqueiam `typecheck` | **Alta** — build gate |
| D2 | `apps/web` sem nenhum teste | Média |
| D3 | `automacoes/[id]/page.tsx` com 557 linhas e `configuracoes/page.tsx` com 486 | Média — componentes gigantes |
| D4 | `crm.service.ts` com 524 linhas | Média |
| D5 | `.DS_Store` versionado em várias pastas | Baixa |
| D6 | `packages/types` com um único arquivo — pacote subutilizado | Baixa |
| D7 | Nomenclatura mista PT/EN no schema (`nome`/`titulo` vs `createdAt`) | Baixa — consistente internamente, não mexer |
| D8 | `tsconfig.tsbuildinfo` (152 KB) versionado em `apps/web` | Baixa |
| D9 | Migrations aplicadas por `psql` direto, sem ferramenta de migration com histórico | Média — funciona, mas sem registro de aplicação |

---

## 9. Segurança

**Pontos fortes encontrados** (acima da média para um produto neste estágio):

- RLS habilitado em 16 migrations, com suite de teste de isolamento dedicada.
- Tool set da IA **fechado**: o modelo só recebe tools declaradas; nome alucinado é recusado.
- Três níveis de sensibilidade (`leitura`/`escrita`/`sensivel`) com aprovação humana.
- Guardrails anti prompt-injection: contexto entra como `<dados aviso="...">`, nunca como instrução.
- A IA **não escreve no banco** — só chama serviços do CRM, com as mesmas validações e auditoria (`actor:'nyro'`).
- Segredos de integração criptografados (`crypto.service.ts` + spec).
- Circuit breaker no provider de LLM.
- Rate limit guard.
- Audit log com `correlationId`.

**Riscos identificados:**

| # | Risco | Severidade |
|---|---|---|
| S1 | **Vendor lock-in de IA**: `AnthropicProvider` injetado diretamente em `AiService` e `NyroService`. Indisponibilidade ou mudança de preço do fornecedor atinge o produto inteiro sem caminho de escape. | Alta (arquitetural) |
| S2 | `.env.local` presente no diretório do repositório — verificar se está coberto pelo `.gitignore` e se não há credencial em histórico. | Alta |
| S3 | `permissions.guard.ts` existe mas **não está commitado** — RBAC pode não estar aplicado em todas as rotas. | Média |
| S4 | Migrations sem controle de aplicação: risco de divergência entre ambientes. | Média |
| S5 | Web sem testes → regressões de autorização no frontend passam sem rede de proteção. | Média |

O detalhamento e as ações vão para `/docs/SECURITY_REVIEW.md`.

---

## 10. Plano de transformação — ORVYN OS → ORVYN Revenue OS

### Mapa EXISTENTE → DESTINO

| ORVYN OS (hoje) | ORVYN Revenue OS (alvo) | Estratégia |
|---|---|---|
| `/` Dashboard genérico | `/` Dashboard de Receita | Refatorar |
| `/contatos` | `/leads` + `/leads/[id]` | Expandir (contatos preservado como alias) |
| `/pipeline` | `/pipeline` | Reveste |
| `/inbox` | `/conversas` | Reveste + alias |
| `/automacoes` | `/automacoes` | Reveste |
| — | `/campanhas` | **Criar** |
| `/agenda` | `/agenda` | Reveste |
| `/analytics` | `/analytics` | Expandir |
| `/nyro` | `/ia` | Reveste + renomear + alias |
| `/configuracoes` | `/configuracoes` | Expandir |
| `/empresas`, `/tarefas`, `/financeiro`, `/marketing`, `/conhecimento` | mantidos fora do nav principal | **Preservar** |
| `Tenant` | `Organization` (conceito) | **Manter `tenantId`** — renomear tabela seria migration destrutiva sem ganho real |
| `AnthropicProvider` direto | `AIProvider` + registry | Refatorar |
| `stevo.provider.ts` direto | `MessagingProvider` + `StevoProvider` | Refatorar |
| glass/island/studio-bg | design system flat ORVYN | Substituir |

### Decisões arquiteturais tomadas nesta auditoria

1. **`tenantId` permanece.** O briefing pede "prefira `organization_id`, dependendo do
   padrão existente". O padrão existente é `tenant_id`, presente em 40+ tabelas, em todas
   as policies RLS e em todo o código. Renomear seria uma migration de alto risco e custo
   zero de benefício. `Organization` passa a ser o termo de **produto** (UI, docs);
   `tenant` segue como termo **técnico**.

2. **Não adotar n8n.** O briefing diz "se n8n já estiver integrado, usar como engine".
   Não está — e o motor próprio (`executor.service.ts` + runs + DLQ + retry + janela +
   drip, com testes) é melhor que introduzir uma dependência de infraestrutura agora.
   O adapter de execução fica preparado para um backend alternativo no futuro.

3. **Preservar módulos fora do nav alvo.** Financeiro, Empresas, Tarefas, Marketing/Ads
   e Conhecimento são funcionalidades reais e testadas. Removê-los para "limpar o menu"
   destruiria valor. Ficam acessíveis, fora da navegação primária.

4. **Migrations incrementais.** Nada de reset. Toda evolução de schema entra como nova
   migration numerada, aditiva (colunas nullable / novas tabelas).

### Ordem de execução

1. Design system (tokens) — base de tudo.
2. Shell global (sidebar + topbar + navegação).
3. Migration aditiva (score, campos de lead, campanhas).
4. Módulos, na ordem: Dashboard → Leads → Lead profile → Pipeline → Conversas →
   Automações → Campanhas → Agenda → Analytics → IA → Configurações.
5. `AIProvider` + `MessagingProvider`.
6. Score ORVYN v0.
7. Demo seed separado.
8. Hardening + testes + build gate.
9. Documentação final.

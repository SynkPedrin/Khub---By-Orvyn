# 📊 ORVYN OS — Status do Projeto

> Última atualização: **2026-07-27** · Fonte de verdade técnica: `Nyro IA/cerebro/` (ADRs, Tasks, Banco).
> **Resumo em uma frase:** o produto está construído, verde e buildando para produção — **só falta plugar as credenciais (APIs) e fazer o deploy.**

---

## ✅ Prova de saúde (rodada nesta sessão)

| Verificação | Resultado |
|---|---|
| Testes da API (`jest`) | **229/229 passando** (28 suítes) |
| Typecheck API + Web (`tsc`) | **OK** |
| Lint (`next lint`) | **limpo** (1 warning pré-existente, não bloqueante) |
| Build de produção (API `nest build` + Web `next build`) | **OK** — todas as rotas compilam |
| Isolamento cross-tenant (RLS) | **OK — sem vazamento** (teste real em Postgres) |
| Código | zero `TODO`/stub/placeholder |

**Stack:** Next.js 14 (App Router) · NestJS 10 · PostgreSQL 16 + pgvector · Prisma · Redis + BullMQ · TypeScript strict. Monorepo pnpm + Turborepo.

---

## 1. ✅ Funciona de ponta a ponta — **NÃO depende de nenhuma API**

### CRM
- Contatos (CRUD, perfil 360, paginação por cursor), Empresas, Negócios/Deals, Tarefas, Notas.
- **Pipeline** drag-and-drop com atualização otimista e tempo real.
- Busca global (⌘K) sobre dados reais.

### Automações (motor completo)
- Editor visual React Flow (drag-and-drop, ilha de opções, painel por nó, autosave, publicar/pausar/rollback).
- Motor event-driven: 1 job = 1 nó, espera por delay, **retry exponencial + DLQ + reprocessar**, idempotência.
- **28 nós** (7 gatilhos · 7 controle · 14 ações), congelados com validação Zod.
- Execuções ao vivo (timeline nó-a-nó), teste com contato real.
- **Marketplace** de templates + **binding de variáveis** na instalação (`{{var.X}}` → valores do tenant).

### Nyro (IA) — *lógica pronta, execução precisa da chave Anthropic*
- Orquestrador multi-agente (roteador Haiku + 4 sub-agentes Sonnet), 18 tools tipadas.
- Configuradora: cria funil/etapas, instala automações, aplica blueprints.
- Human-in-the-loop (ações sensíveis pedem aprovação) · guardrails em 2 camadas (CFM/OAB/CFC).
- Chat full-page + dock flutuante compartilhando a mesma lógica.

### RAG
- Busca híbrida (vetorial + lexical BM25) com fallback automático.
- Isolamento por tenant + bases global/nicho.

### Configurações
- Perfil, Empresa, Equipe & permissões (convites), Personalização/white-label (logo, fundo, cor, tema).
- **Tags** do CRM (nome + cor).
- **Private Integrations (API keys reais)** — chaves `orv_live_…` que autenticam sistemas externos na API, com hash + RLS + função `SECURITY DEFINER`.
- Auditoria (log imutável de toda mutação).

### Financeiro
- Cobranças (criar, marcar paga/cancelada, KPIs de recebido/a receber/vencido). *Local e real; só o link de pagamento precisa da Stripe.*

### Agenda
- Compromissos (criar/confirmar/concluir/cancelar), **prevenção de choque de horário**, **sugestão de horários livres**. *Local e real; só a sincronização precisa do Google Calendar.*

### Análises (Analytics)
- **Custo de IA por tenant** (USD, tokens, por agente/modelo/dia), desempenho de automações (taxa de sucesso, DLQ).

### Biblioteca
- Automações prontas (marketplace) + toda a base de conhecimento (frameworks de marketing/vendas/operação + nichos), com botão "Como usar isso na minha empresa?" → Nyro.

### Onboarding
- Página que aplica **blueprints por nicho** (funil + etapas + automações reais) — sem API.

### Auth & Infra
- Login (e-mail/senha) + refresh + convites · tempo real (Socket.IO, sala por tenant, Redis adapter).
- Multi-tenancy por **RLS no Postgres** (`orvyn_app` sem BYPASSRLS), testado.

### Blindagem de produção (P4)
- **Rate limit por tenant/IP** (Redis, fail-open) · **security headers** (helmet-equivalente) · **CORS allowlist**.
- **Health check** com db + redis · **circuit breaker** (Anthropic, Voyage, Meta) · **observabilidade** (correlation-id, logs JSON, ErrorReporter pronto p/ Sentry).

### Deploy kit
- `Dockerfile` da API + `Dockerfile` do Web (standalone) + `.dockerignore`.
- **CI** (`.github/workflows/ci.yml`): lint · typecheck · testes · build · **gate de isolamento RLS**.
- Runner de migração rastreado (`schema_migrations`, idempotente).

---

## 2. 🔌 Funciona, mas espera credencial — degrada com `config_required`

Tudo abaixo **já está implementado**. Sem a variável, a UI mostra "Conectar {provider}" e a API responde `501 {code:"config_required", missing:[...]}` — nada é simulado.

| Feature | Variável(is) de ambiente | Onde obter |
|---|---|---|
| **Nyro** (raciocínio, onboarding conversacional, nó de IA) | `ANTHROPIC_API_KEY` | console.anthropic.com |
| **WhatsApp** (inbox, disparos, automações de mensagem) | `STEVO_API_URL`, `STEVO_API_KEY`, `STEVO_INSTANCE` | painel STEVO |
| **Busca semântica** (RAG com embeddings) | `VOYAGE_API_KEY` | voyageai.com |
| **Meta Ads / Lead Ads** | `META_APP_ID`, `META_APP_SECRET` | developers.facebook.com |
| **Pagamentos** (link Stripe no Financeiro) | `STRIPE_SECRET_KEY` | dashboard.stripe.com |
| **Google Calendar** (sync da Agenda) + **Login Google** | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | console.cloud.google.com |
| **Login GitHub** | `GITHUB_ID`, `GITHUB_SECRET` | github.com/settings/developers |
| **E-mail** (convites, nó de e-mail) | `SMTP_URL` (`SMTP_FROM` opcional) | seu provedor SMTP |
| **Cripto de credenciais OAuth** | `INTEGRATIONS_ENCRYPTION_KEY` | **você gera** (32 bytes base64) |
| **Erros no Sentry** *(opcional)* | `SENTRY_DSN` | sentry.io |
| **Google Ads / TikTok Ads** *(catálogo, roadmap)* | `GOOGLE_ADS_*`, `TIKTOK_*` | painéis respectivos |

> Obrigatória sempre (não é API externa): `JWT_SECRET` (≥16 chars) e `DATABASE_URL`. Detalhe completo em `docs/ENV.md` e `apps/api/.env.example`.

---

## 3. ❌ O que ainda falta (fora de credencial)

- **Ads write real** — criar/editar campanha direto na Meta. Hoje o gerenciador de anúncios é um **simulador** (dados locais). A escrita real **depende do OAuth da Meta conectado** — é a última peça e genuinamente precisa da API. Quando a Meta for plugada, troca-se o simulador pela escrita real.
- **Google Calendar `events.insert`** — a Agenda funciona local e gateia a sincronização; o push real de eventos precisa do OAuth do usuário concluído (depende da credencial Google).
- **Google Ads / TikTok Ads** — aparecem no marketplace de integrações como "em breve"; conectores ainda não escritos (roadmap, dependem das APIs).

*Nenhum item acima bloqueia subir para operação — todos são incrementos que dependem das APIs correspondentes.*

---

## 4. 🔑 Checklist de APIs que faltam (para operação plena)

**Essenciais para o MVP (WhatsApp + IA):**
- [ ] `ANTHROPIC_API_KEY` (+ crédito na conta) — liga a Nyro
- [ ] `STEVO_API_URL` / `STEVO_API_KEY` / `STEVO_INSTANCE` — liga o WhatsApp
- [ ] `INTEGRATIONS_ENCRYPTION_KEY` — gerar (obrigatória para OAuth)

**Marketing & vendas:**
- [ ] `META_APP_ID` / `META_APP_SECRET` — Meta Ads + Lead Ads + Ads write
- [ ] `VOYAGE_API_KEY` — busca semântica do RAG

**Financeiro & agenda:**
- [ ] `STRIPE_SECRET_KEY` — cobranças com link de pagamento
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google Calendar + login Google

**Autenticação social & e-mail (opcionais):**
- [ ] `GITHUB_ID` / `GITHUB_SECRET` — login GitHub
- [ ] `SMTP_URL` — envio de e-mail

**Observabilidade (opcional):**
- [ ] `SENTRY_DSN` — captura de erros

---

## 5. 🚀 Como subir para operação

1. **Infra:** Postgres 16 (+ pgvector) e Redis 7 (ex.: `docker-compose.yml` já provê os dois localmente).
2. **Migrações:** aplicar `db/*.sql` em ordem numérica (via `psql` no CI, ou `node apps/api/scripts/apply-sql.mjs` para as novas) — rastreadas em `schema_migrations`.
3. **Build:** `docker build -f apps/api/Dockerfile -t orvyn-api .` e `docker build -f apps/web/Dockerfile -t orvyn-web .`
4. **Env:** preencher `apps/api/.env` (ver seção 4 + `docs/ENV.md`).
5. **Deploy** e apontar o healthcheck para `GET /v1/health` (reporta db + redis).
6. **CI** já roda a cada push: lint · typecheck · testes · build · isolamento RLS.

---

## 6. 🐞 Bugs conhecidos

| ID | Descrição | Status |
|---|---|---|
| BUG-003 | Inbox: Enter/z-index do botão de envio | **corrigido** |
| BUG-007 | Busca híbrida do RAG (função SQL) | **corrigido** |
| BUG-008 | Voyage 3 RPM sem método de pagamento | aberto — **ação do operador** (adicionar pagamento) |

Demais bugs históricos (BUG-001, 004, 009–014): **corrigidos**.

---

## 7. 🧩 Módulos (backend `apps/api/src/`)

`auth` · `tenants` · `crm` (+ `messaging`/inbox) · `automations` · `nyro` · `rag` · `integrations` · `marketplace` · `blueprints` · `financeiro` · `agenda` · `analytics` · `settings` · `ai` · `realtime` · `events` · `config` · `common` · `prisma` · `health`.

Cada tabela de negócio tem `tenant_id NOT NULL` + RLS + policy `tenant_rw` + teste de isolamento.

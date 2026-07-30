# ESTADO ATUAL — ORVYN OS

> Inventário da **Fase 0** (auditoria de baseline não destrutiva), verificado contra o sistema rodando em 2026-07-18.
> Baseline: **194 testes / 23 suítes verdes** · cobertura global **71,9% statements · 54,1% branches**.
> *(Fase 0 fechou com 154/20 e 68,5%/51,0%; D-01 e D-03 foram quitadas antes da Fase 1 — ver §4.)*
> Fonte da verdade do produto: `Nyro IA/cerebro/`. Este arquivo é um retrato de engenharia, não substitui o cérebro.

---

## 1. Como ler este documento

| Status | Significado |
|---|---|
| ✅ **Pronto** | Código completo, testado e verificado end-to-end contra Postgres/Redis reais |
| 🔑 **Gated** | Código completo e testado; falta **só a credencial**. Responde `config_required` nomeando a variável |
| ⚠️ **Não verificado** | Código existe, mas nunca rodou contra o serviço externo real |
| ❌ **Não existe** | Stub "em breve" ou ausente |

---

## 2. Inventário por módulo

### ✅ Auth & multi-tenant
- **Arquivos:** `auth/{auth.service,auth.controller,token.service,jwt-auth.guard,decorators}.ts`, `tenants/`
- **Faz:** signup, login, refresh rotativo (hash), convite com aceite de uso único, ticket de WebSocket (60s), guard global
- **Cobertura:** ✅ **72% st / 58% br** (`token.service` 100%) — D-01 quitada antes da Fase 1
- **Verificado:** RLS provada em 15 blocos (`db/002`); convite → aceite → tenant certo; reuso do token → 400

### ✅ CRM Core
- **Arquivos:** `crm/{crm.service,crm.controller,crm-f2.controller,companies,tasks,notes,leads,telefone}.ts`
- **Faz:** contatos (CRUD + perfil 360 + cursor), empresas, negócios, tarefas, notas, pipeline, busca global
- **Cobertura:** ⚠️ **43% st / 28% br** (`tasks` 9%, `notes` 17%) — ver D-02
- **Verificado:** todas as escritas exercitadas na auditoria; `db/009`; BUG-009 e BUG-012 com regressão

### ✅ Inbox / mensageria
- **Arquivos:** `crm/messaging/{messages.service,stevo.provider,stevo-webhook.controller}.ts`
- **Faz:** conversas, histórico, recebimento por webhook (idempotente), roteamento instância→tenant
- **Cobertura:** ✅ **100% st / 95% br** (`messages.service`) — D-03 quitada antes da Fase 1
- **Envio:** 🔑 gated em `STEVO_API_URL` + `STEVO_INSTANCE` (mensagem **persiste**, entrega fica pendente)

### ✅ Automações (F4)
- **Arquivos:** `automations/{catalogo,executor,runs,triggers,workflows,hooks.controller,automations.processor}.ts`
- **Faz:** 21 nós, canvas React Flow, versionamento com rollback, execução real (espera/retry/DLQ), reentrada, janela de envio, webhook de entrada
- **Cobertura:** 69% st / 60% br · `workflows.service` e `triggers.service` sem spec (D-04)
- **Verificado:** fluxo real ponta a ponta; BUG-010/011 com regressão; `db/010`, `db/011`

### ✅ Tempo real
- **Arquivos:** `realtime/{events.gateway,realtime.service,redis-io.adapter}.ts`
- **Cobertura:** ✅ **97,7% st / 100% br** — o melhor do sistema
- **Verificado:** isolamento cross-tenant provado com dois sockets reais

### ✅ RAG
- **Arquivos:** `rag/` (retrieval, embeddings, ingestion, reranker, cache)
- **Faz:** busca híbrida (vetor + BM25 por RRF), 73 chunks com embedding, fallback lexical sem Voyage
- **Cobertura:** ✅ 92,7% st / 85,7% br
- **Verificado:** busca real devolvendo resultado; BUG-007 com regressão

### 🔑 Nyro IA
- **Arquivos:** `nyro/{tools,agentes,guardrails,nyro.service,tool-executor,anthropic.provider}.ts`
- **Faz:** roteador + 4 sub-agentes, 14 tools tipadas, human-in-the-loop, guardrails 2 camadas, custo por tenant
- **Cobertura:** 84,7% st / 86,7% br (tools e guardrails); `nyro.service` e `tool-executor` sem spec (D-05)
- **Estado:** 🔑 gated em `ANTHROPIC_API_KEY` · ⚠️ **nunca rodou contra a API real**

### 🔑 Integrações / Ads
- **Arquivos:** `integrations/` (meta connector, graph client, crypto, ads sync, meta leads)
- **Cobertura:** 95% no core / 55% nos providers
- **Estado:** 🔑 gated em `META_APP_ID/SECRET` · ⚠️ OAuth nunca executado contra o Facebook

### ✅ Configurações
- **Arquivos:** `settings/`
- **Faz:** perfil, empresa, equipe, permissões, auditoria (imutável), notificações, personalização
- **Cobertura:** sem spec dedicado (D-06) · e-mail 🔑 gated em `SMTP_URL`

### ❌ Não existe
| Área | Situação |
|---|---|
| **Agenda** (`/agenda`) | Stub. **Zero backend.** Maior buraco de produto — é o coração do nicho piloto |
| **Financeiro** (`/financeiro`) | Stub. Depende de Stripe (Sprint C) |
| **Google Ads / TikTok** | Não iniciado (Sprint B) |
| **Analytics real** | Dashboards com dados do CRM; "insights da Nyro" ainda são texto fixo |
| **Produção** | Sem CI/CD, deploy, rate limit, Sentry, backup (Sprint H) |

---

## 3. Credenciais: o que está plugado

| Variável | Estado | Efeito de estar ausente |
|---|---|---|
| `JWT_SECRET`, `DATABASE_URL` | ✅ | fatal no boot (correto) |
| `VOYAGE_API_KEY` | ✅ | RAG cairia para BM25 |
| `STEVO_API_KEY` | ✅ | — |
| `INTEGRATIONS_ENCRYPTION_KEY` | ✅ | — |
| `STEVO_API_URL`, `STEVO_INSTANCE` | ❌ | mensagem grava, **entrega pendente** |
| `ANTHROPIC_API_KEY` | ❌ | Nyro em 501 `config_required` |
| `META_APP_ID/SECRET` | ❌ | "Conectar Meta" em 501 |
| `SMTP_URL` | ❌ | convite volta com link manual |
| `STRIPE_*`, `GOOGLE_ADS_*`, `TIKTOK_*` | ❌ | módulos não existem ainda |

---

## 4. Mapa de dívida técnica

Priorizado por **risco × esforço**. Detalhe e severidade em `Nyro IA/cerebro/Bugs.md` (D-01…D-08).

| # | Dívida | Risco | Esforço |
|---|---|---|---|
| ~~D-01~~ | ~~`auth` com 21% de branches~~ → **quitada**: 27 testes, `token.service` a 100% st | ✅ | — |
| **D-02** | `crm`: `tasks.service` 9%, `notes.service` 17%, 0% de branches | 🟠 médio | baixo |
| ~~D-03~~ | ~~`messages.service` 13,8% / 0% br~~ → **quitada**: 13 testes, 100% st / 95% br | ✅ | — |
| **D-04** | `workflows.service` e `triggers.service` sem spec (validação de publicação e match de gatilho) | 🟠 médio | médio |
| **D-05** | `nyro.service` e `tool-executor` sem spec — o loop de tools e o HITL não têm teste próprio | 🔴 alto | médio |
| **D-06** | `settings.service` sem spec (permissões e convites passam por aqui) | 🟠 médio | baixo |
| **D-07** | Sem rate limit e sem circuit breaker (invariante 6 não atendido) | 🔴 alto | médio |
| **D-08** | Migrações sem tabela de controle (`schema_migrations`) — ordem é manual e não auditável | 🟠 médio | baixo |

### Não são dívida (verificado)
- **16 `any`** — todos em fronteira de dado externo (`$queryRaw`, payload da Graph API, webhook do STEVO), onde o tipo é desconhecido por natureza. Aceitável pela regra 6.
- **`invites`, `memberships`, `refresh_tokens` sem RLS** — decisão consciente do **ADR-0006** (infra de auth não carrega dado de negócio).
- **Mutações sem `@Body`** — rotas que legitimamente não recebem corpo (`publicar`, `toggle`, `cancelar`).
- **Duplicação de `brl()` front/back** — 3 linhas de formatação de moeda; extrair custaria mais do que resolve.
- **Zero `console.log`** em produção; nenhum segredo em log; schema Prisma válido.

---

## 5. Incidente encontrado e estancado nesta fase

**BUG-014 — RLS não protegia a partição de `ad_insights`.**
A tabela-pai tem RLS, mas no Postgres a policy **não vale** para quem consulta a partição direto: `SELECT * FROM ad_insights_default` como `orvyn_app`, **sem contexto de tenant**, devolvia 14 linhas.

Nada vazou pela API (a aplicação sempre consulta a tabela-pai) — mas isso fazia a *aplicação* virar a 1ª camada de isolamento, exatamente o que o invariante 1 proíbe.

Corrigido em `db/014_rls_particoes.sql` (RLS + FORCE + policy em toda partição, reexecutável para partições futuras) e coberto por regressão no `db/002` (bloco 15), que agora **falha** se qualquer partição nascer sem RLS.

> Rompi a regra "Fase 0 não corrige" de propósito: o CLAUDE.md classifica vazamento cross-tenant como **incidente de LGPD, não bug**. Estancar veio antes do protocolo.

---

## 6. Baseline para as próximas fases

```
Testes .................. 194 verdes / 23 suítes   (era 154/20 na Fase 0)
Cobertura ............... 71,9% st · 54,1% br
Migrações ............... 15 arquivos · 42 tabelas
Isolamento .............. 15 blocos verdes (db/002)
Rotas da API ............ 14 controllers
Páginas do front ........ 19 (3 stubs: agenda, financeiro, nyro)
```

**Regra:** nenhuma fase pode entregar com menos de 154 testes verdes.

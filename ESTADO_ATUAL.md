# ESTADO ATUAL — KHUB OS

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
A tabela-pai tem RLS, mas no Postgres a policy **não vale** para quem consulta a partição direto: `SELECT * FROM ad_insights_default` como `khub_app`, **sem contexto de tenant**, devolvia 14 linhas.

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

---

## 2026-11-09 — Acabamento visual (bordas + luz) e fix de Ads

A pedido do Pedro (referência: desigualOS dark), com a decisão "claro, mas com bordas e luz":
- **Tokens claros** (`globals.css`): bordas mais nítidas (`--border/--edge` 0.12→0.17, fortes 0.20→0.28, `--lg-edge*` idem), sombras com toque roxo da marca (`--sh-surface*`, `--lg-shadow`).
- **Cards**: filete de luz no topo (gradiente branco) + nova sombra.
- **Ambiente**: véu branco mais leve, vazamentos roxo/lima mais presentes + 3º feixe violeta no topo direito.
- **Shell**: sidebar/topbar com sombra roxa de flutuação; sidebar com divisórias (marca/grupos/rodapé) e classe `sidebar-shell`; item ativo com tint e glow de marca.
- **Gráficos**: glow `feDropShadow` na linha principal de receita (`revenue/charts.tsx`); sparklines já tinham.
- **NICO**: orbe viva (blob morph + estrela balançando + halo), wordmark maior no header de `/nyro`.
- **Fix BUG-027** (API): sync de Ads fazia rede dentro de transação Prisma (timeout 5s) → sempre falhava. Rede movida para fora da transação; verificado com sync real (8 contas, 10 campanhas, 398 insights).
- **Logos oficiais dos canais** (`public/logos/*.webp`: meta, instagram, whatsapp, google-ads, tiktok, youtube): `BrandLogo` passa a usar os arquivos oficiais para essas marcas (SVGs artesanais removidos; demais marcas seguem em SVG). `CanalBadge` (leads, pipeline, conversas, campanhas) mostra a logo real de WhatsApp/Instagram/Google Ads. Badges de conexão da página de Ads exibem a logo do provider.
- **`/campanhas` com dados reais**: a tela era 100% demo (`CampanhasVazio` em modo real) e quem conectava a Meta não via nada. Agora o modo real mostra a seção "Campanhas de anúncios" (logo Meta, KPIs de 30d, tabela de campanhas, link p/ Marketing → Ads) quando há campanhas sincronizadas; o aviso de prospecção fica abaixo, contextualizado. Validado: dados do Studio da Beleza existem no banco (R$586, 7 campanhas, meta ok).
- **Inbox real recebendo WhatsApp** (BUG-028): body parsing manual no `main.ts` (webhooks 100mb com rawBody; upload 22mb; resto padrão) — o parser global do Nest (100kb) rodava antes dos app.use e matava webhooks com mídia; parte chegava urlencoded. Dra. Bárbara: 6 → 55 mensagens, 14 conversas.
- **Estado vazio do Inbox honesto**: se o WhatsApp já está conectado (stevo_api/evolution/whatsapp status=connected), não mostra mais "Conectar WhatsApp" — explica que a conversa aparece quando o primeiro cliente escrever.

---

## 2026-11-09 — Migração GHL → KHUB (preparação da virada)

Estado encontrado: tags do Studio já importadas (9/9); workflows do GHL recriados como rascunho (5 fiéis + MetaAds Tagging ativo); IA do GHL da Bárbara ("Julia"/Carol) existia só no tenant Orvyn IA.

Preparado hoje:
- **Carol** copiada para o tenant Dra. Bárbara Lopes — ativa, NÃO-padrão (teste seguro, não responde conversa nenhuma sozinha).
- **Ritinha** criada no Studio da Beleza a partir das evidências reais do GHL (custom values: preços, políticas, follow-ups, assinatura) + ferramentas de agenda (no GHL ela só encaminhava; aqui agenda de verdade). Ativa, NÃO-padrão.
- **5 workflows fiéis ao GHL pré-validados** com a validação de publicação (21/6/2/3/2 nós, todos válidos).
- `scripts/operar/virada-ghl.mjs`: dry-run mostra o plano; `--aplicar` publica os 5 fluxos, pausa as 2 duplicatas simplificadas e torna Ritinha/Carol padrão. **Só rodar com o GHL desligado** (senão cliente recebe em dobro).
- `scripts/operar/validar-virada.mjs`: revalida os rascunhos antes da virada.

Virada: usuário testa as agentes ao vivo (Agentes → testar no WhatsApp, contato de teste) → desliga GHL → rodar virada-ghl.mjs --aplicar.

---

## 2026-11-13 — Consolidação das 5 sessões paralelas

- **Saúde da árvore:** tsc API+Web limpos · **jest 1.172 verdes** (95 suítes) · vitest 179/179 · lint limpo.
- **Fotos de perfil + atribuição de lead (066) fechadas:** `OrigemFotoController` registrado no `CrmModule` (estava importado, fora do array — rotas 404); regra `origemAtualizada` promove placeholder de canal para "Meta Ads" etc. quando o toque é confirmado/provável, sem nunca sobrescrever origem específica; E2E 20/20 (`scripts/qa/e2e-origem-foto.mjs`).
- **SIM-5:** simulações do Gerenciador persistem na subconta (`db/067`, RLS, teto de 50); endpoints `/v1/ads/simulador/simulacoes`; tela usa API com espelho offline. E2E 9/9.
- **Neon (produção):** 066, 067 e 068 aplicadas + registradas no ledger; isolamento 066/067/068 verde em produção.
- **Render:** `FIRECRAWL_API_KEY` e `NICO_PROVEDOR=anthropic` configuradas.
- **Repo público:** histórico reescrito (force push) — telefone de teste removido de todos os commits.
- **Importação GHL → Neon retomada** (tinha morrido no contato 750 por falta da 066).

---

## 2026-11-13 — VIRADA GHL → KHUB concluída (IA e automações do GHL desligadas)

- **Pré-virada:** `validar-virada.mjs` pegou nó órfão (`acao.atribuir_usuario` sem usuário e sem arestas, resto da importação) no rascunho "Notificação Interna 🔔 (importado do GHL)" — removido (6 → 5 nós), revalidado. Os 5 fluxos fiéis válidos.
- **Virada aplicada** (`virada-ghl.mjs --aplicar`): publicados Novo Lead 🚀 v14, Notificação Interna 🔔, Agendamento Confirmado 📅, Disparo de Mensagem📨 e Resposta na Dm; pausadas as 2 duplicatas simplificadas; MetaAds Tagging segue ativo.
- **Ritinha** (Studio) e **Carol** (Dra. Bárbara) agora são agentes **padrão** do WhatsApp (ativas).
- Conversas antigas seguem em atendimento "humano" — só conversas novas caem na IA; para devolver uma conversa específica: `atendimento.devolverParaIa`.
- Pendente de observação: primeira conversa real respondida pela Ritinha/Carol.

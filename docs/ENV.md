# ENV — fonte única das credenciais do ORVYN OS

> Contrato (Brief §2 · **Gating por Credencial**): **todo módulo está implementado**. O que falta para uma
> feature externa funcionar é **a chave**, nunca código. Sem a chave, a API responde
> `501 { code: "config_required", provider, missing: [...] }` (ou degrada com fallback) e a UI mostra
> **"Configurar {provider}"** com exatamente as variáveis desta tabela.
>
> **Canário:** subir a API com todas as variáveis de terceiros vazias **não pode quebrar nada**
> (`apps/api/src/config/config.service.spec.ts`).

Quem manda: `apps/api/src/config/config.service.ts` (`REQUIRED` por provedor). Este documento e aquele
mapa devem sempre concordar — se divergirem, **o código está errado**.

---

## 1. Obrigatórias (a API não sobe sem elas)

| Variável | Onde obter / gerar | Observação |
|---|---|---|
| `JWT_SECRET` | `openssl rand -base64 48` | ≥16 chars. Assina access token **e** o `state` do OAuth. |
| `DATABASE_URL` | Postgres local/gerenciado | Role da app = `orvyn_app` (**NOBYPASSRLS**). Nunca aponte a app para `orvyn_service`. |

Sem `DATABASE_URL` válida a API **sobe assim mesmo** e `/v1/health` reporta `db:false` (dev sem banco).

## 2. Infra opcional (tem default)

| Variável | Default | Para quê |
|---|---|---|
| `PORT` | `3333` | Porta da API. |
| `REDIS_URL` | `redis://localhost:6379` | Filas BullMQ (`ads-sync`, ingestão). |
| `WEB_URL` | `http://localhost:3210` | Base dos redirects OAuth e do link de convite. |
| `JWT_ACCESS_TTL` | `15m` | TTL do access token. |
| `REFRESH_TTL_DAYS` | `30` | TTL do refresh (rotativo, hasheado). |
| `SENTRY_DSN` | — (sem Sentry) | sentry.io → criar projeto Node → DSN. Sem ela, `ErrorReporter` só loga estruturado (correlation-id); com ela, todo erro não tratado também vai pro Sentry — achado da auditoria de produção: o código já existia (`error-reporter.service.ts`), só faltava chamar `Sentry.init()`. |

## 3. Provedores externos — o que cada um destrava

Cada bloco lista o **conjunto mínimo**: com ele completo, o provedor sai de `config_required` e opera de verdade.

### 3.1a `evolution` — WhatsApp (self-hosted, CANAL_MVP)
| Variável | Obrigatória | Onde obter |
|---|---|---|
| `EVOLUTION_BASE_URL` | ✅ | URL da sua instância Evolution self-hosted (ex.: `https://evolution.seudominio.com`). |
| `EVOLUTION_API_KEY` | ✅ | Chave GLOBAL do servidor Evolution (dona da instância — não confundir com o token por-instância, que a própria Evolution devolve em `/instance/create` e fica cifrado em `integrations.credentials_encrypted`). |

**Sem elas:** `config_required` ao tentar conectar um número; nenhuma instância é criada.
**Risco operacional (não é só config):** Evolution usa o protocolo do WhatsApp Web (Baileys), não a Cloud API oficial da Meta — número pode ser banido a qualquer momento, fora do controle do Orvyn. Ver auditoria de produção.

### 3.1 `stevo` — WhatsApp (API não oficial)
| Variável | Obrigatória | Onde obter |
|---|---|---|
| `STEVO_API_URL` | ✅ | URL base da sua instância STEVO (ex.: `https://api.stevo.chat`). |
| `STEVO_API_KEY` | ✅ | Painel STEVO → API key. |
| `STEVO_INSTANCE` | ✅ | Nome da instância conectada ao número. |
| `STEVO_SEND_PATH` | — | Default `/message/sendText`. |
| `STEVO_WEBHOOK_TOKEN` | — | Se definido, o webhook de entrada exige `?token=`. **Defina em produção.** |
| `STEVO_FALLBACK_TENANT_ID` | — | Dev single-tenant: roteia a entrada quando a instância ainda não tem integração conectada. Em produção o roteamento é `instância → tenant` (migration 008). |
| `STEVO_TEST_NUMBER` | — | **Obrigatória para enviar fora de produção.** Toda saída (Inbox, automações, Nyro, agentes) vai para este número, nunca para o telefone do contato. Sem ela, a mensagem é gravada como `bloqueado_dev` e não sai (doc 18, B-3). Proibida em produção. |
| `STEVO_REVENUE_API_KEY` | — | Chave da **API de gestão** da Stevo (`stevo_sk_…`, `https://openapi.stevo.chat/v1`). Precisa ser de conta (sem restrição de instância) para webhook de conta. Escopos mínimos: `instances:read/write`, `messages:send/read`, `webhooks:read/write`. Ainda não lida pelo código (Fase 3). |
| `STEVO_API_BASE_URL` | `https://openapi.stevo.chat` | Base da API de gestão da Stevo. |
| `STEVO_WEBHOOK_SECRET` | — | Segredo `whsec_…` do webhook de conta (devolvido uma vez na criação; o script `scripts/operar/stevo.mjs webhook` grava aqui sem exibir). Sem ele o webhook responde 401. |
| `STEVO_WEBHOOK_SECRET_PREVIOUS` | — | Segredo anterior durante a rotação (`rotate-secret`). Remover após o overlap. |
| `GHL_MIGRATION_LOCATION_ID` | — | Location do cliente no GHL para a extração de migração (não é segredo). |
| `GHL_MIGRATION_TOKEN` | — | Token do GHL de **uso único** para extrair dados de migração (ADR-0031). Nunca usado em runtime; revogar no GHL e apagar após a migração. |

**Sem elas:** a mensagem **é gravada** e aparece no inbox; só a entrega fica pendente
(`status: "config_required"` + `missing[]`, HTTP **200** — ADR-0008). Nada se perde.

### 3.2 `meta` — Meta Ads + Lead Ads
| Variável | Obrigatória | Onde obter |
|---|---|---|
| `META_APP_ID` | ✅ | developers.facebook.com → seu app → Configurações. |
| `META_APP_SECRET` | ✅ | mesmo lugar. |
| `META_GRAPH_VERSION` | — | Default `v21.0`. |
| `META_WEBHOOK_VERIFY_TOKEN` | — | Token que você inventa e repete no painel da Meta (webhook de Lead Ads). |

Redirect a cadastrar no app: `{WEB_URL}/api/integrations/meta/callback`.
**Sem elas:** `GET /v1/integrations/meta/auth-url` → 501 `config_required`; a UI mostra "Configurar Meta Ads".

### 3.3 `google_ads`
`GOOGLE_ADS_DEVELOPER_TOKEN` ✅ · `GOOGLE_ADS_CLIENT_ID` ✅ · `GOOGLE_ADS_CLIENT_SECRET` ✅ ·
`GOOGLE_ADS_LOGIN_CUSTOMER_ID` — · `GOOGLE_OAUTH_REDIRECT_URI` —
Developer token: Google Ads API Center (conta MCC).

### 3.4 `tiktok`
`TIKTOK_APP_ID` ✅ · `TIKTOK_APP_SECRET` ✅ — TikTok for Business → Marketing API.

### 3.5 `stripe` — billing (DOIS fluxos, UMA conta Stripe)
| Variável | Obrigatória | Onde obter |
|---|---|---|
| `STRIPE_SECRET_KEY` | ✅ | dashboard.stripe.com → Developers → API keys. |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Developers → Webhooks → endpoint `{API_URL}/v1/webhooks/stripe` → "Signing secret". **Sem ela, NENHUM evento é processado** (nem cobrança de cliente nem assinatura da plataforma confirmam sozinhas — fica preso em "enviada"/"incompleta" até alguém marcar na mão). |
| `STRIPE_PUBLISHABLE_KEY` | — | Só se o front precisar do Stripe.js diretamente; hoje o checkout é 100% hospedado (redirect), não usa. |
| `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_GROWTH` / `STRIPE_PRICE_SCALE` | — (mas sem ela aquele plano específico não vende) | Price ID de cada plano da **assinatura do Orvyn** (Products → criar o preço → copiar `price_...`). Preço em si é decisão de negócio, nunca hardcoded — ver PRD §17 (LACUNA de pricing). |

Dois fluxos pela mesma chave/webhook, diferenciados por `metadata.kind` no evento (nunca inferido):
- **`financeiro_cobranca`** — o tenant cobrando OS CLIENTES dele (`/v1/financeiro`, checkout `mode=payment`).
- **`orvyn_subscription`** — o tenant pagando o Orvyn (`/v1/billing`, checkout `mode=subscription`).

### 3.6 `voyage` — embeddings do RAG
| Variável | Obrigatória | Onde obter |
|---|---|---|
| `VOYAGE_API_KEY` | ✅ | dash.voyageai.com (**exige meio de pagamento**: sem ele, 3 RPM / 10K TPM → 429). |
| `VOYAGE_MODEL` | — | Default `voyage-3-large`. |
| `VOYAGE_DIMS` | — | Default `1024`. **Mudar exige reindexar** (a coluna é `vector(1024)`). |

**Sem ela (fallback funcional):** a busca do RAG degrada para **lexical/BM25** (`rag_search_lexical`,
migration 007) — mesmo filtro de escopo e RLS, sem vetor. Continua respondendo; a qualidade cai.

### 3.7 `anthropic` — Nyro (chat/agente)
`ANTHROPIC_API_KEY` ✅ — console.anthropic.com. Sem ela, as rotas da Nyro respondem 501 `config_required`.

### 3.8 `email` — convites e transacionais
| Variável | Obrigatória | Onde obter |
|---|---|---|
| `SMTP_URL` | ✅ | `smtps://usuario:senha@smtp.host:465`. Gmail: use **App Password** (a API key `AIzaSy…` do painel **não envia e-mail**). |
| `SMTP_FROM` | — | Default `Orvyn OS <no-reply@orvyn.app>`. |

**Sem ela:** o convite **é criado e auditado**; o link de aceite volta na resposta para envio manual.

### 3.9 `oauth_google` / `oauth_github` — login social
`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` · `GITHUB_ID` + `GITHUB_SECRET` (+ `AUTH_SECRET`).
Sem elas, os botões existem mas a rota responde 501 explicando o que falta — **nunca** login fake.

### 3.9a `google_calendar` — sincronização de agenda
`GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` (mesmo app OAuth do login social, escopo adicional de Calendar).
Sem elas: agenda funciona só dentro do Orvyn, sem sincronizar com o Google Calendar do usuário.

### 3.10 `integrations_crypto` — cifra das credenciais dos clientes
| Variável | Obrigatória | Como gerar |
|---|---|---|
| `INTEGRATIONS_ENCRYPTION_KEY` | ✅ | `openssl rand -base64 32` (**exatamente 32 bytes**) |

Cifra AES-256-GCM os tokens OAuth de cada tenant em repouso. Sem ela, **nenhuma** integração conecta (501).
**Trocar a chave invalida tudo que já foi cifrado** — rotação exige re-conexão dos clientes.

## 4. Ajustes do RAG (opcionais, com default)

`RAG_TOPK_VECTOR`=50 · `RAG_PRE_RERANK`=30 · `RAG_TOPN_RERANK`=8 · `RAG_RRF_K`=60 ·
`RAG_MIN_SCORE`=0.35 · `RAG_CACHE_TTL`=3600 · `RAG_EMBED_BATCH`=96

> Mexeu em chunking/embedding/prompt? Rode `rag:eval` e reporte o delta (invariante 6 do CLAUDE.md).

## 5. Regras que não se negociam

1. **Segredo nunca vai pro código, pro log ou pro git.** `.env` está no `.gitignore`; commite só `.env.example`.
2. A app conecta como `orvyn_app`. `orvyn_service` (BYPASSRLS) é só para migração/publicação de base.
3. Variável **vazia conta como ausente** — `ConfigService.get()` trata `""` e `"   "` como não definida.
4. Adicionou provedor novo? Atualize **`REQUIRED` no ConfigService _e_ este arquivo** no mesmo PR.

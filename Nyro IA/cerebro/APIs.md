# APIs e Contratos — Orvyn

> REST versionada (`/v1`) + WebSocket para tempo real. Transcrição fiel do PRD §13. Ver [[PRD]] · [[Arquitetura]] · [[Banco]].

---

## 1. Princípios
- REST versionada em `/v1` + **WebSocket** para tempo real (inbox, Kanban, execução de automação ao vivo).
- Documentação **OpenAPI pública** para a API de parceiros.
- **Autenticação:** JWT curto + refresh token; **API keys por tenant** para integrações externas.
- Todos os **webhooks de saída assinados (HMAC)** e com retry.
- **Erros padronizados (RFC 7807)** e `correlation-id` em toda requisição.

---

## 2. Rotas de exemplo (do PRD §13, literal)

```
POST  /v1/auth/signup                    # cria conta
POST  /v1/tenants/:id/provision          # aplica blueprint do template
GET   /v1/pipelines
POST  /v1/deals
PATCH /v1/deals/:id/stage
GET   /v1/conversations/:id/messages
POST  /v1/messages
POST  /v1/workflows
POST  /v1/workflows/:id/publish
GET   /v1/workflows/:id/runs
POST  /v1/nyro/chat                       # conversa com o agente (SSE/stream)
POST  /v1/nyro/actions/:id/approve        # aprova ação pendente da IA
POST  /v1/rag/documents                   # upload de conhecimento do tenant
POST  /v1/webhooks/:provider              # entrada de Meta/Stripe/WhatsApp
GET   /v1/analytics/kpis?periodo=30d
```

---

## 3. Contratos por fase

### F0 — Fundação (esta fase)
Rotas necessárias ao critério de aceite de F0 (conta criada + isolada). Payloads a definir no Bloco 3 com Zod; assinatura mínima abaixo.

| Método | Rota | Descrição | Auth |
|---|---|---|---|
| `POST` | `/v1/auth/signup` | Cria conta (tenant + primeiro user). E-mail/senha ou Google. | pública |
| `POST` | `/v1/auth/login` | Login, retorna JWT curto + refresh. | pública |
| `POST` | `/v1/auth/refresh` | Renova access token via refresh token. | refresh token |
| `POST` | `/v1/auth/google` | OAuth Google (callback/troca de code). | pública |
| `GET`  | `/v1/auth/me` | Usuário + tenant do contexto. | JWT |
| `POST` | `/v1/tenants/invites` | Convida membro de equipe. | JWT (role) |
| `POST` | `/v1/tenants/invites/:token/accept` | Aceita convite. | pública (token) |
| `GET`  | `/v1/audit-logs` | Lista logs de auditoria do tenant. | JWT (role) |

> ⚠️ LACUNA: O PRD lista `POST /v1/auth/signup` mas **não define os payloads** (campos, validações) de nenhuma rota, nem os enums de `role`, `status`, `plano`. A definir com Zod no Bloco 3 e documentar aqui a cada rota implementada. `login`, `refresh`, `google`, `me`, `invites` **não estão no PRD** — são derivados necessários de auth ([[PRD]] §11.1 cita "Login, OAuth Google, sessões JWT + refresh, convites de equipe"); registrados aqui como decorrência direta, não invenção de escopo.

### ✅ Implementado (FASE 1 — verificado)
| Método | Rota | Auth | Payload |
|---|---|---|---|
| POST | `/v1/auth/signup` | pública | `{email, password(>=8), nome, empresa?, nicho?}` → `{access, refresh, user}` |
| POST | `/v1/auth/login` | pública | `{email, password}` → `{access, refresh, user}` |
| POST | `/v1/auth/refresh` | refresh | `{refresh}` → novos `{access, refresh}` (rotativo) |
| POST | `/v1/auth/logout` | pública | `{refresh}` → revoga |
| GET | `/v1/auth/me` | JWT | `{email, nome, role, tenant, memberships}` |
| POST | `/v1/auth/oauth/callback` | pública | 501 até configurar OAuth |
| GET | `/v1/tenants/me` | JWT | tenant do JWT |
| CRM `/v1/crm/*` | — | **JWT** | tenant vem do token (não mais `x-tenant-id`) |

Front (Next, cookies httpOnly): `POST /api/auth/{signup,login,refresh,logout}`, `GET /api/auth/me`, proxy `/api/crm/*` (Bearer). Ver [[Arquitetura]] ADR-0006.

### ✅ Implementado (Sprint A — Integrações/Ads; exige JWT, tenant do token)
| Método | Rota | Nota |
|---|---|---|
| GET | `/v1/integrations` | conexões do tenant + health |
| GET | `/v1/integrations/:provider/auth-url` | inicia OAuth (400 se `META_APP_ID`/cripto ausentes) |
| POST | `/v1/integrations/:provider/callback` | **público**; state HMAC carrega o tenant; cifra credencial + enfileira sync |
| POST | `/v1/integrations/:id/sync` | enfileira sync (BullMQ) |
| GET | `/v1/ads/overview` · `/campaigns` · `/creatives` | agregados por tenant; melhor criativo |
| GET/POST | `/v1/webhooks/meta` | **público**; verify + ack idempotente |

Front (Next): proxy autenticado `/api/v1/*` (Bearer) + landing OAuth `/api/integrations/meta/callback`. Ver [[Arquitetura]] ADR-0007.

### Fases seguintes (referência — não implementar em F0)
- `POST /v1/tenants/:id/provision` — aplica blueprint (F2).
- CRM: `GET /v1/pipelines`, `POST /v1/deals`, `PATCH /v1/deals/:id/stage` (F1).
- Inbox: `GET /v1/conversations/:id/messages`, `POST /v1/messages` (F1).
- Automações: `POST /v1/workflows`, `POST /v1/workflows/:id/publish`, `GET /v1/workflows/:id/runs` (F4).
- Nyro: `POST /v1/nyro/chat` (SSE/stream), `POST /v1/nyro/actions/:id/approve` (F3).
- RAG: `POST /v1/rag/documents` (F3).
- Webhooks: `POST /v1/webhooks/:provider` — Meta/Stripe/WhatsApp (F5), idempotentes.
- Analytics: `GET /v1/analytics/kpis?periodo=30d` (F1+).

---

## 4. Padrão de erro (RFC 7807)

Todo erro segue `application/problem+json`:

```json
{
  "type": "https://orvyn.dev/errors/validation",
  "title": "Erro de validação",
  "status": 422,
  "detail": "Campo 'email' inválido.",
  "instance": "/v1/auth/signup",
  "correlationId": "<uuid>"
}
```

- `correlation-id` propagado em header (`X-Correlation-Id`) e no corpo do erro.
- Validação de entrada em toda rota (Zod / class-validator).

---

## 5. Autenticação e segurança de API
- JWT de acesso **curto** + refresh token (rotação recomendada — decidir TTLs no Bloco 3).
- API keys por tenant para integrações externas (escopo por chave).
- Webhooks de saída assinados via HMAC; retry com backoff.
- Rate limiting por tenant e por integração ([[RegrasNegocio]]).

> ⚠️ LACUNA: TTL do access/refresh token, formato/algoritmo de assinatura JWT (HS256 vs RS256), rotação de refresh e revogação não estão no PRD. Definir no Bloco 3 e registrar ADR se estrutural.

---

## 6. Tempo real (WebSocket)
Canais previstos ([[PRD]] §10.3): inbox, Kanban, execução de automação ao vivo.

> ⚠️ LACUNA: protocolo (Socket.IO vs WS nativo do Nest), formato de mensagens e autenticação do socket não definidos. Fora do escopo de F0; definir em F1.

# APIs e Contratos — KHUB

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
| GET | `/v1/integrations/avec` | estado da agenda do Avec (conectado, saúde, erro, última sincronização) — ADR-0052 |
| PUT | `/v1/integrations/avec` | dono/admin: `{email, senha, ssoId, salaoId, slug}` → testa o login e grava cifrado; devolve o mapa de profissionais Avec→KHUB (senha nunca volta) |
| POST | `/v1/integrations/avec/sincronizar` | sincroniza agora (hoje + 60 dias) e devolve o resumo `{dias, criados, atualizados, adotados, cancelados, conflitosIa, semProfissional, falhas}` |
| GET | `/v1/ads/overview` · `/campaigns` · `/creatives` | agregados por tenant; melhor criativo |
| GET | `/v1/redes/instagram/publico?conexaoId&dias(7–28)` | público e descoberta do Instagram: `{conectado, conexaoId, periodoDias, publico{idade,genero,cidades,paises,status}, seguidores{ganhos,perdidos,status}, cliquesPerfil{total,botoes,status}, alcancePorFormato{fatias,status}, alcancePorRelacao{fatias,status}}`; cada `status` = SecaoStatus de Redes (sem_permissao/token/limite/sem_dados com o que falta). Fonte: IG User Insights (`follower_demographics` timeframe=this_month; `follows_and_unfollows`, `profile_links_taps`, `reach` com breakdown). Leitura `contacts.read`, módulo `automacoes`. 400 conexaoId inválido. |
| POST | `/v1/ads/simulador/simular` | simulador de campanhas: `{objetivo, orcamentoDia(6–100000), dias(1–90), publico, posicionamento, ticketMedio, taxaFechamento, criativos[1–3]{nome, formato, hook, copy, titulo, cta, videoSegundos?, legendas?, rosto?, textoNaImagem?, notaVisualIa?}, premissas?{cpm,ctr,conversao}}` → totais com faixa p10–p50–p90, série diária, notas por criativo com motivos, A/B, curva de verba, alertas, base usada e calibração (ad_insights 90d do tenant). 400 corpo inválido. |
| POST | `/v1/ads/simulador/analisar` | análise do criativo com IA: `{objetivo, criativo, negocio?, imagens[0–4]{tipo, base64, rotulo}}` (corpo até 22 MB) → `{notaVisual, resumo, pontosFortes, melhorias, hooksAlternativos, copySugerida, riscosPolitica, modelo, provedor, analisouImagem}`. 501 `config_required` sem provedor de IA; 502 `ia_invalida` se a IA não devolver JSON válido em 2 tentativas. |
| GET/POST | `/v1/webhooks/meta` | **público**; verify + ack idempotente |

Front (Next): proxy autenticado `/api/v1/*` (Bearer) + landing OAuth `/api/integrations/meta/callback`. Ver [[Arquitetura]] ADR-0007.

### ✅ Implementado (Configurações — perfil/empresa/equipe/auditoria; JWT)
| Método | Rota | Nota |
|---|---|---|
| GET/PATCH | `/v1/settings/profile` | nome, idioma, **prefs** (personalização cor/fundo/tema) |
| GET/PATCH | `/v1/settings/business` | empresa: nome, endereço, telefone, website, idioma, nicho |
| GET | `/v1/settings/members` | membros (memberships+identities) + convites pendentes |
| POST | `/v1/settings/invites` | cria convite + **link de aceite** (`/signup?invite=<token>`); e-mail requer OAuth2/SMTP |
| DELETE | `/v1/settings/invites/:id` | revoga convite |
| PATCH | `/v1/settings/members/:identityId/role` | muda papel (owner/admin/member/viewer) |
| PATCH | `/v1/settings/members/:identityId/modulos` | acesso por módulo (ADR-0045): `{modulos: string[] \| null}`; `null` tira a restrição; 400 para owner/admin. `POST /invites` aceita `modulos` opcional; `GET /members` devolve `modulos` (null = sem restrição) em membros e convites; `GET /auth/me` devolve `modulos` efetivo. Rota de módulo bloqueada → 403 `você não tem acesso a este módulo` |
| GET | `/v1/settings/audit` | **audit_logs** imutável — histórico de todas as ações |

Toda mutação de settings grava em `audit_logs` (`actor_id` = identidade). Front: `/configuracoes` (abas Perfil, Personalização, Empresa, Equipe, Integrações, Auditoria) + canto superior direito (usuário/config/tema).

### ✅ Implementado (Sprint 0 — gating, convite, busca, notificações; JWT salvo onde indicado)
| Método | Rota | Nota |
|---|---|---|
| POST | `/v1/auth/invites/accept` | **público** (o token é a credencial): entra no tenant do convite com a role dele; uso único; auditado. ADR-0009 |
| GET | `/v1/crm/search?q=` | busca global do ⌘K: contatos + negócios + conversas, sob RLS (fecha BUG-004) |
| GET/POST | `/v1/settings/notifications` · `.../read` | derivadas do estado real (não lidas + integrações quebradas); "visto" em `users.prefs.notifsSeenAt` |

**Gating por credencial (ADR-0008):** rota que só existe para chamar terceiro responde **501** `{ code:"config_required", provider, missing:[…] }`. Quando a parte local já teve efeito, responde **200 + estado gated** (ex.: `POST /v1/crm/conversations/:id/messages` → `{status:'config_required', missing:[…]}` com a mensagem **já gravada**). Onde há caminho degradado honesto, cai nele (RAG sem Voyage → BM25). Fonte das variáveis: `docs/ENV.md`.

### ✅ Implementado (Sprint D1 — CRM F2; JWT, tenant do token)
| Método | Rota | Nota |
|---|---|---|
| GET | `/v1/crm/contacts?q=&cursor=&limit=` | **paginação por cursor** opaco (`{items, nextCursor}`); limit ≤ 100; cursor inválido/expirado → 400 |
| GET | `/v1/crm/contacts/:id` | **perfil 360**: contato + empresa + negócios + conversas + tarefas + notas + timeline (uma transação) |
| PATCH/DELETE | `/v1/crm/contacts/:id` | excluir leva tarefas/notas junto; negócios e conversas ficam (SET NULL) |
| GET/PATCH/DELETE | `/v1/crm/deals/:id` | negócio 360 (+ tarefas/notas); `PATCH` move etapa, valor, status, contato |
| GET/POST | `/v1/crm/companies` · `GET/PATCH/DELETE /:id` | nome duplicado no tenant → **409**; excluir empresa **não** apaga contatos |
| GET/POST | `/v1/crm/tasks?filtro=abertas\|hoje\|atrasadas\|concluidas\|todas` | + `PATCH /:id`, `POST /:id/toggle`, `DELETE /:id` |
| POST | `/v1/crm/notes` | + `PATCH/DELETE /:id` — **só o autor** edita/exclui (403) |
| POST | `/v1/webhooks/meta` | **público**: leadgen → contato. Assinatura HMAC do corpo cru; `page_id→tenant`; dedupe `webhook_events`; sem credencial **registra e não inventa contato**. ADR-0010 |

### ✅ Implementado (Sprint E — Automações; JWT, tenant do token)
| Método | Rota | Nota |
|---|---|---|
| GET | `/v1/automations/catalogo` | os **15 nós** (ADR-0012). Fonte única: `catalogo.ts` |
| GET/POST | `/v1/automations/workflows` | lista (com execuções/falhas) · cria (já nasce com rascunho vazio) |
| GET/PATCH/DELETE | `/v1/automations/workflows/:id` | detalhe (rascunho + versões) · renomear · excluir |
| PATCH | `/v1/automations/workflows/:id/grafo` | **autosave do canvas** — sempre no rascunho, nunca na versão publicada |
| POST | `/v1/automations/workflows/:id/validar` | valida sem publicar; devolve `problemas[]` com o `noId` |
| POST | `/v1/automations/workflows/:id/publicar` | valida → congela a versão → ativa. Inválido → **400** com `problemas[]` |
| POST | `/v1/automations/workflows/:id/rollback` | volta a ativa para uma versão publicada anterior |
| PATCH | `/v1/automations/workflows/:id/status` | ativo/pausado (ativar sem publicar → 400) |
| POST | `/v1/automations/workflows/:id/testar` | executa AGORA com contato real — **as ações acontecem de verdade** |
| GET | `/v1/automations/workflows/:id/runs` · `/runs/:id` | execuções · timeline nó-a-nó (entrada/saída/erro/tentativa/duração) |
| POST | `/v1/automations/runs/:id/cancelar` | para uma execução em andamento/espera |
| GET/POST | `/v1/automations/dlq` · `/dlq/:id/reprocessar` | dead-letter e reprocessamento do ponto onde parou |

**Erros com contexto:** o filtro RFC 7807 preserva **campos de extensão** — `problemas[]` (validação de workflow), `missing[]`/`provider` (gating) e `errors[]` (class-validator) chegam à UI. Sem isso o usuário via só "Bad Request".

### ✅ Implementado (Sprint F — Nyro IA; JWT · gated em ANTHROPIC_API_KEY)
| Método | Rota | Nota |
|---|---|---|
| GET | `/v1/nyro/status` | `{configurada, missing, capacidades}` — a UI decide entre chat e "Conectar Claude" |
| POST | `/v1/nyro/chat` | `{texto, conversationId?}` → resposta + passos + fontes + aprovações. **501 config_required** sem a chave |
| GET | `/v1/nyro/conversas` · `/conversas/:id` | histórico do usuário; mensagens + ações pendentes |
| POST | `/v1/nyro/acoes/:id` | `{aprovar}` — human-in-the-loop: a ação sensível só acontece aqui |
| GET | `/v1/nyro/acoes` · `/uso` | pendentes de aprovação · consumo/custo de IA por agente |

Tools (ADR-0014): 5 leitura · 6 escrita interna · 3 sensíveis (pedem aprovação). Nenhuma escreve no banco — todas passam pelos serviços do CRM/automações, auditadas `actor:'nyro'`.

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

### 5.1 Conector MCP — Claude e ChatGPT ([[Arquitetura|ADR-0049]])
Fora do `/v1` (raiz do host da API):
| Rota | Uso |
|---|---|
| `GET /.well-known/oauth-protected-resource` (e `/mcp`) | RFC 9728: `{ resource: <api>/mcp, authorization_servers: [<api>] }` |
| `GET /.well-known/oauth-authorization-server` (e `openid-configuration`) | RFC 8414; PKCE `S256`; auth `none`/`client_secret_post`/`client_secret_basic` |
| `POST /oauth/register` | RFC 7591. Redirect https (ou http em loopback). 30/h por IP |
| `GET /oauth/authorize` | valida e redireciona para `WEB_URL/conectar-ia/<pedido>`; erro antes de validar o redirect = página 400 |
| `POST /oauth/token` | `authorization_code` (+`code_verifier`) e `refresh_token` (rotativo). Erros `{error, error_description}` RFC 6749 |
| `POST /oauth/revoke` | RFC 7009; desliga a conexão; sempre 200 |
| `POST /mcp` | JSON-RPC 2.0 (initialize, ping, tools/list, tools/call; notificação → 202). Sem token → 401 + `WWW-Authenticate: Bearer resource_metadata="…"` . 120/min por conexão. `GET`/`DELETE` → 405 |

Sob `/v1/conector-ia` (sessão do KHUB): `GET info` (URL + ferramentas), `GET pedido/:pedido` (tela de consentimento; inclui URL de negar), `POST decidir {pedido, aprovar}` (dono/admin) → `{ redirect }`, `GET conexoes`, `DELETE conexoes/:id`.

### 5.2 Genna — Instagram do cliente ([[Arquitetura|ADR-0053]])
Sob `/v1/genna` (sessão do KHUB, tenant do token):
| Rota | Papel | Uso |
|---|---|---|
| `GET status` | leitura | `{configurado, missing, conectado, status, erro, conectadoEm, escopos, podePublicar}` |
| `GET auth-url` | dono/admin | `{url}` de autorização no Genna (cadastro dinâmico + PKCE). Sem `INTEGRATIONS_ENCRYPTION_KEY` → 501 `config_required` |
| `POST callback {code, state}` | pública | o web (`/api/integrations/genna/callback`) repassa o retorno; grava a credencial cifrada |
| `DELETE conexao` | dono/admin | apaga a credencial (`status='revoked'`) |
| `GET ferramentas[?renovar=1]` | leitura | `[{nome, titulo, descricao, classe: leitura\|escrita\|publicacao, parametros (JSON Schema)}]` |
| `POST consultar/:nome {argumentos?}` | leitura | só ferramenta `leitura` (senão 403) → `{ferramenta, classe, ok, texto, dados, imagens, links}` |
| `POST executar/:nome {argumentos?, confirmar: true}` | dono/admin | criação roda na hora (mesmo formato); publicação → `{aprovacao: {id, resumo}}` em NICO > Aprovações |

Erros: 409 `genna_nao_conectado` (sem conexão ou acesso expirado), 403 `genna_sem_permissao`, 429 `genna_limite`, 502 `genna_indisponivel`.

### 5.3 Tags — catálogo e cruzamento ([[Arquitetura|ADR-0055]])
| Rota | Papel | Uso |
|---|---|---|
| `GET /v1/settings/tags` | leitura | catálogo com `contatos` (ao vivo; `usos` = mesmo valor) e `automacoes: [{id, nome, status, papeis}]` |
| `GET /v1/settings/tags/cruzamento` | leitura | `{totais, foraDoCatalogoEmContatos, foraDoCatalogoEmAutomacoes, parecidas, semUso, gatilhosSemOrigem, adicionaERemove}` |
| `POST /v1/settings/tags` | contacts.write | cria (409 se já existe, sem diferenciar caixa) |
| `POST /v1/settings/tags/sincronizar` | contacts.write | `{adicionadas}`: tags de contatos e automações que faltavam no catálogo |
| `PATCH /v1/settings/tags/:id` | owner/admin | renomear propaga aos contatos → `+ {contatosAtualizados, automacoesParaRevisar}` |
| `DELETE /v1/settings/tags/:id` | owner/admin | tira só do catálogo |

### 5.4 Excluir conversas ([[Arquitetura|ADR-0056]])
| Rota | Papel | Uso |
|---|---|---|
| `DELETE /v1/crm/conversations/:id` | `conversations.delete` (manager/admin/owner) | exclui do KHUB → `{excluidas, ids, mensagens}` |
| `POST /v1/crm/conversations/excluir` | `conversations.delete` | lote `{ids: uuid[] ≤200}` → mesmo retorno; ids de outro tenant são ignorados (RLS) |

Evento `conversation.updated` com `excluida: true` fecha a conversa nas telas abertas. 409 = banco sem db/081.

> ⚠️ LACUNA: TTL do access/refresh token, formato/algoritmo de assinatura JWT (HS256 vs RS256), rotação de refresh e revogação não estão no PRD. Definir no Bloco 3 e registrar ADR se estrutural.

---

## 6. Tempo real (WebSocket) — ✅ definido e implementado (Sprint D2 · ADR-0011)
Canais ([[PRD]] §10.3): inbox, Kanban, execução de automação ao vivo.

- **Protocolo:** **Socket.IO** (`@nestjs/platform-socket.io`), namespace **`/rt`** (fora do prefixo `/v1`). Reconexão, heartbeat e salas vêm da lib — no `ws` nativo seriam três coisas escritas à mão.
- **Autenticação (ticket):** o access token vive em cookie **httpOnly**, inalcançável pelo JS. O front chama `POST /api/auth/ws-ticket` (Next) → `POST /v1/auth/ws-ticket` (JWT) → recebe um **ticket de 60s** (`typ:'ws'`) e o usa no handshake (`auth.ticket`, com `?ticket=` como fallback). O `JwtAuthGuard` **recusa** `typ:'ws'` na API REST: ticket vazado não vira acesso.
- **Reconexão:** `auth` é uma **função** — o Socket.IO a chama a cada tentativa e busca ticket **novo**. Com ticket estático, a reconexão voltaria com credencial expirada e seria recusada para sempre.
- **Isolamento:** na conexão o socket entra **só** em `tenant:<tenantId>`, e o tenant vem **do ticket assinado** — não existe evento para o cliente pedir sala. Todo `emit` é `server.to(sala)`; **nunca** broadcast.
- **Formato:** envelope `{ evento, dados, emitidoEm }`. Contrato tipado em `@khub/types` (`RealtimeEvents`) — front e back importam do mesmo lugar; evento sem tipo lá não compila.
- **Eventos:** `message.created` · `conversation.updated` · `deal.created|moved|updated|deleted` · `contact.created` · `automation.run` (canal pronto; emissores no Sprint E).
- **Ordem:** publicação sempre **após o commit** — quem recebe o evento e consulta a API tem que encontrar o dado.
- **Escala:** `RedisIoAdapter` (`@socket.io/redis-adapter`) — com 2+ instâncias, o socket está numa e o `emit` na outra; sem barramento o evento se perde. Sem Redis, degrada para memória com aviso.
- **Front:** `useRealtime()` (`lib/realtime.ts`) devolve `conectado`; inbox e pipeline mostram um ponto verde/âmbar e **caem para polling (5s)** se o socket cair — a tela nunca congela em silêncio.

## Onboarding KROMA — `/v1/agency/onboarding` (ADR-0054)
Autenticado (membro de agência); controller `@SkipAudit` com auditoria manual; erros RFC 7807 (`onboarding_duplicado` 409 · `onboarding_pendencias` 409 com lista · `genna_nao_conectado` 409).
`GET /` visão executiva (filtros: status, etapa, responsavelId, cliente, de/ate, prioridade) · `POST /` iniciar `{clientAccountId, escopo, responsavelId?}` · `GET/PATCH /:id` (escopo por member → aprovação pendente) · `PUT /:id/conhecimento/:secao` + `GET .../historico` · `POST/PATCH /:id/reunioes[/:mid]` · `POST /:id/tarefas/gerar` `{atribuicoes:{papel:memberId}}` · `POST /:id/relatorios/genna` `{perfil, ferramenta, argumentos?}` + `GET /:id/relatorios` · `PUT /:id/agente` + `POST /:id/agente/testes` (um cenário por chamada) · `GET /:id/conferencia` · `POST /:id/verificacoes/:chave` `{status, evidencias?, semEvidencia?}` · `POST /:id/aprovacoes` + `POST .../aprovacoes/:aid/decisao` · `POST /:id/finalizar` (só owner/admin; transacional; idempotente).

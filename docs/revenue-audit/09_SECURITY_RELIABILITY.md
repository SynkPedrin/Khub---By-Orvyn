# 09 — Segurança, multitenancy e confiabilidade (ORVYN Revenue OS)

Auditoria somente leitura, 2026-10-14. Base: código em `apps/api/src`, `apps/web`, `db/*.sql`.
Sem Postgres/Redis em execução: tudo abaixo é leitura estática. Itens marcados **[inferido]** não foram exercitados.
Classificação: **CODE_DEFECT** (corrigível no repositório) x **EXTERNAL_BLOCKER** (depende de credencial, provedor, infra ou decisão fora do código).

Contradições com `docs/SECURITY_REVIEW.md` (verificadas):
- "S-1 permissions.guard.ts não commitado" e "S-2 sem helmet": desatualizados. O guard existe e está registrado (`app.module.ts:32-34`); `common/security-headers.ts` aplica cabeçalhos equivalentes (sem CSP, intencional para API JSON). Não verifiquei o estado do git do arquivo.
- "Nenhum item crítico": discordo. Há 1 P0 de segurança funcional (SEC-01) e 4 P1.
- O próprio documento anterior lista como "não avaliados" SSRF, CSRF, rate limit sob carga e LGPD; abaixo SSRF e CSRF foram avaliados.

---

## 1. Visão do modelo de isolamento (verificado)

| Camada | Como funciona | Evidência |
|---|---|---|
| Role da app | `orvyn_app` NOBYPASSRLS; `orvyn_service` BYPASSRLS só para funções SECURITY DEFINER e seeds | `db/000_foundation.sql:43-51`; checagem no boot de produção `prisma.service.ts:19-23` |
| Tenant por request | `JwtAuthGuard` extrai `tenant_id` do JWT, revalida `membership` + `tenant.status` no banco; serviços chamam `withTenant(tenantId)` -> `set_config(..., true)` parametrizado, UUID validado | `jwt-auth.guard.ts:56-66`, `prisma.service.ts:42-53` |
| Tenant por job | o job carrega `tenantId` no payload e o processor chama `withTenant` (`OperationsService.event/reconcile`); não há `AsyncLocalStorage` de tenant para jobs (o `request-context.ts` guarda só `correlationId`/`tenantId` opcional) | `operations.service.ts:32,59` |
| RLS | `ENABLE`+`FORCE` + policy `tenant_rw` na grande maioria; teste SQL `002_isolation_test.sql` cobre rag, audit, integrações, CRM F2, automações, nyro, partições, funções de roteamento | seção 4 |
| Cross-tenant controlado | 5 funções SECURITY DEFINER que devolvem só `tenant_id`/`workflow_id`/`key_id` | seção 4.3 |
| Cross-referência | triggers `orvyn_check_tenant_reference` impedem FK apontando para linha de outro tenant | `022_production_foundation.sql:81-112` |

Resultado: para tabelas com RLS, cross-tenant por código de aplicação é improvável (varredura: só auth, agency, tenants, rag e o reconciliador usam `prisma.<model>` fora de `withTenant`). Os problemas abaixo estão nas **bordas**: tabelas globais, agência, webhooks, SSRF, sessões.

---

## 2. Achados

### SEC-01
- ISSUE: Acesso a clientes de agência nunca é revogado (offboarding impossível).
- SEVERITY: P0 (para quem vende Agency Mode: ex-funcionário/agência desligada mantém acesso aos dados do cliente)
- ROOT CAUSE: `ativarCliente` e `AgencyAdminService.accept` fazem `membership.upsert` com `update: {}` e nunca removem. Não existe nenhum `membership.delete`, `agencyMember.delete`, `agencyMemberClientAccess.delete` nem update de `agency_client_accounts.status` no código (grep). `JwtAuthGuard` só exige `membership` + `tenant.status='active'` e ignora `agency_client_accounts.status`. `TokenService.revokeAllForIdentity` existe mas nunca é chamado. Refresh de 30 dias continua válido enquanto houver `membership`.
- FILES: `apps/api/src/agency/agency.service.ts:130-134`; `apps/api/src/agency/agency-admin.service.ts:75-77`; `apps/api/src/auth/jwt-auth.guard.ts:60-65`; `apps/api/src/auth/token.service.ts:78`; `apps/api/src/settings/settings.service.ts` (não há remoção de membro).
- IMPACT: restringir `agency_member_client_access` depois, arquivar/pausar um cliente, ou remover alguém da agência não corta o acesso já concedido ao tenant do cliente. O dono do cliente também não consegue remover um membro (sem rota). Cada cliente da agência é um tenant diferente, então o vazamento é "ex-membro vê todos os clientes que já ativou/aceitou".
- RECOMMENDED FIX: rota de remoção de membro por tenant e por agência que apague `membership`+`user` e chame `revokeAllForIdentity` dos refresh daquele tenant; `JwtAuthGuard` checar vínculo agência (`agency_members` + `agency_member_client_access` + `status='active'`) quando a membership foi originada por agência (coluna `source`/`agency_client_account_id`); endpoint para pausar/arquivar cliente.
- ACCEPTANCE CRITERIA: teste: membro com acesso ao cliente X é removido -> próxima request com access token antigo retorna 401 em <=1 request; refresh falha; `agency_member_client_access` removido corta ativação e requests; cliente `archived` retorna 403 a todos os não-owners do tenant.

### SEC-02
- ISSUE: Rotas e tabelas de agência sem RLS dependem só de filtros de aplicação; sem teste de isolamento entre agências.
- SEVERITY: P1
- ROOT CAUSE: migration 026 declara `agencies`, `agency_members`, `agency_client_accounts`, `agency_member_client_access`, `agency_invites` como globais sem RLS (grant total a `orvyn_app`). Todo isolamento A x B está em `membroDe(identityId)` + `where agencyId`. `002_isolation_test.sql` e `test-isolation-api-keys.mjs` não cobrem agência. `agency.service.spec.ts` usa mocks.
- FILES: `db/026_agency.sql:19-70`; `db/027_account_settings.sql:7-20`; `apps/api/src/agency/agency.service.ts:30-64`; `apps/api/src/agency/agency-admin.service.ts:16-19,30-33`.
- IMPACT: um `where` esquecido numa rota nova vaza dados entre agências sem rede de proteção do banco. Hoje, por leitura, `invites()`/`revoke()` filtram por `agencyId`, `detalheCliente` filtra por `clientesVisiveis`, `invite()` valida que `clientIds` pertencem à agência. Isolamento A x B **parece correto no código atual [inferido]**, mas não é provado.
- RECOMMENDED FIX: policy RLS por `agency_id` usando uma GUC (`app.current_agency_id`) setada em `withAgency()`, ou ao menos teste SQL/integração A x B para cada rota de agência.
- ACCEPTANCE CRITERIA: teste com duas agências e dois clientes: agência A não lista, detalha, ativa, convida para nem revoga convite de B (404/403); teste automatizado no CI.

### SEC-03
- ISSUE: Agency "um por identidade" não é garantido pelo banco.
- SEVERITY: P3
- ROOT CAUSE: só `UNIQUE (agency_id, identity_id)`; `membroDe` usa `findFirst({ where: { identityId } })`, não determinístico se houver duas linhas; a checagem de aceite é aplicativa (concorrência entre aceites de agências diferentes não é serializada, o lock é só da agência convidante).
- FILES: `db/026_agency.sql:35-42`; `apps/api/src/agency/agency-admin.service.ts:43-44,71`.
- IMPACT: identidade em duas agências recebe contexto de uma qualquer.
- RECOMMENDED FIX: `UNIQUE (identity_id)` em `agency_members`.
- ACCEPTANCE CRITERIA: insert duplicado falha no banco.

### SEC-04
- ISSUE: Proteção SSRF do nó `acao.webhook` é contornável.
- SEVERITY: P1
- ROOT CAUSE: validação só por regex no `hostname` literal (`enderecoInterno`), sem resolver DNS e sem tratar redirects (`fetch` segue redirect por padrão). Contornos: domínio público que resolve para IP interno ou 169.254.169.254; redirect 302 para metadata/loopback; IPv6 entre colchetes (`new URL('http://[::1]/').hostname` é `[::1]`, que não casa com `::1$` do regex); outras faixas (`169.254.x.x` != metadata literal, `100.64/10`, `fc00::/7`, `::ffff:127.0.0.1`). Protocolo não restrito a http/https. Quem cria workflow: papéis com `automations.write` (manager/admin/owner).
- FILES: `apps/api/src/automations/executor.service.ts:483-509`.
- IMPACT: tenant com papel de gestor pode fazer o worker chamar serviços internos (Redis, Postgres, metadata de cloud, Evolution/Stevo com chave global). Resposta (500 chars) volta como saída do nó e em `lastError`.
- RECOMMENDED FIX: resolver DNS e bloquear IPs privados/link-local/loopback/CGNAT/ULA após resolução, fixar o IP na conexão (agent com `lookup`), `redirect: 'manual'` (revalidar cada salto), só http/https, limitar tamanho de resposta, egress filtrado na rede.
- ACCEPTANCE CRITERIA: testes unitários bloqueiam: `http://localhost.evil.com` -> 127.0.0.1, redirect 302 para 169.254.169.254, `http://[::1]/`, `http://[::ffff:7f00:1]/`, `file:`; permitem URL pública legítima.

### SEC-05
- ISSUE: Webhook Stevo usa segredo único global; qualquer detentor escolhe o tenant pelo campo `instance` do corpo.
- SEVERITY: P1
- ROOT CAUSE: `STEVO_WEBHOOK_TOKEN` é um só (query `?token=` ou header `x-webhook-token`), comparado em tempo constante, mas o roteamento de tenant usa `instance` do JSON (`resolve_tenant_by_stevo_instance`). Sem assinatura HMAC do corpo, sem segredo por tenant/instância. Token em query string aparece em logs de proxy. Evolution: segredo global no PATH (`/hooks/evolution/:token`), mesmo problema de log e de escopo global.
- FILES: `apps/api/src/crm/messaging/stevo-webhook.controller.ts:24-38`; `apps/api/src/crm/messaging/evolution-webhook.controller.ts:77-83,110-128`.
- IMPACT: quem tiver o token (provedor, operador, vazamento de log) injeta mensagens inbound como se fossem de qualquer cliente cuja instância conheça; mensagens entram como `receiveInbound` e podem disparar automações e respostas (`parar_no_reply`).
- RECOMMENDED FIX: segredo por integração (derivado/armazenado cifrado em `integrations`), validado antes de resolver o tenant, preferir header; HMAC se o provedor suportar. Remover aceite por query string.
- ACCEPTANCE CRITERIA: evento com token de instância A e `instance` B é rejeitado; teste de rotação; token ausente de qualquer log de acesso.
- Obs. EXTERNAL_BLOCKER parcial: se o Stevo/Evolution não suportar assinatura, o segredo por instância é o máximo possível.

### SEC-06
- ISSUE: Rate limit público por IP usa `req.ip` sem `trust proxy` configurado.
- SEVERITY: P1 (disponibilidade atrás de proxy/Vercel/Cloudflare/ALB)
- ROOT CAUSE: nenhum `app.set('trust proxy', ...)` em `main.ts` (grep). Atrás de balanceador, `req.ip` vira o IP do proxy, então **todos** os usuários anônimos compartilham o bucket de `RATE_LIMIT_IP_MAX` (120 req/60 s): login, signup, webhooks públicos (Meta, Stevo, Evolution, hooks de workflow), aceite de convite, OAuth. Além disso o proxy Next (`app/api/v1`) chama a API de dentro do servidor Next, então o IP visto é sempre o do Next, para todos os visitantes.
- FILES: `apps/api/src/main.ts:20-30`; `apps/api/src/common/rate-limit.guard.ts:32-37`; `apps/web/middleware.ts:30,43` (chama `/v1/auth/me` e `/v1/auth/refresh` do servidor).
- IMPACT: 120 req/min globais para login+signup+webhooks; webhook da Meta/Stevo em pico recebe 429 e perde eventos (Meta reenvia por tempo limitado). Em sentido inverso, sem `trust proxy` não dá para limitar o atacante individual. Redis fora em produção: guard devolve 503 para tudo, inclusive health (fail-closed em produção; o comentário do arquivo diz fail-open).
- RECOMMENDED FIX: `trust proxy` com salto correto, repassar `X-Forwarded-For` do Next, `@SkipRateLimit()` + limite próprio nos webhooks, limite específico e mais baixo para `auth/login|signup|invites/accept` por IP+e-mail.
- ACCEPTANCE CRITERIA: teste com dois IPs distintos via `X-Forwarded-For` tem buckets distintos; 6 logins errados seguidos para o mesmo e-mail retornam 429; webhook com 500 req/min não é limitado.

### SEC-07
- ISSUE: Sem proteção contra força bruta no login nem verificação de e-mail; signup livre cria tenants sem limite.
- SEVERITY: P2
- ROOT CAUSE: `AuthService.login` só compara hash; sem contador por conta/IP, sem captcha, sem atraso; `signup` cria identity + tenant imediatamente (`emailVerifiedAt: null` nunca exigido); `twofa_secret` não é usado.
- FILES: `apps/api/src/auth/auth.service.ts:29-40,90-103`; `apps/api/src/auth/auth.controller.ts:39-50`.
- IMPACT: credential stuffing limitado só pelo bucket de IP (SEC-06); criação massiva de tenants/dados; enumeração de e-mails (409 "e-mail já cadastrado").
- RECOMMENDED FIX: throttle por e-mail com backoff, verificação de e-mail antes de enviar mensagens/ações externas, captcha no signup, resposta neutra.
- ACCEPTANCE CRITERIA: testes de lockout/backoff; signup não revela existência de conta.

### SEC-08
- ISSUE: Reuso de refresh token roubado não revoga a família.
- SEVERITY: P2
- ROOT CAUSE: `rotate()` apenas falha com 401 quando o token já foi usado; não revoga os tokens emitidos a partir dele nem avisa.
- FILES: `apps/api/src/auth/token.service.ts:62-72`.
- IMPACT: atacante com refresh roubado que rotacionar primeiro mantém a sessão; o usuário legítimo só recebe 401.
- RECOMMENDED FIX: `family_id` em `refresh_tokens`; reuso de token revogado -> revogar toda a família.
- ACCEPTANCE CRITERIA: teste: usar o mesmo refresh duas vezes invalida o token mais novo.

### SEC-09
- ISSUE: Auditoria com lacunas (só mutações bem-sucedidas, silenciosa em falha, sem negações nem leituras sensíveis; ator de API key registrado como `humano`).
- SEVERITY: P2
- ROOT CAUSE: `AuditInterceptor` grava só em `tap` de sucesso, `void this.gravar(...)` com `catch` que só loga; `@SkipAudit()` em settings/agency/crm depende de cada serviço auditar (`agency.service.ts:169-174` engole erros com `.catch(() => undefined)`). `actor_type` fixo `'humano'`. Não há auditoria de 401/403, exportação, leitura de audit, nem de `api_keys` no uso. `audit_logs` não tem retenção nem particionamento. O trigger imutável impede UPDATE/DELETE, mas o GRANT remove DELETE/UPDATE também do `orvyn_service` (sem expurgo LGPD possível por essa role).
- FILES: `apps/api/src/common/audit.interceptor.ts:44-70`; `apps/api/src/agency/agency.service.ts:169-174`; `db/004_auth_tenants.sql:78-92,152-155`.
- IMPACT: perda silenciosa de trilha de auditoria; chave de API indistinguível de humano nos logs.
- RECOMMENDED FIX: auditoria transacional na mesma tx da mutação para ações sensíveis; `actor_type` derivado de `user.role==='api'`; registrar negações; política de retenção.
- ACCEPTANCE CRITERIA: falha forçada na gravação de audit derruba (ou enfileira) a operação sensível; linhas de API key têm `actor_type='api'`.

### SEC-10
- ISSUE: Socket.IO não revalida vínculo após o handshake e aceita qualquer origem.
- SEVERITY: P3
- ROOT CAUSE: `handleConnection` só valida o ticket (60 s) e entra na sala do tenant; o socket vive indefinidamente mesmo após remoção do membro. `cors: { origin: true, credentials: true }`.
- FILES: `apps/api/src/realtime/events.gateway.ts:23-29,43-60`.
- IMPACT: ex-membro continua recebendo eventos em tempo real do tenant até desconectar. Mitigado pelo ticket exigido.
- RECOMMENDED FIX: TTL de socket/revalidação periódica de membership; origin allowlist igual à da REST.
- ACCEPTANCE CRITERIA: socket do membro removido é desconectado em até N minutos; origem não listada recusada.

### SEC-11
- ISSUE: Segredos e chaves: bom desenho, mas com lacunas pontuais.
- SEVERITY: P2
- ROOT CAUSE / FILES:
  - Credenciais OAuth de integração cifradas com AES-256-GCM (`integrations/crypto.service.ts`), IV aleatório de 12 bytes, tag de 16. Sem versionamento de chave nem rotação (`INTEGRATIONS_ENCRYPTION_KEY` única); sem AAD vinculando ao tenant, então um blob cifrado de um tenant copiado para outro decifra. Bom: chave exigida só quando o recurso é usado.
  - `state` de OAuth de integração é HMAC com `JWT_SECRET` (mesma chave do JWT; sem separação de chave), expira em 10 min, não é de uso único (`integrations.service.ts:37-52`); o endpoint de callback é `@Public()` (`integrations.controller.ts:37-42`) e a vinculação depende só do state assinado.
  - API keys: guardado sha256 sem pepper (alta entropia, aceitável), `last_used_at` atualizado por UPDATE a cada request autenticada via função SECURITY DEFINER (`019_api_keys.sql:42-54`), escrita em linha quente.
  - Webhook de workflow: `webhook_key` em texto puro na tabela `workflows` (`011_workflow_settings.sql`), a URL é a credencial; `GET` workflows devolve a URL completa a quem lê workflows (`automations.read`).
  - Comparação de `META_WEBHOOK_VERIFY_TOKEN` com `===` (não constante), baixa criticidade (`meta-webhook.controller.ts:31-33`).
  - `.env`: nenhum `.env` real inspecionado por mim (não procurei fora do repo); a afirmação "nenhum segredo no histórico" do documento anterior não foi reverificada.
- IMPACT: movimentação de blobs cifrados entre tenants (requer acesso ao banco), chave única sem rotação.
- RECOMMENDED FIX: `key_id` + AAD=`tenant_id` no formato cifrado; chave separada para state; state com nonce de uso único em Redis; hash do `webhook_key` com exibição única.
- ACCEPTANCE CRITERIA: decifrar blob com tenant diferente falha; rotação de chave sem downtime; reuso de state recusado.

### SEC-12
- ISSUE: Autorização por request custa 2 consultas + `/auth/me` no middleware web a cada navegação.
- SEVERITY: P3 (performance)
- ROOT CAUSE: `JwtAuthGuard` consulta `membership` e `tenant` sem cache; `middleware.ts` chama `GET /v1/auth/me` (que faz mais 3-4 queries) em toda navegação de página protegida, e cada uma consome o limite por tenant. `listarClientes`/`overview` de agência chama `crm.overview` por cliente (N chamadas, cada uma carrega todos os deals; ver ARQ-05).
- FILES: `apps/api/src/auth/jwt-auth.guard.ts:60-63`; `apps/web/middleware.ts:29-36`; `apps/api/src/agency/agency.service.ts:73-82`.
- IMPACT: carga no Postgres proporcional a navegação; teto de 600 req/min por tenant atingido por poucos usuários ativos.
- RECOMMENDED FIX: cache curto (Redis, 15-30 s) de membership/tenant status com invalidação ao mudar papel; middleware só verificar assinatura/exp do JWT localmente.
- ACCEPTANCE CRITERIA: p95 do guard < 5 ms em cache; navegação não dispara `/auth/me`.

### SEC-13
- ISSUE: Provisionamento e aceite de convite com janelas de inconsistência.
- SEVERITY: P3
- ROOT CAUSE: `AuthService.acceptInvite` marca o convite como aceito, cria membership/user/audit e depois faz um segundo `invite.update` redundante; se falhar após o claim o convite fica consumido sem acesso concedido (`auth.service.ts:63-85`). `signup`/`provision` não atômicos (ver ARQ-10).
- FILES: `apps/api/src/auth/auth.service.ts:63-85`.
- IMPACT: convite "queimado" sem acesso, exigindo novo convite.
- RECOMMENDED FIX: claim + membership + user numa transação.
- ACCEPTANCE CRITERIA: falha injetada após o claim deixa o convite reutilizável.

### SEC-14
- ISSUE: CSRF e cabeçalhos no frontend.
- SEVERITY: P3
- ROOT CAUSE: o proxy `app/api/v1/[...path]` autentica por cookie e força `content-type: application/json` sem checar `Origin`/`Sec-Fetch-Site`. Proteção atual é `SameSite=lax` (bloqueia POST cross-site em navegadores modernos). Sem CSP/X-Frame-Options no Next (`next.config.mjs` não define `headers()`). OAuth state do login é validado contra cookie (`app/api/auth/oauth/[provider]/callback/route.ts:29`), ok. `next` após login: não verifiquei validação de redirect aberto em `login/page.tsx` (grep de `next` sem resultado útil).
- FILES: `apps/web/app/api/v1/[...path]/route.ts:10-24`; `apps/web/next.config.mjs`; `apps/web/lib/server-auth.ts:9-12`.
- IMPACT: defesa depende de um único atributo de cookie; clickjacking possível no app.
- RECOMMENDED FIX: checagem de `Origin` em métodos mutáveis; headers de segurança no Next; validar `next` como caminho relativo.
- ACCEPTANCE CRITERIA: POST com `Origin` externo retorna 403; resposta traz `X-Frame-Options`/CSP; `next=https://evil.com` ignorado.

### SEC-15 (RLS: lacunas e fragilidades)
- ISSUE: (a) Tabelas sem `FORCE ROW LEVEL SECURITY`; (b) `tenants` sem RLS e com UPDATE para a role da app; (c) `invites`/`refresh_tokens`/`memberships` sem RLS; (d) tabelas novas sem caso no teste de isolamento.
- SEVERITY: P2
- ROOT CAUSE: `meta_pages` e as demais usam `FORCE`; mas `002_isolation_test.sql` cobre só rag, audit/webhook, integrações, CRM F2, automações, nyro e partições. Sem teste SQL: `outbox_events`, `api_keys` (há script `.mjs` à parte), `agenda_compromissos`, `financeiro_cobrancas`, `crm_tags`, `campaigns*`, `meta_pages`, agência. `rag_documents`/`rag_chunks` não têm `FORCE`? Têm (001a). `automation_templates` com `FORCE` e leitura global (016). `tenants`: `GRANT INSERT, UPDATE ... TO orvyn_app` sem RLS (`004:155`): `UPDATE tenants` sem `WHERE id` por bug futuro atingiria todos os tenants.
- FILES: `db/002_isolation_test.sql` (seções 1-15); `db/004_auth_tenants.sql:154-155`; `db/020_financeiro.sql:33-39`; `db/021_agenda.sql:27-33`.
- IMPACT: regressão de RLS nessas tabelas não é detectada; `tenants` é ponto único de dano em massa por erro de código.
- RECOMMENDED FIX: um teste genérico que percorre `pg_tables` e falha se tabela com `tenant_id` não tiver RLS+FORCE+policy; policy em `tenants` por `id = current tenant` ou função SECURITY DEFINER para UPDATE; ampliar `002`.
- ACCEPTANCE CRITERIA: `002` falha ao criar tabela com `tenant_id` sem RLS; cada tabela do lote acima tem caso positivo e negativo.

### SEC-16
- ISSUE: RLS bloqueia escrita do RAG pela role da app (duplicado de ARQ-03, mas é falha de segurança/confiabilidade).
- SEVERITY: P1
- Ver ARQ-03 em `02_ARCHITECTURE.md`.

### SEC-17
- ISSUE: Meta Lead Ads: parte do lote é descartada e o provedor re-tenta o lote todo.
- SEVERITY: P3
- ROOT CAUSE: no `for` de eventos, página sem mapeamento retorna 503 imediatamente, depois de eventos anteriores do mesmo POST já terem sido gravados no outbox; reentrega da Meta repete (seguro pelo dedupe, mas o 503 contínuo para página desconectada bloqueia os demais eventos do mesmo lote).
- FILES: `apps/api/src/integrations/meta-webhook.controller.ts:51-60`.
- IMPACT: lead de uma página válida atrasado por uma página órfã no mesmo lote.
- RECOMMENDED FIX: responder 200 ignorando páginas órfãs (com métrica) e processar o resto.
- ACCEPTANCE CRITERIA: lote com 1 página desconhecida e 1 válida persiste o válido e responde 200.

### SEC-18
- ISSUE: Validação de entrada irregular em controllers antigos.
- SEVERITY: P3
- ROOT CAUSE: `ValidationPipe({ whitelist: true, transform: true })` global está ok, mas vários controllers aceitam `@Body() body: Record<string, unknown>`/`unknown` (hooks, webhooks) e `Query` sem DTO (`limit` de `/settings/audit` é `Number(limit) || 100`, limitado a 200 no serviço). `@Param('id')` sem `ParseUUIDPipe` em settings/integrations (RLS evita vazamento, mas gera 500 em UUID inválido). Não há limite de body explícito além do padrão do Express (100 kb).
- FILES: `apps/api/src/settings/settings.controller.ts:62-64`; `apps/api/src/integrations/integrations.controller.ts:32-35`; `apps/api/src/automations/hooks.controller.ts:27`.
- IMPACT: erros 500 evitáveis; superfície de payload grande em webhooks (100 kb, ok).
- RECOMMENDED FIX: `ParseUUIDPipe` onde há `:id`; DTOs Zod/class-validator nos corpos livres.
- ACCEPTANCE CRITERIA: UUID inválido -> 400 em todas as rotas `:id`.

---

## 3. Confiabilidade: filas, retries, DLQ

| Item | Estado verificado | Lacuna |
|---|---|---|
| Entrada durável de eventos | triggers SQL gravam `outbox_events` na mesma tx da mudança (022) | sem retenção/expurgo (SEC/ARQ-07) |
| Webhooks de entrada | gravam no outbox com `UNIQUE(tenant_id, dedupe_key)` e respondem rápido | Stevo/Evolution/hooks com segredo global (SEC-05); Meta lote (SEC-17) |
| Passos de automação | 4 tentativas, backoff exponencial, lease/generation, reconciliador recria job perdido, `paraDlq` na última falha, `POST /automations/dlq/:id/reprocessar` | reconciliação O(tenants) a cada 5 s (ARQ-06) |
| Outbox `event` | 5 tentativas (`attempts>=5` -> `failed`) | sem DLQ/alerta/replay (ARQ-07); processamento não atômico com a marcação `processed` -> reprocesso possível, mitigado por idempotência de mensagem (`messages_idempotency`) e dedupe de runs |
| Envio de mensagem | reserva idempotente, nunca reenvia estado incerto (`unknown`) | sem circuit breaker no provider de WhatsApp (há `circuit-breaker.ts` usado em Stripe) [inferido: grep não mostrou uso no messaging] |
| `ads-sync` | fila + processor | sem política de retry/backoff declarada, sem DLQ |
| Ingestão RAG | in-process, fire-and-forget | quebrada por RLS (ARQ-03), perdida em restart |
| Rate limit | Redis, janela fixa por tenant/IP | ver SEC-06; janela fixa permite 2x burst na virada |
| Heartbeat | `orvyn:worker:heartbeat` EX 30; exposto em `GET /operations` (`workerOnline`) | `snapshot` retorna contagem de fila global `getJobCounts` internamente mas expõe só dados do tenant (comentário no código) |
| Observabilidade | JSON logger, correlation-id, `error-reporter.service.ts` | `SENTRY_DSN` sem integração real (comentário em `env.ts`: "só falta plugar") |

EXTERNAL_BLOCKER (não é defeito de código): Redis/worker precisam estar rodando para qualquer automação; WhatsApp (Stevo/Evolution) exige instância e QR reais; Meta exige app review e `META_APP_SECRET`; Anthropic/Voyage exigem chaves; SMTP/Resend para e-mails de convite (sem SMTP o link volta manual por desenho).

## 4. Detalhes de RLS verificados

### 4.1 Policies
Padrão `USING`+`WITH CHECK` `tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`. Sem contexto, `NULL` -> nenhuma linha (fail-closed). Aplicado em 003, 004, 005, 009, 010, 013, 014 (partições de `ad_insights`), 015, 018-023.
Exceções por desenho: RAG (leitura global/nicho; escrita só tenant — e ver ARQ-03), `automation_templates` (SELECT global, escrita restrita).

### 4.2 Lacunas
- Tabelas globais sem RLS: tenants, identities, memberships, refresh_tokens, invites, agencies e filhas. Controle só na aplicação (SEC-02, SEC-15).
- Documentação interna (`db/README.md`) afirma que as migrations "ainda não foram executados"; não há prova no repositório de que `002_isolation_test.sql` rodou contra o banco atual. Isso é EXTERNAL_BLOCKER de verificação (precisa de Postgres).

### 4.3 Funções SECURITY DEFINER (auditadas)
| Função | Retorno | Observação |
|---|---|---|
| `auth_lookup_api_key(hash)` | `(tenant_id, key_id)` | também faz `UPDATE api_keys SET last_used_at` (efeito colateral em função usada como leitura); filtra revogadas |
| `resolve_tenant_by_stevo_instance`, `..._evolution_instance` | `tenant_id` | `STABLE`, índice único de instância conectada (024) |
| `resolve_tenant_by_meta_page` | `tenant_id` | `UNIQUE(page_id)` |
| `resolve_workflow_by_webhook_key` | `(tenant_id, workflow_id)` | só workflows `ativo` |
Todas: `SET search_path = public`, owner `orvyn_service`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` à app. Bom padrão. Risco residual: a verificação é por segredo/identificador adivinhável (instância Stevo previsível) — ver SEC-05.

## 5. Isolamento: matriz A x B

| Cenário | Mecanismo | Veredito |
|---|---|---|
| Tenant A lê dado do tenant B (REST) | `withTenant` + RLS | protegido (varredura de código); não executado |
| Tenant A escreve referência a linha do B | triggers 022 + WITH CHECK | protegido para as 9 tabelas listadas; outras (ex.: `agenda_compromissos.contact_id`, `financeiro_cobrancas.contact_id`, `campaign_*`) sem trigger, FK simples dentro do banco [inferido: FK não checa tenant] |
| Webhook roteando para tenant errado | SECURITY DEFINER por instância/página/chave | depende de segredo global (SEC-05) |
| Agência A x Agência B | filtros aplicativos | **não provado** (SEC-02) |
| Cliente A x Cliente B da mesma agência | tenants distintos, JWT com 1 tenant por vez | ok por desenho; acesso residual após revogação (SEC-01) |
| Membro de agência restrito a clientes X,Y vê Z | `clientesVisiveis` + `agency_member_client_access` | correto no código, mas "sem linhas de restrição = acesso a todos" (`agency.service.ts:61`): remover o último vínculo **amplia** o acesso para todos os clientes, não zera |
| API key do tenant A em B | hash -> tenant do banco | ok; escopo default `{*}` |

Achado adicional (P2) — acesso restrito que se inverte: ver linha acima. FILES: `agency.service.ts:59-63`. FIX: representar "global" explicitamente (coluna `all_clients boolean`) em vez de ausência de linhas. ACCEPTANCE: membro com restrição vazia não vê nenhum cliente.

## 6. Performance e escala (resumo)
- Índices: bons para listagens por tenant (`(tenant_id, created_at DESC)`, cursor, tasks abertas, runs vencidos parciais, outbox pending parcial). Faltam: trigram para busca (ARQ-08); índice por `owner_id` já criado (023) mas não usado; `audit_logs` sem retenção.
- N+1/unbounded: `listConversations` (ARQ-04), `overview`/`pipeline` (ARQ-05), agência por cliente (SEC-12), `agenda.listar` e `financeiro.listar` sem limite (`financeiro.service.ts:34`, `agenda.service.ts:33`), `resumo` financeiro soma em memória de todas as cobranças.
- Paginação por cursor correta só em contatos (`crm.service.ts:140-180`, com tratamento de âncora removida).
- Jobs: reconciliador (ARQ-06).

## 7. Prioridade de correção sugerida
1. SEC-01 (revogação), ARQ-01/SEC-02 (agência utilizável e provada), SEC-04 (SSRF), SEC-05 (webhooks), SEC-06 (rate limit/proxy), ARQ-03 (RAG sob RLS), ARQ-04 (conversas sem paginação).
2. SEC-07/08/09/11/15, ARQ-02/06/07/09/10.
3. Demais P3.

## 8. Limites
Não executei Postgres, Redis, workers, testes jest nem E2E. Não inspecionei `.env`, histórico git, nem a infraestrutura de deploy (inexistente em `docs/production`). Qualquer "protegido" acima significa "o código e a SQL lidos implementam a proteção", não "foi testado em ambiente real".

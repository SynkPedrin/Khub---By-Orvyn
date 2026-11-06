# 03 - Auditoria de Integracoes do ORVYN Revenue OS

Escopo: auditoria SOMENTE LEITURA (codigo, SQL, UI). Nenhuma chamada a API externa foi feita, nenhuma mensagem enviada, nenhum teste E2E real executado. Tudo que depende de comportamento vivo de Meta/Evolution/Stripe esta marcado como NAO VERIFICAVEL. Regra aplicada: existencia de codigo nao e funcionalidade.

Evidencia lida: `apps/api/src/integrations/*`, `integrations/providers/*`, `apps/api/src/crm/messaging/*`, `common/mailer.service.ts`, `financeiro/financeiro.service.ts`, `agenda/agenda.service.ts`, `automations/hooks.controller.ts`, `settings/api-keys.service.ts`, `auth/jwt-auth.guard.ts`, `config/*`, `operations/operations.service.ts`, `db/005, 008, 009, 019, 024, 026`, `apps/web/components/app/IntegrationsMarketplace.tsx`, `WhatsAppConnectModal.tsx`, `app/(app)/marketing/ads/page.tsx`, `app/api/integrations/meta/callback/route.ts`.

## 1. Contagens

| Metrica | Qtde | Itens |
|---|---|---|
| Total de integracoes encontradas (codigo ou UI) | 14 | ver matriz |
| NATIVE_VERIFIED (E2E real comprovado) | 0 | nenhuma tem teste E2E real contra o provedor neste repo |
| NATIVE_PARTIAL | 8 | Meta Ads, Meta Lead Ads, Evolution, Stevo, API keys privadas, Webhook de entrada por workflow, E-mail (Resend/SMTP), Stripe Checkout |
| CONNECTOR_ONLY | 0 | (Meta Ads usa interface AdsConnector, mas so ha 1 implementacao) |
| UI_ONLY / stub | 6 | Google Ads, TikTok Ads, Instagram (DM), Messenger, Gmail, Google Calendar (stub que sempre lanca erro) |
| NOT_IMPLEMENTED (nem UI) | 5 | Webhooks de saida, Zapier/n8n/Make (alem do hook de entrada), CRMs externos, Meta CAPI/Conversions, WhatsApp Cloud API oficial |
| BLOCKED_EXTERNAL (sobreposto) | 3 | Meta Lead Ads (App Review/Advanced Access de `leads_retrieval`), Meta Ads em producao (Business Verification + Advanced Access de `ads_read`), Google Ads (developer token) |
| Quebradas por CODE_DEFECT (hoje nao entregam o que a UI promete) | 5 | Meta Ads apos ~1h (token curto), Meta multi-cliente (pagina/conta), Evolution inbound quando status nao e polled, Stevo em producao, Criativos sem metrica |

Fora do escopo desta matriz (registrado): login OAuth Google/GitHub (`auth/oauth.providers.ts`, scopes openid/email, adequado) e provedores de IA (Anthropic, OpenAI, Voyage).

## 2. Matriz

Legenda: S = sim, P = parcial, N = nao, ? = nao verificavel sem chamada real.

| PROVIDER | CATEGORY | FRONTEND | BACKEND | OAUTH/API KEY | TOKEN STORAGE | TOKEN REFRESH | WEBHOOK (assinatura) | READ | WRITE | SYNC | ERROR HANDLING | TENANT ISOLATION | REAL E2E TEST | STATUS |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Meta Ads | Anuncios | S (`marketing/ads`, Marketplace) | S (`integrations/*`, `ads-sync*`, `MetaAdsConnector`) | OAuth2 code, capability `ads` | AES-256-GCM (`crypto.service.ts`), chave em env | N (sem troca por long-lived, `expiresAt` nunca lido) | n/a | S campanhas, criativos, insights nivel campanha, 30d | N (so leitura) | So no connect + botao manual; sem cron | P: erro vira `health=down`; sem classificacao de token expirado, sem retry/rate limit | P: RLS ok; ANTES de RLS, a conta Meta traz TODAS as contas do usuario (ver ISSUE-02) | N (so unit com GraphClient mock) | NATIVE_PARTIAL (+BLOCKED_EXTERNAL p/ producao) |
| Meta Lead Ads | Leads | P (card sem estado `leads`; botao usa so capability `ads` no /marketing/ads) | S (`meta-webhook.controller`, `meta-leads.service`) | OAuth capability `leads` + page tokens | Page token dentro do JSON cifrado | N | S: HMAC SHA-256 `x-hub-signature-256` sobre rawBody, timingSafeEqual, verify token no GET | S lead por `leadgen_id` | N | webhook, outbox + dedupe | P: pagina sem tenant devolve 503 (Meta reenvia), falha reprocessa 5x | RISCO: `meta_pages UNIQUE(page_id)` + `DO NOTHING` (ISSUE-02) | N | NATIVE_PARTIAL (+BLOCKED_EXTERNAL) |
| Evolution API (WhatsApp nao oficial) | Mensageria | S (`WhatsAppConnectModal`, Marketplace) | S (`whatsapp*.ts`, `evolution.provider`, webhook) | API key GLOBAL do servidor + token por instancia | Token da instancia cifrado; chave global em env (usada em todas as chamadas) | n/a (sessao Baileys) | P: token unico global no PATH `/hooks/evolution/:token` (sem HMAC, sem segredo por tenant) | S entrada de texto (grupos/status ignorados; midia nao) | S envio de texto, idempotente, estados `unknown` | webhook + outbox | B: DeliveryError, 5xx = `unknown`, nao reenvia; `connection.update` so loga | S na rota por instancia (indice unico parcial, funcao SECURITY DEFINER), mas depende de status=connected (ISSUE-03) | N (docstring admite: payload de mensagem nao observado ao vivo) | NATIVE_PARTIAL |
| Stevo (WhatsApp nao oficial) | Mensageria | N (sem fluxo de conexao) | S (provider + webhook) | API key global + instancia global em env | Nenhum por tenant | n/a | P: token global em query/header, comparacao constante | S | S texto | webhook + outbox | B | Em prod nada cria linha `integrations provider=stevo` -> envio vira `config_required` (ISSUE-07) | N | NATIVE_PARTIAL (efetivamente morto em prod) |
| API keys privadas (Private Integrations) | Plataforma/entrada | S (Configuracoes) | S (`api-keys.service`, guard) | `orv_live_` + 24 bytes | SHA-256 do segredo (nao reversivel), em claro so 1x | n/a (revogar/criar) | n/a | S conforme scope | S conforme scope | n/a | S 401 generico | S: `auth_lookup_api_key` SECURITY DEFINER + RLS | N | NATIVE_PARTIAL (`lastUsedAt` nunca atualizado; scopes `*` por default na coluna) |
| Webhook de entrada por workflow | Automacao | S (workflow) | S (`hooks.controller`) | URL secreta de 24 bytes (revogavel) | n/a | n/a | N (sem HMAC; URL e a credencial) | n/a | dispara workflow | outbox + `Idempotency-Key` obrigatorio | S 202 uniforme, sem oraculo | S (funcao resolve tenant+workflow) | N | NATIVE_PARTIAL |
| E-mail (Resend / SMTP) | Comunicacao | S (status em Configuracoes) | S (`mailer.service`) | API key Resend ou SMTP_URL | Env | n/a | N (sem webhook de bounce/entrega) | N | S so convites | n/a | S (degrada para link) | Global (um remetente para todos) | N | NATIVE_PARTIAL (nao ha e-mail por tenant/campanha) |
| Stripe | Pagamentos | UI diz "em breve" (Marketplace) | P: so `checkout.sessions` (`financeiro.service`) | Chave secreta global em env | Env | n/a | N: `STRIPE_WEBHOOK_SECRET` existe em `env.ts` mas NENHUM endpoint o usa | N | S cria link | N: status da cobranca nunca volta | circuit breaker 5xx | Conta unica da plataforma, nao Connect por cliente | N | NATIVE_PARTIAL |
| Google Calendar | Agenda | UI "em breve" | Stub: `sincronizarCalendar` valida env e SEMPRE lanca BadRequest | n/a | n/a | n/a | n/a | N | N | N | gated | n/a | N | UI_ONLY |
| Google Ads | Anuncios | Card com "Conectar" (estado oauth) | Gate de env; `ADS_CONNECTORS` so registra `meta` | n/a | n/a | n/a | n/a | N | N | N | Com env: 404 "provider nao suportado" | n/a | N | UI_ONLY (+BLOCKED_EXTERNAL: developer token) |
| TikTok Ads | Anuncios | Card "Conectar" | Idem | n/a | n/a | n/a | n/a | N | N | N | Idem | n/a | N | UI_ONLY |
| Instagram (DM) | Mensageria | Card "Conectar" com provider `meta` | Nenhum codigo de DM/comentarios | n/a | n/a | n/a | n/a | N | N | N | n/a | n/a | N | UI_ONLY (e ENGANOSO, ver ISSUE-06) |
| Messenger | Mensageria | Card idem | Nenhum | n/a | n/a | n/a | n/a | N | N | N | n/a | n/a | N | UI_ONLY (ISSUE-06) |
| Gmail | Produtividade | "em breve" | Nenhum | n/a | n/a | n/a | n/a | N | N | N | n/a | n/a | N | UI_ONLY |

Nao encontrados (grep em `apps/api/src`, `apps/web/app|components|lib`, `packages`): webhooks de saida, Zapier/n8n/Make nativos, HubSpot/RD Station/Pipedrive, Meta Conversions API, WhatsApp Cloud API oficial, TikTok/Google conectores. NOT_IMPLEMENTED.

## 3. Os 15 pontos, para as integracoes existentes

Foco em Meta Ads/Lead Ads e Evolution (as duas com fluxo de conexao real). Demais citados quando difere.

| # | Ponto | Meta Ads / Lead Ads | Evolution (WhatsApp) |
|---|---|---|---|
| 1 | Iniciar conexao | `GET integrations/meta/auth-url?capability=ads|leads`; gating 501 `config_required` com nome das variaveis (bom). State HMAC com tenant, 10 min | `POST integrations/whatsapp/connect`: cria instancia `orvyn-<tenantId>`, registra webhook, devolve QR |
| 2 | Auth | OAuth2 code. State sem vinculo com usuario/sessao e sem nonce de uso unico (ISSUE-05) | Chave global Evolution + token por instancia |
| 3 | Armazenamento do token | AES-256-GCM, IV aleatorio 12B, tag GCM; chave 32B em env, sem versionamento/rotacao de chave | Token da instancia cifrado; chave global em env, usada para TUDO (token da instancia nunca e usado) |
| 4 | Renovacao | NAO existe. Troca code->token devolve token CURTO; nao ha `fb_exchange_token` para long-lived (ISSUE-01) | Nao se aplica |
| 5 | Deteccao de expirado | Nenhuma ativa. `expiresAt` salvo e nunca lido; so um sync falho marca `health=down`, `status` continua `connected` | `getConnectionState` real na UI; `connection.update` do webhook so loga |
| 6 | Busca de dados | `me/adaccounts`, `/campaigns`, `/adcreatives`, `/insights` (level campaign, 30d). SEM paginacao (limit 200/500 e fim) | Mensagens via webhook, so texto |
| 7 | Exibicao na UI | Overview, campanhas, criativos (criativos sempre zerados, ISSUE-08) | Modal de QR; estado real consultado |
| 8 | Acoes | So leitura e "sync". Nenhuma acao de escrita em campanha | Enviar texto, conectar, desconectar |
| 9 | Tratamento de erro | Erro cru da Graph vira string em `erro`; circuit breaker so para 5xx; sem retry para codigos 4/17/32/613 (rate limit) | Bom para envio (idempotencia, `unknown`); webhook de instancia desconhecida devolve 200 e PERDE a mensagem |
| 9b | Desconectar | NAO existe endpoint de desconexao/revogacao Meta (nao ha DELETE, nem revoke de token, nem limpeza de `meta_pages`) | `DELETE disconnect` faz logout + status `disconnected` (nao apaga instancia) |
| 10 | Reconectar | Repetir OAuth: `handleCallback` atualiza a mesma linha; paginas ja mapeadas para outro tenant nao mudam | `connect` reaproveita instancia; QR novo |
| 11 | Respeito ao tenant ativo | Tenant vem do JWT no `auth-url` e e carimbado no state; ok. Mas o callback e publico e confia so no state (ISSUE-05) | `@TenantId()` do JWT em todas as rotas; ok |
| 12 | Status exibido = estado real | Nao: `connected` + badge `health` herdado do ultimo sync; token expirado aparece como conectado. Cards Instagram/Messenger mostram "Conectado" quando Meta Ads esta conectado (ISSUE-06) | Sim na UI (consulta a Evolution), mas o BANCO so muda quando a UI faz poll (ISSUE-03) |
| 13 | Testes | 4 specs com Graph mockado (assinatura, parse, connector); sem E2E real; `002_isolation_test.sql` cobre RLS de `integrations`/`meta_pages` e roteamento Stevo/Meta, NAO Evolution | `evolution.provider.spec`, `whatsapp-connection.spec`, `messages.service.spec` mockados; sem E2E real |
| 14/15 | CODE_DEFECT vs EXTERNAL_BLOCKER | Ver secao 6 | Ver secao 6 |

## 4. Validade de API (conhecimento da documentacao oficial; NAO verificado ao vivo)

| Tema | Achado | Classe |
|---|---|---|
| Versao do Graph | Default `v21.0` (`meta-graph.client.ts:19`, `meta-ads.connector.ts:44`, `env.ts:29`). v21.0 foi lancada em out/2024; a Meta mantem cada versao por cerca de 2 anos e depois faz upgrade automatico para a mais antiga disponivel. Em out/2026 esta no limite ou alem da janela. Nao ha como confirmar a data exata sem consultar o changelog atual | CODE_DEFECT provavel (default desatualizado), VERIFICACAO MANUAL |
| Endpoint OAuth | `https://www.facebook.com/{v}/dialog/oauth` correto | ok |
| Troca de codigo | `GET /oauth/access_token` com `client_secret` na query: aceito pela doc, mas fica em logs de proxy. Sem `appsecret_proof` nas chamadas | melhoria |
| Token longo | Falta `GET /oauth/access_token?grant_type=fb_exchange_token` (long-lived ~60 dias). Page tokens obtidos de user token curto tambem sao curtos | CODE_DEFECT |
| Validacao de token | Nao usa `debug_token` para `expires_at`/`is_valid`/scopes | CODE_DEFECT |
| Scopes Ads | `ads_read, ads_management, business_management, pages_show_list`. Para so ler insights `ads_management` e excessivo e aumenta o escopo de App Review | melhoria |
| Scopes Leads | `leads_retrieval, pages_show_list, pages_read_engagement, pages_manage_ads`. Para assinar `leadgen` na pagina via API e preciso `pages_manage_metadata`; nao esta no pedido | CODE_DEFECT provavel |
| Assinatura de pagina | Nao ha `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen`. Sem isso o webhook de Lead Ads nao dispara para a pagina, mesmo com app configurado. Nao e feito em lugar nenhum do repo | CODE_DEFECT |
| App Review / Business Verification | `leads_retrieval`, `ads_read` e `pages_*` em producao (usuarios fora do app) exigem Advanced Access via App Review e, para dados de terceiros, Business Verification. Em dev so funciona com Admin/Developer/Tester (o codigo documenta isso) | EXTERNAL_BLOCKER |
| Paginacao | Nenhuma: `limit: 200` e `500` sem seguir `paging.next`. Agencia com mais de 200 campanhas ou muitos dias x campanhas (30 dias x 20 campanhas = 600 linhas de insights) trunca silenciosamente | CODE_DEFECT |
| Rate limit | Sem tratamento de erros 4, 17, 32, 613 nem `X-Business-Use-Case-Usage`/`x-app-usage`; 4xx nao tem retry; BullMQ tem 3 tentativas com backoff exponencial, mas a sync inteira recomeca | CODE_DEFECT |
| Idempotencia | Upserts por `(tenant, externalId)` e insights por `(tenant, provider, level, ref, date)`: boa. Dedupe de lead por `leadgen_id` e por `outbox.dedupeKey`: boa | ok |
| Campos de insights | `actions` somando por `includes('lead')` e `includes('purchase')` pode dobrar contagem (`lead` e `onsite_conversion.lead_grouped` coexistem); atribuicao/janela nao informadas. Dado de ROAS nao e confiavel sem validacao | RISCO DE METRICA |
| Moeda | `daily_budget` dividido por 100 assume moeda com 2 casas decimais (JPY etc. nao tem), sem checar `currency` | menor |
| Evolution | Endpoints `/instance/create`, `/instance/connect/{n}`, `/instance/connectionState/{n}`, `/webhook/set/{n}`, `/message/sendText/{n}`, `/instance/logout/{n}` batem com a v2.x conhecida. O proprio codigo admite que o payload de `messages.upsert` nao foi visto ao vivo. Sem tratamento de midia, audio, reacao, `messages.update`, nem `qrcode.updated` | NAO VERIFICAVEL |
| Risco do canal | Baileys nao e API oficial: risco de banimento do numero do cliente. Para agencia de trafego pago com disparo, isso e risco de negocio, nao de codigo | EXTERNAL / produto |
| Stripe | Checkout Session por REST sem versao `Stripe-Version` fixa (verificar), sem webhook para `checkout.session.completed` | CODE_DEFECT |
| Google Calendar / Google Ads / TikTok | Sem codigo; nao ha o que validar | n/a |

## 5. Cenario obrigatorio: agencia com 10 clientes, cada um com Meta e WhatsApp proprios

Modelo: cada cliente e um tenant (migration 026, `agency_client_accounts` apontando para tenant). "Entrar no cliente" troca o `tenantId` do JWT. Isso e solido para dados operacionais.

### 5.1 WhatsApp: risco de enviar pela instancia do cliente errado

- Envio (`messages.service.ts:46-73`): tenant vem do JWT; conversa e contato sao buscados com `tenantId`; instancia vem de `integrations WHERE tenantId = jwt AND provider AND status='connected'`. Nome da instancia deterministico `orvyn-<tenantId>`. RISCO BAIXO de enviar pela instancia errada pela via normal.
- Recepcao: roteamento instancia->tenant pela funcao SECURITY DEFINER `resolve_tenant_by_evolution_instance` (024), com indice unico parcial (`status='connected'`). Correto em desenho e testavel por SQL, MAS:
  - O segredo do webhook e UM so para todos os tenants (`EVOLUTION_WEBHOOK_TOKEN`) e vai no path (aparece em logs de proxy/Evolution). Quem tiver o token pode postar `instance=orvyn-<tenant-vitima>` e injetar mensagens/contatos/gatilhos de automacao em qualquer cliente (ISSUE-04).
  - O indice unico so vale para `connected`; instancias em `connecting` nao sao roteadas (ISSUE-03).
  - Nenhuma coluna guarda o numero do WhatsApp: o mesmo numero pode ser pareado em dois tenants (cliente A e B) e nada detecta.
  - Uma unica chave global da Evolution da acesso total a todas as instancias; vazamento = 10 clientes expostos.
- Em dev, `STEVO_FALLBACK_TENANT_ID` roteia tudo para um tenant; proibido em producao por `env.ts:95` (ok).
- Veredito WhatsApp: risco de ENVIO errado baixo; risco de ENTRADA forjada alto (token global); risco de PERDA de mensagem alto (ISSUE-03).

### 5.2 Meta: risco de importar campanhas/leads para o tenant errado

SIM, risco ALTO e provado por leitura do codigo:

1. `me/adaccounts` e `me/accounts` retornam TUDO que o usuario Meta logado enxerga. O operador da agencia normalmente tem acesso aos 10 clientes via Business Manager. Ao conectar o Meta dentro do tenant do cliente A, `ads-sync.service.ts:32-71` importa TODAS as contas de anuncio, campanhas, criativos e insights dos 10 clientes para o tenant A. Nao ha tela de selecao de conta, nem filtro por `external_business_id`. Se o operador repetir em B, os mesmos dados tambem vao para B (a unicidade de `ad_campaigns` e por `(tenantId, externalId)`, nao global).
2. `meta_pages` tem `UNIQUE(page_id)` global e o `INSERT ... ON CONFLICT (page_id) DO UPDATE ... WHERE tenant_id = EXCLUDED.tenant_id` (`integrations.service.ts:140-144`) nao faz nada quando a pagina ja pertence a outro tenant, sem erro e sem aviso (so o `catch` de excecao loga, e aqui nao ha excecao). Resultado: todas as 10 paginas ficam do PRIMEIRO tenant que conectou. Leads de clientes B..J caem no tenant A (`resolve_tenant_by_meta_page`), e A busca o lead com o page token dele. Isso e vazamento de PII de um cliente para outro dentro da mesma agencia.
3. O callback e publico e o `state` nao e atrelado ao usuario nem consumido (ISSUE-05).
4. A RLS protege a leitura apos gravacao; o erro e de ROTEAMENTO na gravacao, onde a RLS nao ajuda.
5. Os testes (`002_isolation_test.sql`) so provam que um tenant nao le linhas do outro, nao cobrem "mesmo usuario Meta conectado em dois tenants".

Mitigacao necessaria antes de vender para agencias: selecao explicita de conta de anuncio e de pagina por tenant (allowlist), 1 `ad_account` externa pertence a no maximo 1 tenant (indice unico global em `ad_accounts(provider, external_id)` com resolucao de conflito visivel), e erro visivel quando a pagina ja pertence a outro cliente.

## 6. Problemas

### ISSUE-01 Token Meta curto, sem renovacao nem deteccao de expiracao
- SEVERITY: P0
- ROOT CAUSE: `exchangeCode` guarda o token que vem do codigo (curto, cerca de 1-2 h) e nunca faz troca por token longo; nao existe refresh job; `expiresAt` e gravado e nunca consultado; page tokens herdam a validade. Sem cron, a sync so roda no connect e no botao manual.
- FILES: `apps/api/src/integrations/providers/meta-ads.connector.ts:67-84`; `apps/api/src/integrations/ads-sync.service.ts:25-30,72`; `apps/api/src/integrations/integrations.service.ts:168-175`
- IMPACT: Dashboard de anuncios congela apos a primeira hora; Lead Ads para de buscar lead (`page_token`) logo depois; UI continua "Conectado". Classificacao: CODE_DEFECT.
- RECOMMENDED FIX: trocar por long-lived (`fb_exchange_token`) logo apos o callback; persistir `expiresAt` real via `debug_token`; job diario (BullMQ repeat) que revalida e marca `status='expired'`; exibir "Reconectar" na UI; sync agendado por integracao.
- ACCEPTANCE CRITERIA: teste com GraphClient mock verifica a troca e o `expiresAt` salvo; token vencido muda status para `expired` e a UI mostra reconectar; sync automatica diaria registrada em `ad_sync_runs`.

### ISSUE-02 Importacao e roteamento multi-cliente da Meta (conta de anuncio e pagina)
- SEVERITY: P0 (para agencias)
- ROOT CAUSE: o conector importa tudo o que o usuario enxerga; `meta_pages` usa `ON CONFLICT DO NOTHING`-equivalente silencioso; nao ha selecao por tenant.
- FILES: `integrations/providers/meta-ads.connector.ts:139-153`; `integrations/ads-sync.service.ts:32-71`; `integrations/integrations.service.ts:131-150`; `db/009_crm_f2.sql:117-146`
- IMPACT: campanhas e leads de um cliente aparecem em outro tenant; violacao de confidencialidade entre clientes da agencia. CODE_DEFECT.
- RECOMMENDED FIX: apos OAuth, retornar a lista e exigir selecao de ad accounts/paginas; gravar so as selecionadas; indice unico global de `ad_accounts(provider, external_id)`; quando `meta_pages` ja tem dono, devolver erro 409 com nome do tenant dono (sem vazar dados) em vez de ignorar.
- ACCEPTANCE CRITERIA: teste de integracao: mesmo usuario Meta conecta em tenant A e B com contas diferentes; cada tenant so ve as suas; conectar pagina ja mapeada retorna 409 visivel na UI.

### ISSUE-03 Evolution: mensagens recebidas descartadas enquanto o status do banco nao e `connected`
- SEVERITY: P1
- ROOT CAUSE: `connect` grava `status='connecting'`; so `status()` (poll da UI) promove para `connected`. O roteamento (`resolve_tenant_by_evolution_instance`) e o envio exigem `connected`. O webhook `connection.update` apenas loga. Se o operador fecha o modal logo apos escanear, o banco fica `connecting`; mensagens chegam, o controller responde 200 `instance_not_routed` e a Evolution nao reenvia. Do mesmo jeito, queda de conexao nunca atualiza o banco.
- FILES: `crm/messaging/whatsapp-connection.service.ts:73-94,116-120`; `crm/messaging/evolution-webhook.controller.ts:94-119`; `db/024_evolution_routing.sql:25-30`
- IMPACT: perda silenciosa de mensagens de lead; envio em producao com `config_required`. CODE_DEFECT.
- RECOMMENDED FIX: tratar `connection.update` (state=open/close) atualizando `integrations.status`; rotear por instancia independentemente de `connected` (ou incluir `connecting`); responder nao-2xx ou guardar o evento em `webhook_events` nao roteado para reprocesso.
- ACCEPTANCE CRITERIA: teste: `connection.update open` muda status; mensagem em instancia `connecting` e entregue ao tenant correto; evento sem dono fica registrado e visivel.

### ISSUE-04 Webhook Evolution/Stevo com segredo unico global e sem assinatura por tenant
- SEVERITY: P1
- ROOT CAUSE: um `EVOLUTION_WEBHOOK_TOKEN` unico no PATH; o tenant e decidido pelo campo `instance` do corpo, controlado por quem tem o token.
- FILES: `crm/messaging/evolution-webhook.controller.ts:77-130`; `crm/messaging/whatsapp.controller.ts:18-26`; `crm/messaging/stevo-webhook.controller.ts:24-38`
- IMPACT: quem vazar/ler o token (logs de proxy, container Evolution) forja mensagens para qualquer cliente e dispara automacoes. EXTERNAL se o ambiente isola a rede; CODE_DEFECT por nao haver segredo por instancia.
- RECOMMENDED FIX: segredo por instancia (derivado por HMAC de `instanceName`) no header, nao no path; validar `apikey` enviada pela Evolution; rate limit na rota publica.
- ACCEPTANCE CRITERIA: token de uma instancia nao aceita eventos de outra; teste negativo cobre.

### ISSUE-05 State OAuth sem vinculo com a sessao e sem uso unico
- SEVERITY: P1
- ROOT CAUSE: `signState` assina `{tenantId, provider, nonce, ts}` mas o `nonce` nunca e armazenado/consumido e o callback e `@Public()`; nao ha vinculo com identidade nem cookie.
- FILES: `integrations/integrations.service.ts:38-53,90-124`; `integrations/integrations.controller.ts:37-42`; `apps/web/app/api/integrations/meta/callback/route.ts:9-33`
- IMPACT: injecao de conta (login CSRF): atacante com URL de autorizacao do proprio tenant leva uma vitima a completar o fluxo e liga a conta Meta da vitima ao tenant do atacante, por ate 10 min, reutilizavel. CODE_DEFECT.
- RECOMMENDED FIX: gravar nonce em Redis com TTL e consumo unico; incluir `identityId` no state e cookie de sessao do navegador conferido no callback.
- ACCEPTANCE CRITERIA: reuso do state falha; state de outra sessao falha.

### ISSUE-06 UI mostra conectado/pronto para integracoes inexistentes
- SEVERITY: P1
- ROOT CAUSE: catalogo estatico; Instagram e Messenger usam `provider:'meta'`, entao `conectado('meta')` acende "Conectado" quando Meta Ads conecta; "Conectar" dispara o fluxo de Ads. Google Ads e TikTok exibem "Conectar" (com env, backend responde "provider nao suportado"). O rodape afirma "nada e simulado".
- FILES: `apps/web/components/app/IntegrationsMarketplace.tsx:48-63,117-118,158`; `apps/api/src/integrations/integrations.service.ts:31-35`
- IMPACT: usuario acredita ter DM de Instagram e Messenger no inbox; status exibido diferente do real. CODE_DEFECT (UI).
- RECOMMENDED FIX: marcar Instagram/Messenger/Google/TikTok como `planejado`; estado conectado por capability, nao por provider.
- ACCEPTANCE CRITERIA: conectar Meta Ads nao altera cards Instagram/Messenger; nenhum card com botao "Conectar" sem conector no backend.

### ISSUE-07 Stevo inviavel em producao
- SEVERITY: P2
- ROOT CAUSE: nenhum codigo cria `integrations provider='stevo'`; em producao o envio exige essa linha com `externalBusinessId`; fallback de tenant so em dev.
- FILES: `crm/messaging/messages.service.ts:55-59`; `crm/messaging/stevo-webhook.controller.ts:34`
- IMPACT: caminho legado so funciona com SQL manual; confunde. CODE_DEFECT (codigo morto).
- RECOMMENDED FIX: remover ou fornecer fluxo de conexao; documentar.
- ACCEPTANCE CRITERIA: decisao registrada; sem caminho que retorne `config_required` permanente.

### ISSUE-08 Metricas por criativo sempre vazias, sem paginacao e sem rate limit
- SEVERITY: P1
- ROOT CAUSE: `syncInsights` so busca `level=campaign`; `AdsService.creatives` procura `level='creative'` (que nunca e gravado). Sem `paging.next`; sem retry para codigos de rate limit.
- FILES: `integrations/providers/meta-ads.connector.ts:155-195`; `integrations/ads.service.ts:71-109`; `integrations/providers/meta-graph.client.ts:22-33`
- IMPACT: "melhor criativo" e ranking exibidos vazios/zero; dados truncados em contas grandes; sync falha em throttling. CODE_DEFECT.
- RECOMMENDED FIX: buscar insights em `level=ad` e mapear ad->creative; seguir `paging.next`; backoff em 4/17/613; ler `x-app-usage`.
- ACCEPTANCE CRITERIA: contas com 500+ campanhas importam completas; criativos mostram gasto por anuncio.

### ISSUE-09 Webhook Lead Ads sem assinatura de pagina; parser e tratamento de erro parciais
- SEVERITY: P1
- ROOT CAUSE: nao existe `subscribed_apps`; scope `pages_manage_metadata` ausente; webhook devolve 503 para pagina nao mapeada interrompendo o lote inteiro (eventos validos depois do primeiro desconhecido sao perdidos ate a Meta reenviar).
- FILES: `integrations/providers/meta-ads.connector.ts:26-29`; `integrations/meta-webhook.controller.ts:51-60`
- IMPACT: leads nao chegam sem acao manual do operador no painel Meta. CODE_DEFECT; aprovacao do `leads_retrieval` e EXTERNAL_BLOCKER.
- RECOMMENDED FIX: assinar a pagina apos selecao; processar o lote sem abortar; registrar eventos nao mapeados.
- ACCEPTANCE CRITERIA: teste com lote misto; guia de subscricao automatica.

### ISSUE-10 Stripe sem webhook; Calendar stub; sem webhooks de saida
- SEVERITY: P2
- ROOT CAUSE: `STRIPE_WEBHOOK_SECRET` nao e usado; `sincronizarCalendar` so lanca; nao ha dispatcher de saida.
- FILES: `financeiro/financeiro.service.ts:106-145`; `agenda/agenda.service.ts:110-119`; `config/env.ts:41`
- IMPACT: link de pagamento criado, mas cobranca nunca vira "paga"; promessa de sincronizacao de agenda inexistente. UI ja diz "em breve" (honesto).
- RECOMMENDED FIX: endpoint `/webhooks/stripe` com `stripe-signature`, idempotencia por `event.id`; ou retirar do escopo comercial.
- ACCEPTANCE CRITERIA: `checkout.session.completed` marca cobranca paga; assinatura invalida 400.

### ISSUE-11 Pontos menores
- SEVERITY: P3
- Itens: `EVOLUTION_BASE_URL`, `EVOLUTION_WEBHOOK_TOKEN`, `EVOLUTION_WEBHOOK_URL` lidos via `process.env` sem constar em `env.ts` (que declara `EVOLUTION_API_URL` nao usado: validacao nao protege); chave de criptografia sem versao (nao ha rotacao); `lastUsedAt` das API keys nunca atualizado; dedupe de inbound registra `provider='stevo'` tambem para Evolution; `credentialsEncrypted` de Evolution guarda token da instancia que nunca e usado; sem endpoint de desconexao Meta/revoke.
- FILES: `config/env.ts:43-44`; `crm/messaging/messages.service.ts:106-107`; `auth/jwt-auth.guard.ts:37-47`; `integrations/crypto.service.ts`
- RECOMMENDED FIX: alinhar env, versao de chave (`kid`), atualizar `lastUsedAt`, endpoint `DELETE integrations/:id`.
- ACCEPTANCE CRITERIA: env validado no boot; rotacao testada.

## 7. EXTERNAL_BLOCKER vs CODE_DEFECT

| Item | Classe |
|---|---|
| App Review/Advanced Access `leads_retrieval`, `ads_read`, `pages_*`; Business Verification | EXTERNAL_BLOCKER |
| Developer token do Google Ads; app review do TikTok | EXTERNAL_BLOCKER |
| Politica da Meta sobre WhatsApp nao oficial / risco de banimento Baileys | EXTERNAL (risco de produto) |
| Servidor Evolution e URL publica do webhook (infra do operador) | EXTERNAL |
| ISSUE-01 a 11 | CODE_DEFECT |
| Versao Graph v21.0 ainda aceita | NAO VERIFICAVEL (checar changelog) |
| Comportamento real de `messages.upsert` na Evolution | NAO VERIFICAVEL (admitido no codigo) |

## 8. Priorizacao

### Pequenas agencias de trafego pago (1 a 5 clientes, 1 operador)
- P0: ISSUE-01 (token Meta durar), ISSUE-02 (selecao de conta/pagina; sem isso leads e metricas misturam clientes), ISSUE-03 (nao perder mensagens WhatsApp).
- P1: ISSUE-08 (metricas por criativo e paginacao, e o valor central do produto), ISSUE-09 (Lead Ads de ponta a ponta), ISSUE-06 (UI honesta), ISSUE-05.
- P2: sync agendado, desconexao, Stripe webhook (se cobram clientes), documentacao de risco Baileys.
- P3: ISSUE-11.

### Agencias maiores (10+ clientes, varios operadores)
- P0: ISSUE-02 como bloqueio absoluto, ISSUE-04 (segredo por instancia), ISSUE-05, selecao de clientes por membro (ja existe `agency_member_client_access`; validar uso no fluxo de conexao), auditoria de quem conectou.
- P1: rate limit Meta por app (app-usage), fila por tenant, fila de reprocesso de leads, monitor de conexoes expiradas em Agency Home, rotacao de chaves.
- P2: Business Manager/System User tokens (nao dependem de usuario individual), WhatsApp Cloud API oficial.
- P3: logs de auditoria exportaveis.

### Diferencial futuro
- Google Ads e TikTok Ads (interface `AdsConnector` ja existe), Meta Conversions API (fechar loop de ROAS por venda real), Instagram DM, WhatsApp Cloud API, webhooks de saida e conectores Zapier/n8n/Make, Calendar nos dois sentidos, Stripe Connect por cliente.

## 9. O que foi e o que nao foi verificado

- Verificado por leitura: fluxos, SQL, RLS, assinatura HMAC do webhook Meta (correta), cripto AES-GCM (correta), roteamento SECURITY DEFINER, idempotencia de envio.
- NAO verificado: qualquer comportamento real de Meta, Evolution, Stripe, Resend. Nenhum teste rodado nesta auditoria. Os specs existentes usam mocks.
- Nao ha prova de NATIVE_VERIFIED para nenhuma integracao.

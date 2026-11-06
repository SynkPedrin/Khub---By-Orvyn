# Backlog — Orvyn

> Backlog priorizado. **Nenhuma feature entra no código sem estar aqui com critério de aceite testável.** Estados: `[ ]` a fazer · `[~]` em andamento · `[x]` concluída · `[!]` bloqueada.
> Ver [[Sprint]] (sprint atual) · [[PRD]] · [[Arquitetura]] · [[Banco]] · [[APIs]] · [[RegrasNegocio]].

---

## Revenue OS — os 8 módulos  *(aprovado pelo product owner em 2026-11-06 · ADR-0030)*

Ordem acordada: **RV-01.1 (SEC-01, P0)** → **Sprint AG = RV-03 + RV-06** → RV-07 → RV-08 → RV-02.1 · RV-04 · RV-01.2–4 · RV-05.
Toda tabela nova: `tenant_id NOT NULL` + RLS FORCE + policy `tenant_rw` + bloco no `db/002_isolation_test.sql`. Migração aditiva, com rollback descrito em [[Banco]].

### RV-01 — Agency Manager
- [ ] **RV-01.1 (P0 · SEC-01)** — Remover membro da agência e arquivar cliente **revogam o acesso**.
  - Aceite: `DELETE /v1/agency/members/:id` apaga `agency_members`, `agency_member_client_access` e as `memberships` nos tenants dos clientes, e chama `TokenService.revokeAllForIdentity`; arquivar cliente revoga os acessos ao tenant dele; o cenário `[SEC-01]` do runtime passa a devolver 401/403; teste unitário + cenário QA.
- [ ] **RV-01.2** — Unidades: tabela `units` (`tenant_id`, `nome`, `endereco`, `fuso`, `telefone`, `ativo`) + `unit_id` opcional em `contacts`, `agenda_compromissos` e `conversations`.
  - Aceite: CRUD em Configurações › Unidades; filtro por unidade em Leads, Agenda e Conversas; isolamento no `db/002`.
- [ ] **RV-01.3** — Contratos: `agency_contracts` (`agency_id`, `client_account_id`, `plano`, `valor_mensal`, `inicio`, `fim`, `status`, `documento_uri`), isolada por agência.
  - Aceite: CRUD em `/agency/clients/:id`; alerta de vencimento em 30 dias; agência A não lê contrato da agência B (teste).
- [ ] **RV-01.4** — Permissões granulares: `memberships.role` vira enum validado (`owner|admin|gestor|atendente|leitura`) + matriz de permissão por módulo no guard.
  - Aceite: `atendente` recebe 403 em Configurações e Financeiro; teste por papel.

### RV-02 — CRM & Pipeline
- [ ] **RV-02.1** — Campos personalizados com definição: `custom_field_defs` (`tenant_id`, `entidade` contact|deal|company, `chave`, `rotulo`, `tipo` text|number|date|select|boolean, `opcoes` jsonb, `obrigatorio`, `ordem`). Valores seguem em `contacts.campos_custom` (+ coluna equivalente em `deals`/`companies`).
  - Aceite: CRUD em Configurações › Campos; formulário do contato renderiza e valida pelo tipo; filtro por campo em Leads; isolamento no `db/002`.

### RV-03 — Agent Manager  *(Sprint AG)*
- [ ] **RV-03.1** — Schema `agents` + `agent_runs` (`db/030_agents.sql`, desenho em [[Banco]] §2.8).
  - Aceite: RLS FORCE + `tenant_rw`; `tenant_reference` cobre `conversations.agent_id` e `messages.agent_id`; bloco 17 no `db/002` (A não lê nem escreve agente/run de B).
- [ ] **RV-03.2** — API `/v1/agents`: CRUD, ativar/pausar, catálogo (modelos, tons, ferramentas, escopos de conhecimento) e `testar` (sandbox, não envia WhatsApp).
  - Aceite: modelo e ferramentas validados contra allowlist (400 fora dela); só `owner`/`admin` escreve; `testar` responde 501 `config_required` sem `ANTHROPIC_API_KEY`; testes unitários.
- [ ] **RV-03.3** — Runtime do agente: mensagem do contato em conversa com `atendimento='ia'` → job `agent-replies` (jobId = id da mensagem) → o agente responde pelo `MessagesService` com idempotência `agent:<messageId>`.
  - Aceite: tools escopadas ao contato da conversa (o `contactId` nunca vem do modelo); guardrail camada 2; limites (respostas por conversa, caracteres por mensagem); recusa, erro, falta de credencial e limite atingido **transferem para humano** (lead nunca fica sem resposta); custo em `ai_usage_events`; resposta da IA não dispara o agente de novo; teste unitário para cada desvio.
- [ ] **RV-03.4** — UI `/agentes`: lista, editor (identidade, modelo, personalidade, instruções, ferramentas, limites, conhecimento, canal/padrão) e playground de teste.
  - Aceite: typecheck, lint e testes verdes; verificado no navegador.

### RV-04 — Knowledge Base
- [ ] **RV-04.1** — Ingestão por URL (fetch + limpeza do HTML → mesmo pipeline de chunking), com limite de páginas e respeito a `robots.txt`.
  - Aceite: documento com `fonte='url'` e `uri`; `rag:eval` sem regressão (delta reportado).
- [ ] **RV-04.2** — FAQ estruturado (cada par pergunta/resposta vira um chunk).
  - Aceite: CRUD em `/conhecimento`; a resposta exata aparece no top-1 do eval para a pergunta cadastrada.
- [ ] **RV-04.3** — Conhecimento por agente: filtro por documento **dentro do WHERE** da busca (invariante 5).
  - Aceite: `rag:eval` com delta reportado (invariante 6); agente só cita documentos permitidos.

### RV-05 — Automation Builder
- [ ] **RV-05.1** — Corrigir `ramos is not iterable` (nó de ramificação com config sem `ramos`; visto no worker em 2026-11-06). Registrar em [[Bugs]] com reprodução.
  - Aceite: teste de regressão com config legada; run não entra em retry infinito.
- [ ] **RV-05.2** — Gatilhos novos: `agendamento_criado`, `agendamento_confirmado`, `faltou` e `conversa_transferida` (IA → humano).
  - Aceite: eventos nascem no outbox (trigger SQL); aparecem na paleta; testes no `triggers.service`.

### RV-06 — Omnichannel Inbox  *(Sprint AG)*
- [ ] **RV-06.1** — Atendimento IA/humano na conversa: colunas `atendimento`, `agent_id`, `assignee_id`, `handoff_motivo`, `handoff_at` (`db/030`).
  - Aceite: conversa nova nasce `ia` se houver agente padrão ativo para o canal, senão `humano`; humano que envia mensagem assume a conversa.
- [ ] **RV-06.2** — Transferência e distribuição: `PATCH /v1/crm/conversations/:id/atendimento` (assumir, devolver para IA, atribuir); a transferência feita pela IA atribui ao membro com menos conversas humanas abertas.
  - Aceite: teste unitário da distribuição; auditoria; evento realtime `conversation.updated` com o novo estado.
- [ ] **RV-06.3** — UI em `/conversas`: selo IA/Humano, filtros (Todas · IA · Humano · Minhas), Assumir · Devolver para IA · Atribuir, mensagem da IA identificada.
  - Aceite: verificado no navegador.

### RV-07 — Calendar & Sales
- [ ] **RV-07.1** — Confirmação de agendamento: status `confirmado`; lembrete D-1 por automação; resposta afirmativa confirma.
- [ ] **RV-07.2** — Recuperação de faltas: status `faltou` + gatilho para fluxo de reagendamento.
- [ ] **RV-07.3** — Propostas: `proposals` (`tenant_id`, `deal_id`, `contact_id`, `itens` jsonb, `valor_total`, `validade`, `status` rascunho|enviada|aceita|recusada, `aceita_em`) + link público assinado; aceite move o negócio para ganho.
- [ ] **RV-07.4** — Agente que agenda: tools `consultar_horarios` e `agendar` para os agentes (depende de RV-03.3).
  - Aceite (módulo): testes por status; isolamento de `proposals` no `db/002`; verificado no navegador.

### RV-08 — Analytics & Revenue
- [ ] **RV-08.1** — Tempo de resposta (primeira resposta e média; humano × IA) calculado de `messages`.
- [ ] **RV-08.2** — Funil de receita por origem: lead → conversa → agendamento → proposta → venda, com receita por origem e campanha.
- [ ] **RV-08.3** — Desempenho dos agentes: conversas atendidas, transferências, custo e taxa de resolução (de `agent_runs`).
  - Aceite (módulo): números conferidos contra consulta SQL direta num tenant de teste; só leitura, sempre sob RLS.

---

## Trilha P — "Só faltar as APIs" (produto pronto, sem credencial) — em execução

Pedido: fazer tudo que NÃO depende de API, testado, até só faltar plugar chave. Ordem por valor.

- [x] **P1 — Nyro configuradora** (o diferencial nº 1). 3 tools de configuração: `criar_funil` (pipeline+etapas), `criar_etapa`, `instalar_automacao` (busca no marketplace e instala/publica). `CrmService.createPipeline/createStage` novos; tool-executor injeta `MarketplaceService` (NyroModule → MarketplaceModule, sem ciclo); conversor Zod→JSONSchema ganhou `ZodArray`; Arquiteta recebeu as tools + prompt "você MONTA o CRM". **Novo spec `tool-executor`** (6 testes — paga D-05). Suíte **221 verdes**. Agora a Nyro consegue montar funil e trazer automações — só falta crédito Anthropic para *rodar*.
- [~] **P2 — Blueprints por nicho** ✅ (ADR-0022): `playbooks.ts` (odonto/advocacia/contábil, com guardrails CFM/OAB/CFC), `BlueprintService.aplicar` (funil+automações, nativo, idempotente), `GET/POST /v1/blueprints`, tool `aplicar_blueprint`. **227 testes.** · Falta a **tela de onboarding** (a Nyro conduzindo a tela vazia → descobre nicho → aplica) — próximo.
- [x] **Binding de variáveis no install + Onboarding** (ADR-0028): install substitui `{{var.X}}` pelos valores (modal de binding na Biblioteca; defaults do template) — testado com grafo publicado. Página `/onboarding` (blueprints por nicho, sem API) + CTA no empty-state. **BUG-003 corrigido/verificado.** **229 testes.**
- [x] **Analytics + custo de IA por tenant** (ADR-0027): `AnalyticsModule` (`/v1/analytics/ai-usage` + `/automacoes`, RLS) · UI `/analytics` ("Análises"). **Circuit breaker** estendido a Voyage + Meta Graph. DLQ ads-sync/ingestion: já é dead-letter em nível de registro (status `failed`+`erro`) — sem tabela redundante. **229 testes.**
- [x] **P3 — Agenda** (ADR-0026): schema `db/021` + RLS + isolamento · módulo `/v1/agenda/*` (compromissos CRUD, status, **horários livres**, sincronizar) · UI `/agenda` com sugestão de horários e prevenção de choque (409). **Google Calendar gated** (`config.require('google_calendar')`). **229 testes.**
- [~] **P4 — Produção** (ADR-0024): ✅ rate limit por tenant/IP (Redis, fail-open, 429 comprovado) · ✅ circuit breaker (Anthropic) · ✅ security headers + CORS allowlist · ✅ health com Redis · ✅ observabilidade (correlation-id ALS + logs JSON + ErrorReporter Sentry-ready) · ✅ **deploy kit** (Dockerfile api/web, CI com gate de isolamento RLS, `schema_migrations` rastreado). **229 testes.** · Falta: **custo de IA por tenant** (medição em `ai_usage_events`), circuit breaker no Voyage/Meta, DLQ em ads-sync/ingestion.
- [~] **P5 — UIs** ✅ parcial: **`/nyro` virou chat full-page estilo Claude** (hook `useNyroChat` + `NyroMensagens` compartilhados com o dock — sem duplicar; mata o "Chega na F3"). Sidebar: **Marketing→Biblioteca** + **Anúncios** (isActive "mais específico vence"). **Biblioteca** = frameworks + **automações prontas do marketplace** (instalar 1-clique via `lib/marketplace`). Automações com **intro/tutorial** (3 passos). **Gerenciador de anúncios simulado** (`AdsSimulador`: campanha→conjunto→anúncio, métricas por orçamento, pausar/ativar, localStorage) na página de Anúncios. Typecheck Web OK. · Falta: **binding de variáveis** na instalação (templates com stageId).
- [~] **P6 — Financeiro** (ADR-0025): ✅ schema `db/020` + RLS + isolamento · módulo `/v1/financeiro/*` (cobranças CRUD, resumo, status) · UI `/financeiro` (KPIs, criar, marcar paga) · **link de pagamento Stripe via REST direto** (sem SDK — 501 config_required sem `STRIPE_SECRET_KEY`, funciona com a chave). **229 testes.** · Falta: **Ads write** real (gated Meta) para aposentar o simulador localStorage.
- [ ] **P7 — Dívida de teste**: tasks/notes (D-02), settings (D-06).

## Trilha W — Paridade de motor com o GHL (identidade Orvyn) — ADR-0015

Pedido: "workflow igual ao do GHL, mas com a identidade da Orvyn". Escopo = igualar **motor + UX**, nunca clonar menu de módulo inexistente (ver ADR-0015). Uma sprint por sessão.

- [x] **W1** — Nó `acao.enviar_email` (canal oficial SMTP via `MailerService`; assunto+corpo com `{{contato.nome}}`). *Aceite:* ✅ envia pro e-mail do contato interpolado; sem `SMTP_URL` → passo `config_required` (não quebra); falha real de SMTP → exceção (retry/DLQ); contato sem e-mail → erro explícito. **198 testes verdes** (+4), typecheck API+Web verde. Catálogo 21 → 22.
- [x] **W2** — `controle.split` (A/B **determinístico** FNV-1a) + `controle.drip` (lote por janela; UPSERT atômico em `workflow_drip_counters`/`db/015`, RLS, reagenda na próxima janela). Editor de variantes (peso+%) e de lote. **4 testes** (determinismo, distribuição 3:1, drip libera/segura). ✅ ADR-0019.
- [x] **W-var** — `acao.definir_variavel` (variáveis do fluxo no `Contexto`; `{{variaveis.x}}` via `valorDoCampo`). Editor nome+valor, **2 testes**. Base de personalização dos templates.
- [x] **W3b** — `acao.formatar_texto` (telefone/moeda/caixa/dígitos → variável; reusa `soDigitos`). Catálogo → **28 nós**. **1 teste** (telefone BR + moeda R$). Suíte **211 verdes**. Personalização das mensagens.
- [x] **W3a** — `gatilho.negocio_status` (ganho/perdido). CRM publica `deal.status_changed` no barramento (`RealtimeEvents`), `triggers.service` roteia + filtra por status, contexto monta o negócio. Novo **spec de `triggers.service`** (4 testes de `filtroBate` — paga parte da D-04). Catálogo → **27 nós**. Suíte **210 verdes**. Destrava templates de pós-venda/reativação.
- [x] **W-ai** — `AiModule` compartilhado (`AnthropicProvider` movido p/ `ai/`, `@Global`, sem duplicar) + nó `acao.ia` (classificar/pontuar/resumir/responder/extrair; gated; resultado → variável). **2 testes** (grava variável; gating). Catálogo → **26 nós**. Suíte **206 verdes**. ✅ ADR-0019. Ativa a categoria IA do futuro marketplace.
- [ ] **W3** — Gatilhos sem módulo novo: `Scheduler` (dispara por tempo, sem contato), `Form Submitted`, `Custom Date/Birthday Reminder`, `Opportunity Status` (ganho/perdido). *Aceite:* cada gatilho abre run no evento certo; isolamento no `db/002`.
- [!] **W4** — `acao.dnd` (liga/desliga) + `acao.atribuir_usuario`. **Bloqueada:** exige coluna nova em `Contact` (`dnd boolean`, `owner_id uuid`) — decisão estrutural, PARA e pede aprovação antes de codar. *Aceite:* DND some da fila de envio; atribuição grava dono e aparece no 360.
- [ ] **W5** — Settings restantes (Sender Details, Mark as Read) + **verificação de assinatura no `gatilho.webhook` de entrada** (HMAC/segredo por fluxo). *Aceite:* webhook com assinatura inválida → 401 sem abrir run; settings persistem e afetam o envio.

---

## Sprint F — Nyro IA  *(concluída 2026-07-17 — ver [[Sprint]])*

- [x] **F-1** — Schema `db/013`: nyro_conversations, nyro_messages, nyro_actions, nyro_memory, ai_usage_events (+ nyro_guardrail_hits do R0). RLS em todas; `db/002` bloco 14. ✅
- [x] **F-2** — 14 tools tipadas (Zod + sensibilidade), fechando a LACUNA do PRD §5.1. Zod→JSON Schema próprio. ✅ ADR-0014.
- [x] **F-3** — Orquestrador: roteador Haiku + 4 sub-agentes (Sonnet), cada um com suas tools. Teto de 5 voltas. ✅
- [x] **F-4** — Executor de tools via serviços do CRM/automações (nunca banco direto), auditado `actor:'nyro'`. ✅
- [x] **F-5** — Human-in-the-loop: ação sensível vira `nyro_actions` pendente; só o humano aprova. ✅
- [x] **F-6** — Guardrails 2 camadas (prompt CFM/OAB + validador pós-resposta), 13 testes. ✅
- [x] **F-7** — Front: chat real com passos ao vivo + aprovação; gated com "Configurar Claude". ✅

**Saldo:** 154 testes verdes (era 130) · migration `db/013` · [[Bugs|BUG-013]] · **gating verificado, respostas dependem da `ANTHROPIC_API_KEY`.**

---

## Sprint E.2 — Workflow builder completo (UX)  *(concluída 2026-07-17 — ver [[Sprint]])*

Pedido do usuário com a referência do GHL (categorias, waits, chaining, webhooks, settings), filtrado pelo que **existe** no Orvyn.

- [x] **E2-1** — Catálogo 15 → **21 nós** agrupados por categoria (Contato/Negócios/Comunicação/Dados/Fluxo/Ferramentas internas). *Aceite:* `GET /catalogo` devolve 21 com `grupo`. ✅ ADR-0013.
- [x] **E2-2** — `controle.esperar_resposta` com ramos fixos Respondeu/Não respondeu; quem responde **não** recebe follow-up. *Aceite:* 5 testes do nó + resposta acorda o run na hora. ✅
- [x] **E2-3** — `gatilho.webhook` + `POST /v1/hooks/:chave` (público, chave revogável, 202 sempre) e `resolve_workflow_by_webhook_key` (`db/011`). ✅
- [x] **E2-4** — Configurações do fluxo: reentrada, parar no reply, janela de envio + timezone (`db/011`). *Aceite:* 9 testes (3h da manhã adia; sábado espera até segunda; tag roda a qualquer hora; `uma_vez` bloqueia). ✅
- [x] **E2-5** — Encadeamento (`acao.chamar_workflow`), `controle.encerrar`, `acao.criar_nota`, `gatilho.negocio_criado`. ✅
- [x] **E2-6** — UX: painel "Adicionar" com busca focada + sinônimos, nó nasce configurado e já conectado, canvas vazio ensina o começo, zoom/fit/minimap. ✅

**Saldo:** 123 testes verdes (era 109) · migration `db/011` · **fora de escopo consciente:** Appointments, Payments, Courses, Affiliate, IVR, Communities, Certificates, Ecommerce, Google Ads, Eliza, Custom Objects — não existem no produto (ver ADR-0013).

---

## Sprint E — Motor de Automações (F4)  *(concluída 2026-07-17 — ver [[Sprint]])*

- [x] **E-1** — Congelar os 15 nós + Zod por tipo (`catalogo.ts`), fechando a LACUNA do [[PRD]] §7.1. *Aceite:* `GET /v1/automations/catalogo` devolve 15; publicar nó fora do catálogo é recusado. ✅ ADR-0012.
- [x] **E-2** — Schema `db/010`: workflows, versions (imutável), runs (estado + dedupe), run_steps, dlq — RLS em todas. *Aceite:* `db/002` prova que A não vê grafo/estado/log/DLQ de B. ✅
- [x] **E-3** — Engine: 1 job = 1 nó, espera por delay, retry exponencial, DLQ + reprocessar, `aoFalhar:'seguir'`, loop barrado em 200 passos. *Aceite:* espera sobrevive a restart; retry esgotado cai no DLQ com o run marcado. ✅
- [x] **E-4** — Barramento `events` (fan-out socket + fila) para quebrar o ciclo crm↔automations. *Aceite:* CRM não importa automations e o gatilho dispara. ✅
- [x] **E-5** — Ações pelos serviços do CRM (auditadas, sob RLS): SMS, tags, contato, oportunidade, etapa, tarefa, webhook (com bloqueio de SSRF). *Aceite:* fluxo cria oportunidade real e manda mensagem real. ✅
- [x] **E-6** — Canvas React Flow: drag-and-drop, saída por ramo no If/Else, painel por nó, autosave no rascunho, validação apontando o nó problemático, publicar/pausar/rollback. ✅
- [x] **E-7** — Execuções: timeline nó-a-nó ao vivo, cancelar, DLQ, teste com contato real (avisando que executa de verdade). ✅

**Saldo:** 109 testes verdes (era 75) · migration `db/010` · [[Bugs|BUG-010]] e [[Bugs|BUG-011]] achados e corrigidos · `db/002` estendido.

**Fora de escopo (consciente):** nós de IA (Sprint F, atrás de `ANTHROPIC_API_KEY`) · split A/B, horário comercial e nó de Stripe (pós-MVP) · automações prontas dos 3 templates verticais (F2/blueprints).

---

## Sprint D2 — Tempo real  *(concluída 2026-07-16 — ver [[Sprint]])*

- [x] **D2-1** — Definir a LACUNA de [[APIs]] §6: Socket.IO, namespace `/rt`, envelope tipado em `@orvyn/types`. ✅ ADR-0011.
- [x] **D2-2** — Auth do socket: `POST /v1/auth/ws-ticket` (`typ:'ws'`, 60s) + rota Next; guard REST recusa ticket. *Aceite:* ticket inválido/expirado/forjado recusado; access token não abre socket. ✅
- [x] **D2-3** — Gateway com sala por tenant. *Aceite:* evento de A chega em A e **não** chega em B (provado com socket real). ✅
- [x] **D2-4** — Emissores: inbox (`message.created`, `conversation.updated`, `contact.created`) e funil (`deal.*`), sempre pós-commit. *Aceite:* mover card pela API → evento no socket; operação que falha não publica. ✅
- [x] **D2-5** — Front ao vivo: `useRealtime()`, inbox e pipeline, indicador de conexão e **fallback para polling** ao cair. *Aceite:* socket derrubado → tela continua atualizando (5s), sem congelar. ✅
- [x] **D2-6** — Reconexão com ticket novo a cada tentativa + `RedisIoAdapter` para múltiplas instâncias. ✅

**Saldo:** 75 testes verdes (era 61) · `@orvyn/web` passou a depender de `@orvyn/types` · canal `automation.run` pronto para o Sprint E.

---

## Sprint D1 — Fechar o CRM (F2)  *(concluída 2026-07-16 — ver [[Sprint]])*

- [x] **D1-1** — Schema F2: `companies`, `tasks`, `notes`, `meta_pages` + `contacts.company_id` (`db/009_crm_f2.sql`), RLS + FORCE em todas. *Aceite:* `db/002` prova que A não vê empresa/tarefa/nota/página de B e não escreve no tenant de B. ✅
- [x] **D1-2** — Perfil 360 (`GET /v1/crm/contacts/:id` + `/contatos/[id]`): contato, empresa, negócios, conversas, tarefas, notas e timeline numa transação. *Aceite:* abrir um contato mostra tudo dele sem N+1. ✅
- [x] **D1-3** — Editar/excluir contato e negócio (API + UI), incluindo `DealDrawer` com `?deal=` e o "Novo negócio" funcionando. *Aceite:* criar → editar → excluir pela UI, com 404 depois. ✅
- [x] **D1-4** — Empresas, tarefas e notas: CRUD + telas `/empresas`, `/empresas/[id]`, `/tarefas`. *Aceite:* empresa duplicada → 409; tarefa atrasada aparece no filtro; nota só o autor edita. ✅
- [x] **D1-5** — Paginação por cursor em contatos (`?cursor=&limit=`). *Aceite:* 9 contatos em 3 páginas, zero duplicados, cursor inválido → 400. Fecha [[Bugs|BUG-009]]. ✅
- [x] **D1-6** — Meta lead → contato: `page_id ↔ tenant` (`meta_pages` + `resolve_tenant_by_meta_page`), dedupe em `webhook_events`, Graph com credencial do tenant, `LeadsService.upsertFromLead` (não duplica contato), assinatura HMAC do corpo cru. *Aceite:* webhook roteia para o tenant certo; sem credencial, registra e **não inventa** contato. ✅

**Saldo:** 61 testes verdes (era 40) · migration `db/009` · `db/002` estendido (4 tabelas novas + roteamento Meta).

---

## Sprint 0 — Desbloqueio e gating por credencial  *(concluída 2026-07-16 — ver [[Sprint]])*
Contrato: [[Brief-Finalizacao]] §2. Critério da sprint: **só falta plugar credencial, nunca escrever código.**

- [x] **S0-1** — `ConfigService` global (único leitor de env) + `ConfigRequiredException` 501 + fallback lexical do RAG (`db/007`). *Aceite:* canário com `.env` sem terceiros sobe com 0 erros; externas → 501 `{code:config_required, provider, missing[]}`; RAG → BM25 com `warn`. ✅ ADR-0008.
- [x] **S0-2** — `POST /v1/auth/invites/accept` + `/signup?invite=`. *Aceite:* aceite entra no **tenant do convite** com a role certa; token de uso único (2ª vez → 400); auditado. ✅ ADR-0009.
- [x] **S0-3** — Entrega WhatsApp gated (mensagem **persiste** + `config_required`) + UI "Configurar {provider}" (`ApiError`/`ConfigRequired`) + roteamento real instância→tenant do webhook (`db/008`, `SECURITY DEFINER`). *Aceite:* sem credencial → salva e mostra as vars que faltam. ✅
- [x] **S0-4** — `GET /v1/crm/search?q=` + ⌘K sobre dados reais (fecha [[Bugs|BUG-004]]). *Aceite:* "mar" acha contato/negócio/conversa reais; RLS isola. ✅
- [x] **S0-5** — `AuditInterceptor` global (toda mutação autenticada) + `@SkipAudit()` para quem já audita; `GET/POST /v1/settings/notifications` derivadas do estado real + sino real. *Aceite:* `contacts.create` aparece em Auditoria; sino lista não lidas e zera o badge. ✅
- [x] **S0-doc** — `docs/ENV.md` (fonte única: provedor · vars · onde obter · o que acontece sem) + `apps/api/.env.example` completo. ✅

**Saldo:** 40 testes verdes (era 33) · migrations `db/007`, `db/008` · `db/002` estendido com o roteamento do STEVO.

---

## F0 — Fundação
Critério de sucesso da fase (PRD §16): **conta criada e isolada por RLS; deploy automatizado; design system publicado; vault Obsidian completo. Teste automatizado prova que tenant A não lê dado do tenant B.**

### Bloco 1 — Cérebro
- [x] **F0-01** — Criar vault `Nyro IA/cerebro/` com os 8 arquivos.
  - Aceite: existem `PRD.md`, `Arquitetura.md`, `Banco.md`, `APIs.md`, `RegrasNegocio.md`, `Tasks.md`, `Bugs.md`, `Sprint.md` + pasta `Blueprints/`.
- [x] **F0-02** — Transcrever o PDF para PRD/Arquitetura/Banco/APIs/RegrasNegocio, marcando `⚠️ LACUNA` no que o documento não define.
  - Aceite: cada seção do PDF (1–19) presente sem resumo; toda lacuna marcada.
- [x] **F0-03** — Popular `Tasks.md` com backlog F0 e F1, cada task com critério de aceite testável.
  - Aceite: este arquivo, com IDs e critérios verificáveis.
- [x] **F0-04** — Escrever `Sprint.md` com objetivo único da semana 1.
  - Aceite: [[Sprint]] com 1 objetivo, ≤5 tasks e Definition of Done.
- [x] **F0-05** — Criar `CLAUDE.md` na raiz apontando para o cérebro e replicando as regras.
  - Aceite: `CLAUDE.md` existe na raiz, referencia `Nyro IA/cerebro/*` e o protocolo de tarefa.
- [ ] **F0-06** — **[GATE] Aprovação do cérebro pelo usuário.** Nenhuma linha de código antes disso.
  - Aceite: usuário aprova explicitamente o conteúdo do cérebro.

### Bloco 2 — Monorepo e infra
- [x] **F0-07** — Monorepo (`apps/web` Next.js, `apps/api` NestJS, `packages/config`, `packages/types`; `packages/ui` adiado → F0-15).
  - Aceite: `pnpm install` resolve; `pnpm build` (turbo) → 2/2 apps; API sobe e responde `/v1/health`. **Verificado.** ADR-0002 fixado com versões. `packages/ui` pendente.
- [~] **F0-08** — Docker Compose local: Postgres + pgvector + Redis.
  - Escrito: `docker-compose.yml` (`pgvector/pgvector:pg16` + `redis:7`, migrations montadas em `initdb.d`). **Não executado** (sem Docker nesta máquina). Aceite fecha ao rodar `docker compose up` e a extensão `vector` habilitar.
- [ ] **F0-09** — Prisma: schema inicial (`tenants`, `users`, `audit_logs`) + migração com policies RLS.
  - Aceite: `prisma migrate` aplica; tabelas existem; `ENABLE/FORCE ROW LEVEL SECURITY` + policy `tenant_isolation` presentes na migração SQL; `audit_logs` append-only (UPDATE/DELETE negados ao role da app).
- [ ] **F0-10** — CI/CD: lint, typecheck, testes, build, deploy preview.
  - Aceite: pipeline verde num PR de exemplo; falha se lint/typecheck/teste falham; preview do `web` publicado.

### Bloco 3 — Auth e multi-tenant
- [ ] **F0-11** — `auth`: signup, login, OAuth Google, JWT curto + refresh, convites de equipe, roles.
  - Aceite: signup cria tenant + user; login retorna access+refresh; refresh renova; OAuth Google conclui; convite gera e aceita membro; testes de integração passam.
- [ ] **F0-12** — `tenants` + contexto de tenant: middleware faz `SET LOCAL app.tenant_id` em toda request autenticada.
  - Aceite: request sem tenant válido → 401/403; com tenant → queries enxergam só o próprio tenant; ADR-0003 registrado.
- [ ] **F0-13** — `audit`: log imutável de toda ação (`actor` = user_id | 'nyro').
  - Aceite: ações de escrita geram linha em `audit_logs`; tentativa de UPDATE/DELETE no log falha; `GET /v1/audit-logs` lista só do tenant.
- [ ] **F0-14** — **[CRITÉRIO DE ACEITE DE F0] Teste automatizado de isolamento entre tenants.**
  - Aceite: teste cria tenant A e B com dados; autenticado como A, consulta recurso de B → **0 linhas / 404**; roda no CI e barra o merge se falhar.

### Bloco 4 — Design system  *(parcialmente entregue via `apps/web` — ADR-0005)*
- [x] **F0-CW** — App `apps/web` (Next.js 14) com o **cérebro Obsidian como backend** (MVP direcionado pelo product owner).
  - Aceite: `npm run build` verde; `/api/health` retorna `backend:cerebro-obsidian` + contagem de docs; `/api/cerebro/[...slug]` serve documento e bloqueia path-traversal (404). **Verificado em runtime** (porta 3221).
- [~] **F0-15** — Tokens de marca a partir dos assets reais (`logo.png`, `Identidade visual.png`): base clara, roxo `#7B2FBE` como ação.
  - Parcial: tokens em `globals.css` + `tailwind.config.ts`, `logo.png` em `public/`. Falta: amostrar a escala 50-900 do asset com precisão + checagem WCAG AA formal + mover assets para `packages/ui`.
  - Aceite: `packages/ui` exporta tokens (CSS vars + Tailwind preset); paleta amostrada do asset; contraste texto/ação ≥ WCAG AA; assets copiados para `packages/ui/assets/`.
- [~] **F0-16** — Mobile-first + componentes base + layout de app com painel lateral da Nyro e command bar (`Cmd/Ctrl+K`).
  - Entregue em `apps/web`: layout responsivo (sidebar colapsa, painel Nyro vira FAB no mobile), command bar `Cmd/Ctrl+K` funcional (consome `/api/cerebro`), painel Nyro presente como placeholder explícito. Falta: adotar shadcn/ui formalmente e mover componentes para `packages/ui`.
- [x] **F0-17** — Zero tela em branco: todo estado vazio tem CTA da Nyro.
  - Aceite: dashboard, not-found e telas "em construção" (agenda/marketing/financeiro) renderizam CTA da Nyro. ✓ em `apps/web`.
- [x] **F0-CRM** — Front CRM completo (UI/UX): login/signup (Google+GitHub), shell (sidebar/topbar/command bar/Nyro dock), Dashboard, Pipeline Kanban (drag-and-drop), Contatos, Inbox omnichannel, Conhecimento. Paleta roxo + off-white, dark mode, mobile-first.
- [x] **F0-GLASS** — Sistema Liquid Glass (HIG da Apple) em todo o `apps/web` — pedido direto do product owner (2026-11-06). Ver ADR-0029.
  - Aceite: tokens Apple (label/fill/separator/system colors acessíveis, raios concêntricos, springs, SF Pro primeiro); vidro só na camada de navegação/controle (sidebar, topbar, menus, sheets, ⌘K) e material espesso no conteúdo; botões em cápsula (glass/prominent/tinted/plain); todos os modais/drawers com `lg-backdrop` + `lg-sheet`; Reduzir transparência / Aumentar contraste / Reduzir movimento respeitados; typecheck + lint + 18 testes verdes; **verificado em runtime** (Chromium headless, light/dark, menu, ⌘K, modal, pipeline, login).
  - Aceite: `pnpm build` 14 rotas verdes; middleware protege rotas; verificado em runtime (localhost:3210). Dados **demo**; auth **demo** (client-side).
- [x] **F0-11 (auth real) — FASE 1** — módulos `auth` + `tenants`, JWT (15min) + refresh rotativo, argon2id, guard global, sessão em cookies httpOnly, tenant do JWT. `db/004_auth_tenants.sql` (identities/memberships/refresh_tokens/invites/audit_logs imutável/webhook_events) + isolamento estendido. **Verificado end-to-end** (2 tenants isolados, rotação/revogação, 401 sem token). OAuth Google/GitHub **plugável** (falta `GOOGLE/GITHUB_*` + `AUTH_SECRET` para ligar). Ver ADR-0006.
- [ ] **F0-18** — Relatório de prontidão de F0 + proposta de `Sprint.md` da semana seguinte.
  - Aceite: relatório do que está pronto/pendente/config manual; próxima sprint proposta.

---

## F1 — CRM Core
Critério de sucesso da fase (PRD §16): **um cliente real da agência operando o dia a dia.** Canal: WhatsApp via Evolution API.

- [~] **F1-01** — Entidades CRM com `tenant_id` + RLS + isolamento.
  - Feito: `db/003_crm_schema.sql` (users, pipelines, stages, contacts, deals, conversations, messages, activities) com RLS `tenant_rw` + FORCE + grants. Isolamento provado (0/8/0 via API). Falta: `companies`, `tasks`, `notes` e teste de isolamento por tabela no CI.
- [~] **F1-02** — Contatos: CRUD real (list/create) persistido, busca. Falta: editar, perfil 360, empresas, campos custom, dedupe.
- [~] **F1-03** — Pipeline Kanban: drag-and-drop **persiste** (`PATCH /v1/crm/deals/:id/stage`). Falta: criar/editar deal na UI, filtros salvos, tempo real (WebSocket).
- [ ] **F1-04** — Tarefas e agenda básica ligadas a deals/contatos.
  - Aceite: criar tarefa com prazo; concluir; aparece no card do deal.
- [ ] **F1-05** — Inbox WhatsApp via Evolution API (inbox unificado, envio/recebimento, atribuição, notas internas).
  - Aceite: mensagem recebida no número conectado aparece no inbox; resposta chega no WhatsApp; `messages.autor_tipo` correto; idempotência no webhook de entrada.
- [ ] **F1-06** — Dashboard de KPIs básicos do funil (Recharts).
  - Aceite: dashboard mostra nº de deals por stage e conversão; dados só do tenant.
- [ ] **F1-07** — Deals API (`GET /v1/pipelines`, `POST /v1/deals`, `PATCH /v1/deals/:id/stage`) com validação Zod e audit log.
  - Aceite: rotas com payload validado; erro RFC 7807; toda escrita audita.

> ⚠️ LACUNA (F1): schema exato de `tasks`/`notes`, contrato do webhook Evolution e formato de campos custom por template ainda não fechados — detalhar ao entrar em F1.

---

## RAG da Nyro IA (R0→R4) — pacote do product owner ([[RAG/RAG]])
> Direcionado pelo product owner ("inicie o desenvolvimento do RAG"). Sequenciado antes do resto por decisão explícita (ADR-0004). **R0 é bloqueante: nenhuma linha de IA antes do teste de vazamento passar.** Escopo de produto do RAG segue sendo F3 no roadmap; aqui adianta-se a fundação de dados.

### R0 — Fundação (bloqueia tudo)
- [~] **R0.1** — Migration do schema RAG aplicada (pgvector, pt_unaccent, HNSW, GIN, `rag_search_hybrid`).
  - Aceite: `SELECT rag_search_hybrid(...)` executa sem erro em base vazia.
  - Status: SQL **escrito e revisado** (`db/000_foundation.sql`, `db/001_rag_schema.sql`, `db/001a_rls_harden.sql`). **Execução pendente de infra** (sem Postgres/psql nesta máquina).
- [x] **R0.2** — RLS ativa + role de aplicação SEM `BYPASSRLS` + role de serviço separada; teste de vazamento bloqueante.
  - Aceite: `db/002_isolation_test.sql` **passou contra Postgres real** → "R0.2 OK — nenhum vazamento cross-tenant". FORCE RLS + roles + grants em `001a`. ✅ **Fechado.** (Falta só plugar no CI.)
- [x] **R0.3** — Prisma com `Unsupported("vector(1024)")` + helpers de `$queryRaw`.
  - Aceite: `prisma generate` OK; modelos do RAG mapeados (`apps/api/prisma/schema.prisma`). **Verificado.** Helper `PrismaService.withTenant()` seta `app.current_tenant_id` via `set_config` parametrizado (padrão correto do BUG-001). Falta apenas rodar contra Postgres real (migrations `db/`).

### R1 — Ingestão e busca  *(implementado em `apps/api/src/rag/`, 24 unit tests verdes)*
- [~] **R1.1** — `ChunkingService` respeita headings, tabelas e blocos de código.
  - Aceite (unit): nenhum chunk corta tabela/código; breadcrumb por heading; p95 tokens ≤ 700. **Verificado.** Falta validar com playbook real de nicho.
- [~] **R1.2** — `EmbeddingsService` (provider abstrato Voyage) com retry/backoff e batch 96 + `toSqlVector` validado.
  - Aceite (unit): batch 200→[96,96,8]; retry sucede na 3ª; esgota e propaga; `toSqlVector` rejeita NaN/Infinity. **Verificado.** Provider real Voyage precisa de `VOYAGE_API_KEY` (config manual).
- [~] **R1.3** — `IngestionService` + `IngestionProcessor`, idempotente por hash.
  - Aceite (unit): dedupe por `content_hash`; reprocessar mantém contagem (delete-then-insert); falha → doc `failed`. **Verificado.** **Nota:** transporte é fila **in-process** agora; **BullMQ** é o path de escala (ADR-08) quando houver Redis.
- [~] **R1.4** — `RetrievalService` (híbrido + RRF + boost via `rag_search_hybrid`), com `withTenant` (corrige BUG-001), rerank plugável, cache, log.
  - Aceite (unit): tenant vem da sessão; cache evita reembed; contexto anti prompt-injection; sem candidatos → vazio. **Verificado.** Falta rodar o SQL híbrido contra Postgres (jargão "DCTFWeb" no top-3) — precisa de DB + embeddings.
- [x] **R1.5** — Tool `search_knowledge`, `tenant_id` da sessão (nunca do LLM).
  - Aceite (unit): schema da tool **não** expõe `tenantId`; args com `tenantId` malicioso são descartados (`.strip()`) e a busca usa o tenant da sessão. **Verificado.**

> Falta para fechar R1 (todos `[~]` → `[x]`): rodar ponta-a-ponta contra Postgres+pgvector com embeddings reais (Voyage). Sem isso, a lógica está testada em unit mas não em integração.

- [~] **R1.6** — Corpus inicial de conhecimento (`Nyro IA/cerebro/RAG/conhecimento/`) + seed (`apps/api/scripts/seed-rag.mjs`).
  - Entregue: 8 docs (global vendas/copy/growth; medico/juridico/contabil com áreas, marcos legais reais + links oficiais, compliance CFM/OAB/CFC). Já visíveis no front. `seed-rag.mjs --dry-run` verde (classifica escopo/nicho). **Falta:** rodar a ingestão real (API+DB+Voyage) e a **curadoria** com a operação (marcada `⚠️` nos docs) — leis/prazos/protocolos precisam de validação humana; nada de texto legal inventado.

### R2 — Qualidade
- [ ] **R2.1** — `ContextualizerService` com prompt caching. Aceite: custo/1.000 chunks documentado; Recall@8 sobe vs baseline (medir).
- [ ] **R2.2** — `RerankerService` + corte `RAG_MIN_SCORE`.
- [ ] **R2.3** — Cache Redis com invalidação no publish.
- [ ] **R2.4** — `GuardrailsService` (blocklist por nicho + grounding + preço sem fonte). Aceite: 20 prompts adversariais por nicho → 100% bloqueados.
- [ ] **R2.5** — Citação `[#chunk_id]` no audit_log de toda resposta.

### R3 — Avaliação
- [ ] **R3.1** — Golden set: 60+ perguntas por nicho, escritas com a operação.
- [ ] **R3.2** — `pnpm rag:eval` no CI. Alvos: Recall@8 ≥ 0,90 · MRR ≥ 0,70 · Injection 100% · Leak 0.
- [ ] **R3.3** — Ablação (vetorial → +BM25 → +contextual → +rerank) registrada como ADR em [[Arquitetura]].

### R4 — Operação
- [ ] **R4.1** — Upload self-service de documentos pelo tenant (limite por plano).
- [ ] **R4.2** — Tela de curadoria (candidato → aprovado).
- [ ] **R4.3** — Medição de créditos de IA por tenant (embed + rerank + tokens) → `billing`.
- [ ] **R4.4** — Job `rag.reembed` para troca de modelo.

---

## Backlog de melhorias propostas (só após aprovação — ver [[PRD]] Anexo A)
- [ ] **MP-01** — `ai_usage_events` no schema inicial (medição de IA desde F0).
- [ ] **MP-02** — Entrevista da Nyro (F2) gera *diff JSON* aprovável, não aplica direto.
- [ ] **MP-03** — Roteamento por complexidade de modelo (F3).
- [ ] **MP-04** — Congelar 15 nós de automação (F4).
- [ ] **MP-05** — Política de retenção/custo de mídia WhatsApp + permissões granulares.

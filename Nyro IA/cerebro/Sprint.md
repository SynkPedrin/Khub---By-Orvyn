# Sprint Atual — ORVYN OS

> Contrato vigente: [[Brief-Finalizacao]] (doc-first · gating por credencial · **uma sprint por sessão**). Ver [[Tasks]] · [[Bugs]] · [[PRD]].

---

## ✅ SPRINT W1 — Enviar e-mail como nó de workflow  *(CONCLUÍDA — 2026-07-21)*

**Pedido do usuário:** "criar o sistema de workflow igual ao do GHL, mas com a identidade da Orvyn" (benchmark do motor do GHL anexado). Decisão de escopo em **ADR-0015**: igualar o **motor e a UX**, não clonar menu de módulo inexistente. É épico multi-sprint (trilha W); **W1 = o gap nº 1** — e-mail pelo canal oficial, que o SMS (STEVO não oficial) não cobre.

### Entregas
1. **Nó `acao.enviar_email`** (nós: 21 → **22**) — assunto + corpo com `{{contato.nome}}`; entrega pelo `MailerService` (SMTP) que já existia para convites. **Gated (ADR-0008):** sem `SMTP_URL` o passo fica `config_required` (pendente, não quebra); falha REAL de SMTP levanta exceção **de propósito** para o retry/DLQ do BullMQ agir — gating ≠ erro.
2. **UI** — bloco no `PainelNo` (assunto + corpo, aviso de gating na identidade cristal). A paleta "Adicionar" já lista o nó sozinho (deriva do `CATALOGO`).
3. **Correção de doc** — cabeçalho do `catalogo.ts` dizia "15 nós" (defasado do ADR-0012); agora reflete a contagem real.

### Verificação
- **198 testes verdes** (era 194): +4 no executor (interpola assunto+corpo e envia pro e-mail do contato; sem SMTP → `config_required`; falha de SMTP → throw; contato sem e-mail → erro explícito). Typecheck API e Web verdes.
- **Gating honesto:** o nó nunca finge envio; espelha o padrão do SMS (persiste/registra, entrega pendente sem credencial).

### Roadmap da trilha W (ADR-0015) — próximos
- **W2** — `controle.split` (A/B determinístico por hash do contato) + `controle.drip` (lotes).
- **W3** — gatilhos sem módulo novo: `Scheduler`, `Form Submitted`, `Custom Date/Birthday`, `Opportunity Status` (ganho/perdido).
- **W4** — `acao.dnd` + `acao.atribuir_usuario` → **exigem schema novo no `Contact`** (`dnd`, `owner_id`): PARA e pede aprovação (estrutural).
- **W5** — settings restantes (Sender Details, Mark as Read) + **assinatura no webhook de entrada** (segurança).

---

## ✅ SPRINT F — Nyro IA  *(CONCLUÍDA — 2026-07-17)*

**Objetivo único:** a Nyro operando de verdade — orquestrador multi-agente, tools tipadas (nunca escrita direta), memória em 3 níveis, human-in-the-loop e guardrails de compliance. Tudo **gated** em `ANTHROPIC_API_KEY`.

### Entregas
1. **Tools fechadas (ADR-0014)** — fecha a LACUNA do PRD §5.1. 14 tools em `tools.ts` com Zod por tool e sensibilidade (leitura/escrita/sensível). Zod → JSON Schema próprio (sem dependência nova).
2. **Orquestrador** — roteador Haiku → 4 sub-agentes (Arquiteta, Atendente, Estrategista, Consultora), cada um com prompt e subconjunto de tools próprios. Teto de 5 voltas por turno.
3. **"Nyro é usuário, não deus"** — toda tool passa pelos serviços do CRM/automações (mesma validação/RLS/auditoria `actor:'nyro'`). Nenhum INSERT direto.
4. **Human-in-the-loop** — tool sensível vira `nyro_actions` pendente; só o clique do humano (`POST /nyro/acoes/:id`) executa.
5. **Guardrails 2 camadas** — instrução CFM/OAB/contábil no prompt + `validarResposta` que barra e substitui a resposta antes de sair. 13 testes.
6. **Memória 3 níveis** — conversa (`nyro_messages`), conta (`nyro_memory` + tool `lembrar`), nicho (RAG). Custo por tenant em `ai_usage_events`.
7. **Front** — `NyroDock` deixou de ser protótipo: chat real com passos ao vivo e cartão de aprovação; sem chave, mostra "Configurar Claude" + o que a Nyro faria.

### Verificação
- **154 testes verdes** (era 130): +21 tools/agentes, +13 guardrails.
- Isolamento (`db/002`, bloco 14): conversas, mensagens, ações, memória e custo da Nyro isolados cross-tenant. Verde.
- **Gating verificado ponta a ponta:** `GET /nyro/status` → `configurada:false, missing:[ANTHROPIC_API_KEY]`; `POST /nyro/chat` → **501 config_required**; a UI mostra "Configurar Claude (Anthropic)" com a variável e a lista do que a Nyro faz. Zero resposta simulada.
- **⚠️ Não testado com a API real** (sem a chave): o caminho está implementado e o gating provado; a qualidade das respostas e o loop de tools dependem da `ANTHROPIC_API_KEY`.

### 🐞 [[Bugs|BUG-013]] — o cristal quebrou o `position` de todo `.glass`
`.glass { position: relative }` fora de `@layer components` venceu o `fixed` do Tailwind e jogou o chat da Nyro e o menu do topo para fora da tela. Movido para a layer (utility sempre vence component). Achado só ao **ver a tela** — o typecheck não pega CSS.

---

## ✅ SPRINT E.2 — Workflow builder completo + UX  *(CONCLUÍDA — 2026-07-17)*

**Pedido do usuário** com a referência do GHL (categorias de triggers/actions, waits, chaining, webhooks, workflow settings), **filtrado pelo que existe no Orvyn** — ver ADR-0013 para o que ficou de fora e por quê.

### Entregas
1. **21 nós** (era 15) agrupados por categoria: +`gatilho.negocio_criado` +`gatilho.webhook` +`controle.esperar_resposta` +`controle.encerrar` +`acao.criar_nota` +`acao.chamar_workflow`.
2. **Esperar resposta** — ramos fixos Respondeu/Não respondeu. Quem responde **não** recebe follow-up. O nó roda 2×: marca a espera e reagenda a si mesmo; a resposta acorda na hora e o job do timeout é descartado pela guarda de idempotência.
3. **Webhook de entrada** — `POST /v1/hooks/:chave` (público, chave revogável, **202 sempre** para não virar oráculo) + proxy Next `/api/hooks/:chave` (o cliente cola uma URL só) + `resolve_workflow_by_webhook_key` (`db/011`).
4. **Configurações do fluxo** (`db/011`) — reentrada (`uma_vez` padrão), parar no reply, janela de envio + **timezone do tenant**. Janela só segura mensagem; tag/etapa rodam a qualquer hora.
5. **UX** — painel "Adicionar" com busca focada + sinônimos (`whats` → Enviar SMS), navegação por teclado, nó nasce configurado e **já conectado**, canvas vazio ensina o começo, zoom/fit/minimap.

### Verificação
- **130 testes verdes** (era 109): +9 janela/reentrada, +5 esperar-resposta, +7 telefone.
- **E2E real:** formulário externo → webhook → contato criado → SMS → espera → **contato responde** → fluxo acorda no ramo "Respondeu" → tag aplicada. Sem duplicata.
- Isolamento verde (11 blocos). Novo: `scripts/verificar-sql.mjs` roda as queries cruas contra o Postgres real.

### 🐞 [[Bugs|BUG-012]] — três camadas, e o que ele ensinou
O inbox duplicava o contato a cada resposta (comparava dígitos crus com telefone formatado) e, na correção em SQL, **o template literal do JS comeu a barra de `'\D'`** → `regexp_replace(telefone,'D','','g')` apagava a letra D, não a máscara. Somou-se a armadilha do bigint (BUG-007 de novo).
**O mais importante:** a primeira versão do `verificar-sql.mjs` **passou com o bug ativo**, porque só checava se a query resolvia. Agora ela prova a semântica (`'+55 11 97777-1234'` → `77771234`). Terceiro sprint seguido em que o mock mente e só o banco real conta a verdade ([[Bugs|BUG-009]], [[Bugs|BUG-010]], BUG-012).

---

## ✅ SPRINT E — Motor de Automações (F4)  *(CONCLUÍDA — 2026-07-17)*

**Objetivo único:** o setor de automação completo — canvas drag-and-drop, gatilhos e ações que **executam de verdade**, com espera, If/Else, retry, DLQ, log nó-a-nó e versionamento. Referência de UX: as telas do GHL que o usuário mandou.

### Entregas
1. **15 nós congelados** ([[PRD]] §7.1 LACUNA fechada · ADR-0012) — `catalogo.ts` com Zod por tipo é a fonte única: API valida e o canvas monta a paleta dali.
   - Gatilhos: contato criado · mudou de etapa · mensagem recebida · tag adicionada
   - Controle: esperar · **If/Else (AND/OR/NONE)** · ir para
   - Ações: **enviar SMS** · add tag · remover tag · atualizar contato · criar oportunidade · mover etapa · criar tarefa · webhook
   - "SMS" é o nome certo por decisão do usuário: entrega pelo WhatsApp via **STEVO (não oficial)** — texto simples, sem template nem mídia. A UI diz isso no painel do nó.
2. **Schema** (`db/010_automations.sql`) — `workflows`, `workflow_versions` (imutável ao publicar), `workflow_runs` (estado por run + `dedupe_key` unique), `workflow_run_steps` (timeline), `workflow_dlq`. Todas com RLS + FORCE.
3. **Engine** — 1 job = 1 nó; espera vira `delay` na fila (sobrevive a restart); retry exponencial do BullMQ; DLQ com reprocessar; `aoFalhar:'seguir'` como fallback por nó; loop de `ir_para` barrado em 200 passos.
4. **Barramento `events`** — o CRM publica e segue; o worker das automações consome a fila. Quebra o ciclo `crm ↔ automations` sem ninguém chamar ninguém.
5. **Ações via CRM** — todo nó age pelos serviços do CRM (mesmas regras/auditoria/RLS). Nenhum nó escreve direto no banco.
6. **Canvas (React Flow)** — paleta com drag-and-drop, nós com resumo, **saída por ramo** no If/Else (como no GHL), painel de config por nó, autosave no rascunho, validação com problemas apontados **no nó**, publicar/pausar/rollback.
7. **Observabilidade** — `/automacoes/[id]/execucoes`: lista de runs, timeline nó-a-nó (entrada/saída/erro/tentativa/duração), cancelar, DLQ na lista, e **teste com contato real** (avisando que executa de verdade — não é simulação).

### Verificação
- **109 testes verdes** (era 75): +13 executor (AND/OR/NONE, primeiro ramo vence, interpolação, SSRF), +15 orquestração (idempotência, espera, DLQ, loop, fallback), +6 do filtro RFC 7807.
- Isolamento (`db/002`) estendido: workflow, **grafo**, estado do run, log e DLQ do tenant B invisíveis para A + write-guard. Verde.
- **Fluxo real ponta a ponta:** contato "Lead quente" → SMS interpolado ("Oi Joana Fluxo, recebemos seu contato!") → espera → condição → **oportunidade criada de verdade** no funil (R$ 1.500, origem Automação). Contato "Lead" → mesmo fluxo → ramo **else** → tag `nutrir`. Timeline dos 4 passos com duração registrada.

### 🐞 Dois bugs sérios achados (e o padrão que os une)
- **[[Bugs|BUG-010]]** — `jobId` com `:` fazia o BullMQ recusar todo enfileiramento: **o motor inteiro ficava inerte**, com um WARN discreto. Meu teste unitário *afirmava o valor quebrado* (`'run1:wait:0'`) porque a fila falsa aceita qualquer string.
- **[[Bugs|BUG-011]]** — `contact.created` só era publicado pelo WhatsApp: o gatilho "Contato criado" não disparava para cadastro manual nem **lead de anúncio**.
- **Padrão:** os dois passaram por todos os testes com mock e só apareceram ao rodar contra Redis/Postgres reais — como o [[Bugs|BUG-009]] do sprint anterior. Teste com mock prova que meu código faz o que eu acho; só o real prova que faz o que o sistema cobra.

---

## ✅ SPRINT D2 — Tempo real  *(CONCLUÍDA — 2026-07-16)*

**Objetivo único:** o CRM para de perguntar e passa a ser avisado — inbox e Kanban ao vivo, socket autenticado por tenant, com reconexão.

**Fora de escopo:** automações (E), Nyro (F), conectores novos (B).

### Entregas
1. **Decisão da LACUNA de [[APIs]] §6** — Socket.IO, namespace `/rt`, envelope `{evento,dados,emitidoEm}`, contrato tipado em `@orvyn/types`. **ADR-0011.**
2. **Auth do socket por ticket** — `POST /v1/auth/ws-ticket` (JWT `typ:'ws'`, 60s) + rota Next `/api/auth/ws-ticket`. O `JwtAuthGuard` recusa `typ:'ws'` no REST. O access token httpOnly nunca chega ao JS.
3. **Gateway + isolamento** — socket entra só em `tenant:<id>`, tenant vindo **do ticket**; todo envio é `to(sala)`, nunca broadcast.
4. **Emissores reais** — inbox (`message.created`, `conversation.updated`, `contact.created` na entrada do WhatsApp) e funil (`deal.created|moved|updated|deleted`), sempre **após o commit**.
5. **Front** — `useRealtime()`; inbox e pipeline ao vivo, com ponto verde/âmbar e **fallback para polling (5s)** se o socket cair. `arrastandoRef` impede que evento de colega puxe o card da mão de quem arrasta.
6. **Escala** — `RedisIoAdapter` (múltiplas instâncias), degradando para memória sem Redis.

### Verificação
- **75 testes verdes** (era 61): +10 do gateway (ticket ausente/forjado/expirado, access token recusado, cliente não escolhe tenant, evento vai para a sala certa, socket falho não derruba negócio) e +4 do CRM (publica pós-commit, `deal.moved` leva a etapa anterior, tenant da sessão em todo evento, operação que falha não publica).
- **Socket real:** ticket → conexão ✓; ticket inválido recusado ✓; access token recusado no socket ✓; `PATCH /deals/:id/stage` → `deal.moved` chega ✓.
- **Isolamento cross-tenant no socket:** dois sockets (tenant real + tenant forjado) → evento de A chega em A e **B não recebe nada** ✓. Feito com tenant fictício, **sem criar linha no banco**.

---

## ✅ SPRINT D1 — Fechar o CRM (F2)  *(CONCLUÍDA — 2026-07-16)*

**Objetivo único:** o CRM deixa de ser "lista + kanban" e vira operação: perfil 360, edição/exclusão, empresas/tarefas/notas, paginação que aguenta base grande e **lead da Meta virando contato sozinho**.

**Fora de escopo:** WebSocket (D2), automações (E), Nyro (F), novos conectores (B).

### Entregas
1. **Schema** (`db/009_crm_f2.sql`) — `companies`, `tasks`, `notes`, `meta_pages` (+ `contacts.company_id`, `activities.contact_id/deal_id`), todas com `tenant_id NOT NULL` + RLS + FORCE + policy `tenant_rw`. Roteamento `resolve_tenant_by_meta_page` (SECURITY DEFINER, mesmo padrão do 008).
2. **Perfil 360** — `GET /v1/crm/contacts/:id` agrega contato + empresa + negócios + conversas + tarefas + notas + timeline **numa transação** (a tela que mais abre no dia não pode ser N+1). Front: `/contatos/[id]` com edição inline, exclusão confirmada, notas e tarefas.
3. **Editar/excluir contato e negócio** — `PATCH/DELETE /v1/crm/contacts/:id` e `/deals/:id`; `GET /v1/crm/deals/:id`. Front: `DealDrawer` (abre pelo card ou por `?deal=`, edita etapa/valor/status, tarefas e notas, exclui). O botão "Novo negócio", que era decorativo, cria de verdade.
4. **Empresas / tarefas / notas** — CRUD completo (`CompaniesService`, `TasksService`, `NotesService` + `CrmF2Controller`), páginas `/empresas`, `/empresas/[id]`, `/tarefas` (filtros abertas/hoje/atrasadas/concluídas, toggle otimista). Nota só o autor edita; empresa não duplica nome no tenant (409).
5. **Paginação por cursor** — `GET /v1/crm/contacts?cursor=&limit=` com cursor opaco; front com "Carregar mais" que se recupera de cursor expirado.
6. **Meta lead → contato** — `MetaLeadsService`: webhook (público) → `resolve_tenant_by_meta_page` → dedupe em `webhook_events` → Graph com a credencial **do tenant** → `LeadsService.upsertFromLead` (dedupe por e-mail/telefone, enriquece em vez de duplicar). Assinatura `X-Hub-Signature-256` validada sobre o corpo cru (`rawBody` no `main.ts`). Páginas registradas no OAuth (`listPages`). **Sai o `TODO(Sprint D)`.**

### Verificação
- **61 testes verdes** (era 40): + cursor (6), + `LeadsService` (6), + `MetaLeadsService` (8).
- Isolamento (`db/002`) estendido: `companies`/`tasks`/`notes`/`meta_pages` invisíveis cross-tenant, write-guard em `companies`, roteamento `page→tenant` sem expor a linha. **Verde.**
- Contra o Postgres real: empresa criada (duplicata → 409), contato vinculado, 360 agregando, tarefa atrasada no filtro, toggle ida e volta, negócio criado→editado→excluído (404 depois), webhook leadgen roteado e **gated sem inventar contato**.

### 🐞 Bug encontrado e corrigido durante a sprint ([[Bugs|BUG-009]])
Paginação por cursor keyset montada em JS **descartava lotes inteiros**: `timestamptz(6)` guarda microssegundos (`.34792`) e `Date` do JS trunca em milissegundos (`.347`) — os 8 contatos do seed (mesmo `created_at`) sumiam da página 2. Trocado pelo cursor **nativo do Prisma** (comparação no banco, precisão total). Achado só porque a paginação foi testada com **dado real**, não com mock.

---

## ✅ SPRINT 0 — Desbloqueio e quick wins  *(CONCLUÍDA — 2026-07-16)*

> Execução em sequência autorizada pelo usuário ("implemente todos os sprints em sequência"), sobrepondo a regra 6 do brief (uma sprint por sessão). Reporte na fronteira de cada sprint.

**Objetivo único:** fechar os ciclos que já estão ~90% prontos e instituir o **gating por credencial** (Seção 2 do brief) como padrão da plataforma.

**Fora de escopo:** CRM F2 (perfil 360, empresas/tarefas/notas), WebSocket, automações, Nyro, novos conectores.

### Tasks
1. **S0-1 · `ConfigService` central + contrato `config_required`** ✅ — `isConfigured/missingVars/require/warnDegraded/snapshot` em `apps/api/src/config/config.service.ts` (`@Global ConfigModule`). Credenciais migradas para ele: STEVO, Meta (connector + graph client), cripto de integrações, Voyage, webhooks (STEVO/Meta), convite (`WEB_URL`), knobs do RAG. `ConfigRequiredException` → **501** RFC 7807 + `code:"config_required"` + `provider` + `missing[]` (ver ADR-0008 para o desvio do `status`). Fallback funcional do RAG: `rag_search_lexical` (migration 007) quando falta `VOYAGE_API_KEY`.
   - *Aceite:* ✅ canário estrito (`.env` só com `DATABASE_URL`+`JWT_SECRET`): boot com **0 erros**, login/dashboard/inbox ok, `meta/auth-url` → 501 `{missing:[META_APP_ID,META_APP_SECRET]}`, envio → 200 + `config_required` com as 3 vars, RAG respondeu por BM25 com `warn` de degradação. Teste automatizado: `config.service.spec.ts`.
2. **S0-2 · Aceite de convite** ✅ — `POST /v1/auth/invites/accept` (público) + `AuthService.acceptInvite` (hash sha256, expiração, identidade nova ou existente, membership no tenant do convite, perfil `users`, `accepted_at`, audit `invite.accept`, emite sessão). Front: rota `/api/auth/invites/accept` (seta cookies httpOnly) + `SignupForm` detecta `?invite=` e pede só nome+senha.
   - *Aceite:* ✅ convite → aceite → usuário `member` no **tenant correto** vendo os dados certos; 2ª tentativa com o mesmo token → **400**; auditado.
3. **S0-3 · WhatsApp entrega real (gated)** ✅ — `StevoProvider` sobre ConfigService; `MessagesService` persiste sempre e devolve `status:'config_required' + missing[]` (200 — ADR-0008). Front: `ApiError` preserva o corpo do 501, componente `ConfigRequired` mostra "Configurar {provider}" + vars faltantes (inbox e Meta Ads). Webhook de entrada: roteamento real `instância → tenant` (migration 008, `SECURITY DEFINER`) — o `TODO` de produção saiu.
   - *Aceite:* ✅ sem credencial → mensagem salva + UI "Configurar STEVO (WhatsApp)" listando as vars.
4. **S0-4 · BUG-004 · Cmd+K busca o CRM** ✅ — `GET /v1/crm/search?q=` (contatos por nome/email/telefone/empresa/tag, negócios por título/origem/contato, conversas por nome/prévia/corpo das mensagens) dentro de `withTenant`. `CommandBar` (o ⌘K que já existia) consome com debounce de 180ms e prioriza dados do tenant sobre navegação; inbox abre por `?c=`.
   - *Aceite:* ✅ "mar" → Marina Alves (contato) + negócio + conversa; "99640" → acha por telefone. Isolamento: a query roda sob RLS (`db/002` cobre o vazamento cross-tenant).
5. **S0-5 · AuditInterceptor + sino de notificações** ✅ — `AuditInterceptor` global audita toda mutação autenticada bem-sucedida (`contacts.create`, `deals.stage`…); `@SkipAudit()` nas rotas cujo serviço já grava linha mais rica (settings, envio de mensagem). `GET /v1/settings/notifications` + `POST .../read` derivados do estado real (não lidas + integrações quebradas; "visto" em `users.prefs.notifsSeenAt`) e `NotificationsBell` substituiu o pontinho fake.
   - *Aceite:* ✅ POST `/crm/contacts` → linha `contacts.create` com o id em `/configuracoes → Auditoria`; sino lista as conversas reais não lidas e zera o badge ao abrir.

### Definition of Done (além da DoD global do brief)
- ✅ **40 testes verdes** (era 33): + canário do ConfigService, + fallback lexical, + cache não vaza entre modos.
- ✅ `docs/ENV.md` criado (provedor · vars · onde obter · o que acontece sem) + `apps/api/.env.example` completado (SMTP, RAG, WEB_URL).
- ✅ ADR-0008 (gating/ConfigService) e ADR-0009 (convite) registrados em [[Arquitetura]].
- ✅ Teste de isolamento (`db/002`) estendido: prova que o roteamento do STEVO só deixa passar o `tenant_id`.
- ✅ Nenhum segredo no diff.

### Pendências deixadas (assumidas)
- Resíduo de teste no banco de dev (o usuário optou por não limpar): contato "Auditoria Automática S0", identidade `convidado.s0@orvyn.app` e 4 mensagens de canário.
- `MetaWebhookController` mantém o `TODO(Sprint D)` do lead→contato — é item de D1.

---

## Sprint 1 — Fundação: Cérebro + gate de aprovação *(histórico)*

- **Fase:** F0 — Fundação
- **Semana:** 1
- **Ambiente:** local
- **Objetivo único:** **Estabelecer o cérebro (fonte única de verdade) completo e aprovado, antes de escrever qualquer código.**

### Tasks da sprint
1. **F0-01** — Criar vault `Nyro IA/cerebro/` com os 8 arquivos. ✅
2. **F0-02** — Transcrever o PDF para o cérebro com marcação de lacunas. ✅
3. **F0-03** — Popular `Tasks.md` (backlog F0+F1 com aceite testável). ✅
4. **F0-04 / F0-05** — Escrever este `Sprint.md` + `CLAUDE.md` na raiz. ✅
5. **F0-06 [GATE]** — Obter aprovação do cérebro pelo usuário. ⏳ **BLOQUEIA todo o código.**

### Definition of Done (Sprint 1)
- [x] 8 arquivos do cérebro criados dentro do vault Obsidian.
- [x] PDF transcrito sem resumir; lacunas marcadas com `⚠️ LACUNA`.
- [x] Backlog F0 e F1 com critérios de aceite testáveis.
- [x] `CLAUDE.md` na raiz aponta para o cérebro e replica o protocolo/regras.
- [ ] **Usuário aprovou o cérebro** (gate F0-06).

### Fora de escopo desta sprint (NÃO fazer)
- Qualquer código: monorepo, Prisma, auth, RLS, design system. Só depois do gate F0-06.
- Melhorias propostas (MP-01..05) — só entram se aprovadas.

---

## Redirecionamento do product owner — RAG R0
O product owner forneceu o pacote do RAG e mandou "iniciar o desenvolvimento". Decisão registrada em **ADR-0004**: entregar a **fundação de dados do RAG (R0)** já, por não depender de toolchain nem de chaves externas.

### Entregue nesta sessão (R0 — camada de banco)
- [x] `db/000_foundation.sql` — `tenants` mínima + roles `orvyn_app` (NOBYPASSRLS) / `orvyn_service` (BYPASSRLS).
- [x] `db/001_rag_schema.sql` — schema RAG fornecido, transcrito verbatim (UTF-8 limpo).
- [x] `db/001a_rls_harden.sql` — FORCE RLS + RLS de `nyro_guardrail_hits` + grants.
- [x] `db/002_isolation_test.sql` — teste de vazamento cross-tenant, bloqueante, self-cleaning.
- [x] `db/README.md` — pré-requisitos e ordem de execução.
- [x] Spec integrada ao cérebro: [[RAG/RAG]]; backlog R0-R4 em [[Tasks]]; invariantes no `CLAUDE.md`; ADR-0004 em [[Arquitetura]]; findings em [[Bugs]] (BUG-001/002).

### Pendente (não executável nesta máquina — sem Node/pnpm/Docker/psql)
- [ ] **Executar** as 4 migrations e provar o `002` verde. Precisa de Postgres 15+ com pgvector (via Docker Compose — F0-08) ou uma `DATABASE_URL` acessível.
- [ ] **R0.3** (Prisma) e **R1+** (serviços TS, incl. `retrieval.service.ts` fornecido): dependem do monorepo `apps/api` (F0-07).

## Entregue nesta sessão (2) — `apps/web` (cérebro como backend, ADR-0005)
- [x] App Next.js 14 (App Router) em `apps/web`, verificado em runtime (typecheck + build + endpoints na porta 3221).
- [x] Backend = cérebro Obsidian: `lib/cerebro.ts` + `/api/cerebro`, `/api/cerebro/[...slug]`, `/api/health`. Guard anti path-traversal.
- [x] UI de marca (`#7B2FBE`, creme, dark mode, `logo.png`), mobile-first, painel Nyro, command bar `Cmd/Ctrl+K`, zero tela em branco.
- [x] Cobre parcialmente F0-15/16 e fecha F0-17. Next fixado em 14.2.35 (patch de segurança).
- Nota de ambiente: porta 3000 ocupada por outro projeto ("SmartFood"); rodar o Orvyn em outra porta.

## Entregue nesta sessão (3) — Monorepo + API (ADR-0002)
- [x] Monorepo **pnpm + Turborepo**: `apps/web`, `apps/api`, `packages/config`, `packages/types`. `pnpm build` → 2/2 apps (verificado).
- [x] `apps/api` **NestJS 10** sobe: `/v1/health` (db:false sem Postgres), erros **RFC 7807** (`application/problem+json` + correlation-id), env validada por zod.
- [x] **R0.3**: Prisma 5.22 com `Unsupported("vector(1024)")`, `prisma generate` OK; `PrismaService.withTenant()` (padrão correto do BUG-001, `set_config` parametrizado).
- [x] `docker-compose.yml` (pgvector pg16 + redis) e `.env.example`. Porta do `apps/web` movida para **3210** (evita conflito com "SmartFood" na 3000).
- [x] ADR-0002 fixado com versões reais.

### Ainda pendente (só falta infra — sem Docker/Postgres nesta máquina)
- [ ] `docker compose up` → rodar `db/000→002` → **`002` verde fecha o R0.2** (único item que falta do R0).
- [ ] Wire dos serviços RAG (R1): ingestão, embeddings, retrieval (com o helper `withTenant`), tool `search_knowledge`. Precisa de chaves Voyage/Cohere/Anthropic.

## Entregue nesta sessão (4) — R1 do RAG (lógica implementada + testada em unit)
Módulo `apps/api/src/rag/` com **24 unit tests verdes** (jest + ts-jest), sem depender de chaves externas:
- [x] **R1.1** `ChunkingService` (estrutural-semântico; não corta tabela/código; breadcrumb; p95 tokens).
- [x] **R1.2** `EmbeddingsService` + provider abstrato Voyage (batch 96, retry exponencial, `toSqlVector` validado).
- [x] **R1.3** `IngestionService`/`IngestionProcessor` idempotentes (hash + delete-then-insert). Fila **in-process** (BullMQ = escala, ADR-08).
- [x] **R1.4** `RetrievalService` (RRF+boost via `rag_search_hybrid`, `withTenant` corrigindo BUG-001, cache, rerank plugável, contexto anti-injection).
- [x] **R1.5** Tool `search_knowledge` — tenant só da sessão; args maliciosos descartados.
- [x] `RagModule` sobe na API (DI ok); `POST /v1/rag/search` sem `x-tenant-id` → 400 RFC-7807.
- Baseline `IdentityReranker` (R2.2 traz cross-encoder) e sem contextualização (R2.1) — documentado.

### Pendente (só falta infra + chaves)
- [ ] **Integração R0.2/R1**: Postgres+pgvector (Docker) + `VOYAGE_API_KEY` → rodar `db/002` (isolamento) e uma busca real (jargão no top-3).

## Entregue nesta sessão (5) — Front no localhost + corpus do RAG
- [x] **Front rodando**: `http://localhost:3210` (Next dev em background; cérebro Obsidian como backend). Porta 3210 (não conflita com "SmartFood" na 3000).
- [x] **Corpus inicial do RAG** em `Nyro IA/cerebro/RAG/conhecimento/` (8 docs): global (vendas/copy/growth), medico (áreas + CFM), juridico (áreas + leis reais com links planalto + OAB), contabil (regimes + obrigações + CFC). Já navegável no front (19 docs no total).
- [x] **Seed** `apps/api/scripts/seed-rag.mjs` (`--dry-run` verde) para ingerir o corpus no RAG real.
- ⚠️ **Curadoria** marcada nos docs: leis/prazos/protocolos exigem validação da operação; nenhuma lei/texto foi inventado (só referências verificáveis + links oficiais).

## Entregue nesta sessão (6) — CRM front (UI/UX) no localhost
- [x] **Redesign completo** do `apps/web` como CRM: paleta roxo `#7B2FBE` + off-white, dark mode, mobile-first, design system (tokens, UI kit, ícones SVG próprios, charts SVG sem dependência).
- [x] **Auth**: telas `/login` e `/signup` (split-screen de marca) com **Google + GitHub** e e-mail. Sessão **demo** (client-side) + **middleware de guard** (rota protegida → redireciona a /login). Verificado: guard 307, login/signup 200, dashboard 200 com sessão.
- [x] **App shell**: sidebar, topbar (busca ⌘K, menu de usuário, toggle de tema), dock da Nyro, command bar.
- [x] **Telas**: Dashboard (KPIs+sparklines, receita, funil, insights Nyro, atividade), Pipeline **Kanban com drag-and-drop**, Contatos (tabela+busca), Inbox omnichannel (thread + sugestão Nyro), Conhecimento (base RAG navegável), e Agenda/Marketing/Financeiro/Nyro com estados "em construção" (zero tela em branco).
- Rodando em **http://localhost:3210**. Dados do CRM são **demo** (rotulados); auth demo até o back real.

> Nota: cobre bem F0-14/15/16/17 (design system + shell + mobile-first + zero tela em branco). **Auth real** (OAuth Google/GitHub server-side) é **F0-11** com NextAuth/Auth.js — o middleware e o `AuthProvider` já são os pontos de plugue.

## Entregue nesta sessão (7) — Infra no ar + CRM Core REAL (F1)
- [x] **Docker up**: Postgres 16 + pgvector + Redis (`docker-compose.yml`, sem initdb.d — migrations manuais).
- [x] **R0.2 FECHADO**: `db/002_isolation_test.sql` passou contra Postgres real → *"R0.2 OK — nenhum vazamento cross-tenant"*.
- [x] **CRM schema** `db/003_crm_schema.sql`: users, pipelines, stages, contacts, deals, conversations, messages, activities — todas com **RLS** (`app.current_tenant_id`) + grants; seed de 1 tenant com dados reais (8 contatos, 8 negócios, 3 conversas).
- [x] **API CRM** (NestJS `crm` module): `/v1/crm/overview|contacts|pipeline|deals|conversations` — tudo via `withTenant` (RLS). Conecta como `orvyn_app` (NOBYPASSRLS). Isolamento provado via API (tenant errado → 0).
- [x] **Front ligado ao banco**: proxy `/api/crm/*`, `lib/crm.ts`; Dashboard, Pipeline (drag **persiste**), Contatos (criar **persiste**), Inbox — **dados reais**, zero array demo. Verificado end-to-end.
- Rodando: web **http://localhost:3210** · API **:3333** · Postgres **:5432**.

## Entregue nesta sessão (8) — FASE 1: Auth real + Tenants ✅
- [x] `db/004_auth_tenants.sql`: `identities` (global), `memberships`, `refresh_tokens`, `invites`, `audit_logs` **imutável** (trigger + REVOKE), `webhook_events`; RLS nas de tenant + casos novos no `002` (isolamento passa).
- [x] NestJS `auth` + `tenants`: signup/login/refresh/logout/me; **argon2id**; **JWT 15min** + **refresh rotativo revogável**; guard global `JwtAuthGuard`; provisionamento (tenant+owner+funil default). OAuth `/v1/auth/oauth/callback` plugável (501 explícito).
- [x] CRM/RAG passam a tirar o **tenant do JWT** (`@TenantId`); `x-tenant-id` sai do request path.
- [x] Front real: rotas `/api/auth/*` (cookies httpOnly), `middleware` por sessão, refresh silencioso, login/signup/logout reais, proxy `/api/crm` manda Bearer.
- [x] **git init** + baseline; **verificado end-to-end** (2 tenants isolados por JWT, rotação/revogação, 401 sem token, signup→CRM→logout no front).
- Config pendente p/ OAuth real: `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET`, `AUTH_SECRET`.

## Entregue nesta sessão (9) — Inteligência de marketing da Nyro (RAG global)
- [x] Corpus "MARKETING NYRO" (12 frameworks C-Level: 6 marketing + 6 operação) integrado ao cérebro em `RAG/conhecimento/global/{marketing,operacao}/` (dup descartada, pasta solta removida).
- [x] Seeder `apps/api/scripts/seed-global-rag.mjs` (frontmatter→metadados, chunk por seção, escopo=global via `orvyn_service`). **Ingerido: 12 docs / 73 chunks**; buscável por BM25 (STP p/ "posicionar", GTM p/ "lançar serviço"). Embeddings entram com `VOYAGE_API_KEY`.
- [x] UI: `/marketing` vira a **Central de Marketing da Nyro** (lista os frameworks, abre no leitor de conhecimento). Verificado.
- [x] Índice `RAG/conhecimento/global/_INDICE.md` (recuperação por dominio + plano + gate de intenção).

## Roadmap de finalização (A→G) — "pronto faltando só a Anthropic"
Ordem do brief do operador. Cada sprint: doc-first → plano → executar → testes (unit + isolamento) → atualizar cérebro.
- **A** — Integrations foundation + **Meta Ads** (entrega visível) ← **PRÓXIMO, plano abaixo**
- **B** — TikTok Ads + Google Ads (mesmo contrato `AdsConnector`)
- **C** — Stripe (billing + pagamentos no funil)
- **D** — Fechar CRM (F2) + Inbox real + WhatsApp (fecha BUG-003/004/006)
- **E** — Motor de automações (BullMQ + React Flow, ~15 nós)
- **F** — Nyro chat + tools (gated em `ANTHROPIC_API_KEY`; 501 sem a chave)
- **G** — Embeddings plugáveis + backfill (`VOYAGE_API_KEY`; fallback BM25)

Base já entregue: `.env.example` (contrato completo) e RegrasNegocio §6.1/§6.2 (OAuth por tenant + cripto AES-256-GCM; fallback Voyage→BM25).

---

## SPRINT A — ✅ ENTREGUE (Integrations foundation + Meta Ads)
- [x] `db/005_integrations_schema.sql`: 7 tabelas (`integrations`, `ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_creatives`, `ad_insights` particionada, `ad_sync_runs`) — RLS + isolamento (`002` verde).
- [x] `CryptoService` AES-256-GCM (`INTEGRATIONS_ENCRYPTION_KEY`); env opcionais (só `JWT_SECRET` fatal).
- [x] Módulo `integrations`: contrato `AdsConnector` + `MetaAdsConnector` (OAuth/sync/insights/health) sobre `GraphClient` mockável; `ADS_CONNECTORS`.
- [x] **BullMQ** fila `ads-sync` (job pós-conexão + on-demand) idempotente; `ads-sync.processor`; `ad_sync_runs`.
- [x] Webhook `GET/POST /v1/webhooks/meta` (verify + ack idempotente).
- [x] Rotas: `GET /v1/integrations`, `GET /v1/integrations/:provider/auth-url`, `POST /v1/integrations/:provider/callback` (público), `POST /v1/integrations/:id/sync`, `GET /v1/ads/{overview,campaigns,creatives}`. Proxy Next `/api/v1/*` + callback `/api/integrations/meta/callback`.
- [x] Front `/marketing/ads`: KPIs (spend/leads/CPL/ROAS), campanhas ordenáveis, galeria de criativos com "★ Melhor performando", health das conexões, empty state com CTA.
- [x] **32 testes verdes** (cripto + mapping do conector); read-pipeline provado com dados reais no banco (spend R$532, ROAS 21.05).
- **Falta só a conexão real:** preencher `META_APP_ID/SECRET` (+ App Review) → o fluxo OAuth liga sem mudar código. ADR-0007.

## Próximo — SPRINT B (TikTok + Google Ads, mesmo contrato `AdsConnector`)

## SPRINT A — plano original (referência)

**Objetivo único:** um tenant conecta uma conta **Meta Ads** por OAuth, os insights populam o banco por BullMQ, e `/marketing/ads` mostra campanhas ordenadas por performance + galeria de criativos com "melhor performando" — tudo isolado por tenant.

### Tasks
1. **`db/005_integrations_schema.sql`** (aditiva): `integrations`, `ad_accounts`, `ad_campaigns`, `ad_sets`, `ad_creatives`, `ad_insights` (particionada por `date`), `ad_sync_runs`. Todas `tenant_id NOT NULL` + RLS (padrão `003/001a`). + casos no `002_isolation_test`. Prisma models + generate.
2. **Env/cripto:** adicionar as chaves ao `env.ts` (zod) como **opcionais** (só `JWT_SECRET` fatal); `CryptoService` AES-256-GCM (`INTEGRATIONS_ENCRYPTION_KEY`) para credenciais por tenant. Se a chave de cripto faltar e houver tentativa de conectar → erro claro.
3. **Módulo `integrations`:** contrato `AdsConnector` + `MetaAdsConnector` (buildAuthUrl → callback grava credencial cifrada → listAdAccounts → syncCampaigns/Creatives/Insights → healthCheck). Última versão estável da Graph API (confirmar na doc na hora).
4. **BullMQ ligado:** fila `ads-sync` (job on-demand pós-conexão + periódico por integration), idempotente; grava `ad_sync_runs`.
5. **Webhook:** `POST /v1/webhooks/meta` (verify token + Lead Ads) idempotente via `webhook_events`.
6. **Rotas:** `GET /v1/integrations` · `GET /v1/integrations/:provider/auth-url` · `GET /v1/integrations/meta/callback` · `POST /v1/integrations/:id/sync` · `GET /v1/ads/overview|campaigns|creatives`.
7. **Front `/marketing/ads`:** onboarding "Conecte suas contas" (botão Meta OAuth) → seleção de ad account → sync; overview (spend/leads/CPL/ROAS), tabela de campanhas ordenável, galeria de criativos com badge "melhor performando", health das conexões. Estado vazio com CTA (zero tela em branco).
8. **Testes:** unit do `MetaAdsConnector` com **HTTP mockado** (sem rede); isolamento das 7 tabelas novas; e2e da rota de overview com dados semeados.

### Definição de pronto (Sprint A)
- Migração aplica limpa; `002` verde incluindo as 7 tabelas novas.
- Com `META_APP_ID/SECRET` presentes: fluxo OAuth → conta conectada → `ad_insights` populado → `/marketing/ads` renderiza campanhas por performance + melhor criativo. **Sem** as chaves: a tela mostra "Conecte sua conta Meta" (CTA), nada quebra.
- Nenhum segredo no código; token do cliente cifrado em repouso; suíte verde.
- Cérebro atualizado: ADR-0007 (arquitetura de conectores + cripto), Banco.md (7 tabelas), APIs.md (novas rotas), Tasks/Bugs.

### Pré-requisito externo (não é código)
Conectar uma conta **real** exige `META_APP_ID/SECRET` + permissões `ads_read`/`ads_management` (App Review da Meta). Enquanto não houver, entrego construído + testado com mocks; o aceite "conecta conta real" fecha quando as credenciais existirem (RegrasNegocio §6.1).
2. **Integração R1** (RAG): `VOYAGE_API_KEY` → `node apps/api/scripts/seed-rag.mjs` popula o RAG e liga a busca à Nyro.
3. Evoluir F1: perfil 360 do contato, edição de deal, envio real no inbox (Evolution API).
2. **R2**: `ContextualizerService` (Haiku + prompt caching), `RerankerService` (cross-encoder calibrado → liga o corte `RAG_MIN_SCORE`), cache Redis, `GuardrailsService` (CFM/OAB). Consultar skill `claude-api` para o model id do Haiku ao implementar R2.1.

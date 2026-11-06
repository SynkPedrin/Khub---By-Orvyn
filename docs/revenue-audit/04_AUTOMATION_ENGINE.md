# 04 - Motor de Automações e Construtor (auditoria somente leitura)

Escopo: `apps/api/src/automations/*`, `operations/operations.service.ts`, `events/`, `crm/messaging/messages.service.ts`, `marketplace/`, `db/010,011,015,016,017,022`, front `apps/web/app/(app)/automacoes`, `components/automations`, `lib/automations.ts`, proxy `app/api/hooks/[chave]/route.ts`.
Método: leitura de código e specs. Nada foi executado, nenhuma mensagem enviada. Existência de código não foi tratada como funcionalidade: onde o caminho real tem furo, está marcado.

Legenda de status: OK (funciona e há teste), PARCIAL (funciona com ressalva ou sem teste do caminho real), QUEBRADO (código existe mas o fluxo real falha), AUSENTE (não existe).

## 1. Arquitetura real (resumo factual)

- Eventos de domínio vêm de **triggers SQL** (`db/022_production_foundation.sql:42-80`) que gravam em `outbox_events` na mesma transação do dado. O `DomainEventsService.publicar()` hoje só repassa ao socket (`events/domain-events.service.ts`, comentário na própria função); a fila `automation-triggers` e o `GatilhosProcessor` (`automations.processor.ts:35-51`) **não recebem mais nada** (código morto).
- Consumo: `OperationsService.reconcile()` roda a cada 5 s (`operations.service.ts:21,26-57`), enfileira `outbox_events` pendentes e chama `TriggersService.processar()` (`operations.service.ts:71`). Webhook de entrada usa `kind='workflow.hook'` (`operations.service.ts:68-70`).
- Execução: 1 job BullMQ por nó (`FILA_PASSOS`), estado em `workflow_runs` (Postgres), claim com lease de 120 s + `generation` (`runs.service.ts:123-139`). `jobId = sha256(runId, generation)`. Retry 4x exponencial, DLQ em tabela (`runs.service.ts:222-236`).
- Espera/delay: persistida (`scheduledAt` no banco + BullMQ `delay`), e o `reconcile` re-enfileira runs vencidos se o Redis perder jobs (`operations.service.ts:34-49`). **Sobrevive a restart/deploy/queda de Redis.** Não há timer em memória.

## 2. Triggers (catálogo real: 7 gatilhos)

O catálogo (`catalogo.ts:9-41`) tem 7 gatilhos. Os nomes pedidos APPOINTMENT_*, FORM_SUBMITTED, CAMPAIGN_LEAD_RECEIVED, FOLLOWUP_DUE, LEAD_CREATED (alias de contato criado) não existem como tipos.

| Gatilho (tipo real) | Evento real / quem emite | Chega ao engine? | Teste | Status |
|---|---|---|---|---|
| `gatilho.contato_criado` (= LEAD_CREATED/CONTACT_CREATED) | trigger SQL em `contacts` INSERT -> `contact.created` (`022:45-47`); cobre manual, import, Meta Lead Ads, WhatsApp inbound | Sim (outbox -> reconcile -> `processar`) | só `filtroBate` genérico; nenhum teste de ponta a ponta | PARCIAL. Filtro `origem` falha p/ contato criado por WhatsApp inbound (ver ISSUE-09) |
| `gatilho.tag_adicionada` | trigger SQL diff de `contacts.tags` (`022:48-51`) | Sim | `triggers.service.spec.ts:29` (só filtro) | OK/PARCIAL (sem teste do emissor) |
| `gatilho.negocio_criado` (OPPORTUNITY_CREATED) | trigger SQL `deals` INSERT (`022:54-56`) | Sim | nenhum para o filtro `stageId` de negocio_criado | PARCIAL |
| `gatilho.etapa_mudou` (STAGE_CHANGED) | trigger SQL `deals.stage_id` mudou (`022:57-59`) | Sim | `triggers.service.spec.ts:23` | OK |
| `gatilho.negocio_status` (ganho/perdido) | trigger SQL `deals.status` mudou (`022:60-64`); também cancela runs do contato | Sim | `triggers.service.spec.ts:16` | OK, mas cancelamento é amplo (ISSUE-05) |
| `gatilho.mensagem_recebida` | trigger SQL `messages` autor 'contato' (`022:67-69`) | Sim; `de!=='contato'` filtrado (`triggers.service.ts:40`) | `spec:34` (só filtro texto) | PARCIAL. Campo `canal` do config nunca é lido em `filtroBate` |
| `gatilho.webhook` (FORM_SUBMITTED genérico) | `POST /v1/hooks/:chave` -> outbox `workflow.hook` | **NÃO na prática**: API exige `Idempotency-Key` e o proxy web não o repassa (ISSUE-01) | nenhum (sem spec de hooks.controller nem processarWebhook) | QUEBRADO |
| APPOINTMENT_CREATED/CONFIRMED/CANCELLED | `AgendaService` não emite nada (grep: nenhum evento/outbox/trigger em `agenda/`) | Não | n/a | AUSENTE |
| FORM_SUBMITTED nativo | não existe | n/a | n/a | AUSENTE (só webhook genérico) |
| CAMPAIGN_LEAD_RECEIVED | Meta lead vira `contact.created` com origem "Meta Lead Ads" (`meta-leads.service.ts:82`), mas não há gatilho dedicado nem campanha como contexto | Indireto via contato_criado+origem | nenhum | PARCIAL (sem campanha/ad no contexto) |
| FOLLOWUP_DUE / inatividade / data / aniversário / lead score | não existe scheduler de gatilho por tempo | Não | n/a | AUSENTE |

Observação de infra: `deal.moved` payload do trigger SQL não inclui `contactId`; `montarContexto` resolve via `deal.contactId` (`triggers.service.ts:197-201`), ok. Deduplicação do evento: `dedupeKey = outbox.id:gatilhoId` + índice único `(workflow_id, dedupe_key)` (`010`).

## 3. Actions (14) e controle (7)

Validação Zod: `validarConfig` roda na publicação (`workflows.service.ts:205`) e no teste; **o executor não revalida** e usa `no.config as {...}` (`executor.service.ts` inteiro), e os defaults do Zod são descartados porque `r.dados` não é gravado. Permissão: `PermissionsGuard` mapeia `automations.read/write` (`auth/permissions.guard.ts:21`); manager/admin/owner escrevem, viewer/member só leem. Ação roda como "sistema" via serviços do CRM (sem checagem de permissão por ação).

| Ação / controle | Funciona de fato | Validação | Idempotência no retry/crash | Log do passo | Falha permanente | Teste | Status |
|---|---|---|---|---|---|---|---|
| `acao.enviar_sms` (WhatsApp/STEVO) | Sim, via `MessagesService.send` com `executionKey=run:gen:no` e reserva antes do envio | texto 1-1000 | **Sim** (idempotency key + lock advisory); cancela se opt-out ou resposta após início do run (`messages.service.ts:60`) | sim (`workflowRunStep`) | `UnrecoverableError` p/ falhas não retentáveis; `pending`->retry | `executor.service.spec.ts:166-177` | OK |
| `acao.enviar_email` | Sim se `SMTP_URL`; senão `config_required` e segue | assunto/corpo | **Não**: crash após SMTP ok reenvia; **ignora opt-out e janela** | sim | falha SMTP real -> retry -> DLQ | spec 179-209 | PARCIAL |
| `acao.adicionar_tag` / `remover_tag` | Sim, via `crm.updateContact` | tag 1-40 | idempotente por natureza, mas **lost update** (ISSUE-03) | sim | erro -> retry | spec 247-258 | PARCIAL |
| `acao.atualizar_contato` | Sim | enum de campos | idempotente (set) | sim | idem | sem teste dedicado | PARCIAL |
| `acao.criar_oportunidade` | Sim (`crm.createDeal`) | stageId uuid (existência não verificada) | **Não** (duplica deal em retry/reentrega) | sim | stage inválida -> retry x4 -> DLQ | spec 259 | PARCIAL |
| `acao.mover_etapa` | Sim, exige negocio no contexto | stageId uuid | idempotente | sim | sem negócio -> erro explícito | sem teste | PARCIAL (gatilho de contato/mensagem não tem negócio: falha em runtime, não na publicação) |
| `acao.criar_tarefa` | Sim, assignee `''` (`executor.service.ts:465`) | titulo, emDias | **Não** (duplica) | sim | -- | sem teste | PARCIAL (não verificado se `tasks.create` aceita identityId vazio) |
| `acao.criar_nota` | Sim, autor `''` | corpo<=2000 | **Não** | sim | -- | sem teste | PARCIAL |
| `acao.definir_variavel` / `formatar_texto` | Sim, só no contexto do run | ok | idempotente | sim | -- | spec 210-246 | OK |
| `acao.ia` | Gated por `ANTHROPIC_API_KEY`, sem chave segue como `config_required` | tarefa enum | refaz chamada (custo) | sim | -- | spec 223-237 | PARCIAL (nenhum guardrail de custo/limite por tenant visto aqui) |
| `acao.chamar_workflow` | Sim, abre run no alvo se ativo (`runs.service.ts:384`) | uuid (existência não verificada) | dedupeKey com `Date.now()` = **não idempotente** | sim | alvo inativo é só `warn` | sem teste | PARCIAL (ciclo A->B->A possível com reentrada `sempre`) |
| `acao.webhook` | Sim, timeout 10 s, bloqueio SSRF por hostname literal | url | **Não** (POST repetido) | sim (500 chars da resposta) | 4xx/5xx -> retry x4 | spec 272 (só localhost) | PARCIAL (ISSUE-13) |
| `controle.esperar` | Persistido (ms no banco + delay BullMQ) | duracao>0 | seguro (generation) | sim | -- | `runs.service.spec.ts:72` | OK |
| `controle.esperar_resposta` | Persistido; ramos `resposta`/`timeout` | ok | seguro | sim | -- | `esperar-resposta.spec.ts` (só executor) | PARCIAL (ISSUE-04) |
| `controle.condicao` | AND/OR/NONE, case-insensitive | ramos>=1 | seguro | sim | -- | specs 65-117 | QUEBRADO no "nenhum ramo bate" (ISSUE-02) |
| `controle.split` | Hash determinístico por contato+nó | min 2 ramos | seguro | sim | -- | spec 141-163 | OK |
| `controle.drip` | Contador atômico em `workflow_drip_counters` | limites | seguro | sim | **run morre no passo 200** (ISSUE-10) | spec 118-134 | PARCIAL |
| `controle.ir_para` / `encerrar` | Sim, limite 200 passos | alvo existe (validado) | seguro | sim | -- | specs 135, `runs spec:148` | OK |

Retry/DLQ: BullMQ `attempts:4`, backoff exponencial 3 s (`runs.service.ts:260-264`); `@OnWorkerEvent('failed')` grava `workflow_dlq` + run `falhou` na última tentativa (`automations.processor.ts:22-31`); `aoFalhar:'seguir'` por nó (`runs.service.ts:209-216`); reprocessar do ponto onde parou (`runs.service.ts:450`). Teste: `runs.service.spec.ts:122-146`. Não há teste do `reconcile`, do lease/claim nem de reentrega real.

## 4. Wait / Delay

| Item | Situação |
|---|---|
| Persistência | Postgres (`scheduled_at`, `no_atual`, `estado`) + BullMQ delayed + reconcile a cada 5 s. **Sobrevive a restart.** OK |
| Duplicação | claim atômico por `generation` + lease; `jobId` determinístico; teste `runs.service.spec.ts:81,178`. Sem teste de concorrência real |
| Cancelamento | `cancelar` e cancelamentos por SQL/inbound só mudam status; job BullMQ fica no Redis e é ignorado ao acordar. OK funcionalmente, mas sem remoção do job |
| Timezone | `timezone` por workflow (padrão America/Sao_Paulo), conversão via `toLocaleString` (`runs.service.ts:364`). Funciona; não há UI de timezone verificada além do painel de config |
| Business hours | só para `acao.enviar_sms` (`runs.service.ts:360`). **Email, webhook, IA e `esperar` não respeitam**; "esperar 2 dias" é 48 h corridas, sem "dias úteis" |
| Workflow pausado | run não executa nem reagenda (`runs.service.ts:147`); ao reativar, o `reconcile` o retoma, possivelmente dias depois, mandando mensagem velha (ISSUE-11) |

## 5. Follow-up intelligence (cancelamento automático)

| Evento | Cancela follow-ups pendentes? | Onde / observação |
|---|---|---|
| Lead respondeu | PARCIAL | (a) no inbound, cancela runs cujo workflow tem `pararNoReply=true` (`messages.service.ts:121`); **padrão é `false`** (`011`). (b) `avisarResposta` acorda `esperar_resposta`. (c) rede de segurança no envio: SMS é cancelado se `lastInboundAt >= runStartedAt` (`messages.service.ts:60`). Email não tem essa guarda |
| Mudou de estágio | NÃO | nenhum código cancela run em `deal.moved` |
| Reunião agendada | NÃO | agenda não emite evento nem toca `workflow_runs` |
| Opt-out | SIM (com ressalvas) | regex `^(stop|parar|sair|cancelar|remover|não quero|nao quero)` marca `optedOutAt` e cancela todos os runs (`messages.service.ts:119-121`); SMS barra por `optedOutAt`; email e webhook não; sem reversão (ISSUE-06) |
| Humano assumiu | NÃO | não existe conceito de handoff; mensagem humana pelo inbox não cancela run |
| Conversa encerrada | NÃO | sem estado "encerrada" ligado ao motor |
| Negócio ganho/perdido | SIM, amplo demais | `022:62-63` cancela **todos** os runs do contato (inclusive de outros workflows) |

## 6. Retry, DLQ, histórico e reentrada

- Histórico: `workflow_run_steps` com entrada/saída/erro/duração; UI de execuções em `automacoes/[id]/execucoes`; listagem limitada a 100 sem paginação nem filtro por contato (`runs.service.ts:417-426`).
- DLQ: tabela + endpoint + banner na lista (`automacoes/page.tsx:95-113`, mostra 5). Falha por "limite de tentativas" no `reconcile` **não grava DLQ** (`operations.service.ts:43`), logo não é reprocessável pela UI. Eventos `automation.run` de falha/conclusão saem com `workflowId:''` (`runs.service.ts:235,245`).
- Reentrada: `uma_vez` (padrão), `sempre`, `apos_terminar` (`runs.service.ts:301-315`); teste em `janela.spec.ts:111-170`. Teste manual ignora a regra.
- Notificação de falha ao usuário: não existe (só contador na lista).

## 7. Templates / Marketplace

- Executáveis, não só visuais: `seed-marketplace.mjs` define 7 templates com grafo real; `instalar` faz criar -> salvar -> **publicar (valida e ativa)** reusando o `WorkflowsService` (`marketplace.service.ts:79-92`); spec `marketplace.service.spec.ts` existe. Nós usados existem no catálogo.
- Ressalvas: (1) instala **já ativo**, sem revisão do usuário; (2) `{{var.x}}` não resolvido passa na validação e vira texto literal (`bindVariaveis` mantém `m`); (3) `requirements` é só rótulo, sem bloqueio na instalação; (4) seed é script manual (não migration), sem versionamento/atualização de templates já instalados; (5) UI de instalação fica em `/marketing`, não em `/automacoes` (há link "Instalar uma pronta").

## 8. UX do builder (pelo código)

Presente: autosave de rascunho 700 ms (`[id]/page.tsx:180-190`), publicar com lista de problemas marcados no nó, pausar/ativar, painel de configuração (reentrada, parar no reply, janela, webhook), paleta agrupada com busca, seletores de etapa/workflow em vez de UUID, teste com contato real, execuções com cancelar, DLQ.
Ausente ou frágil:
- Não há **excluir**, **duplicar**, **rollback/histórico de versões** na UI (APIs `remover`/`rollback` existem; nenhum botão: grep em `app/(app)/automacoes` e `components/automations`).
- Autosave falho só mostra estado "erro" discreto; sem aviso ao sair; sem indicação "rascunho diferente do publicado".
- "Testar" executa ações reais (ok, UI avisa) mas o contexto de teste só tem `contato`: nós que exigem `negocio` ou `mensagem` falham, e não há modo simulação/dry-run.
- Validação de publicação não cobre: ramos `resposta`/`timeout` e do `split` sem aresta, ciclos sem espera, ids de etapa/workflow inexistentes, nós de ação que exigem negócio sob gatilho sem negócio, credencial faltando (SMTP/STEVO/IA), variáveis `{{...}}` inexistentes.
- Vocabulário técnico para o usuário comum: "ramo", "reentrada: uma_vez/apos_terminar", "Esperar resposta" vs "pararNoReply", "{{contato.nome}}" digitado à mão (sem seletor de variáveis); "Enviar SMS" que na verdade é WhatsApp não oficial.
- Publicar reativa workflow que estava pausado (`workflows.service.ts:250`).

## 9. Lista de gaps (resumo)

Críticos: webhook de entrada inutilizável (ISSUE-01). Altos: condição sem ramo (02), lost update de tags (03), `esperar_resposta`+`pararNoReply` (04), cancelamentos de follow-up ausentes (05), opt-out (06), triggers ausentes (07). Médios: 08-14, 16, 17. Baixos: 15, 18.

## 10. ISSUES

### ISSUE-01 Webhook de entrada nunca funciona pela URL pública
SEVERITY: Critical
ROOT CAUSE: `HooksController` exige o header `Idempotency-Key` e responde 400 sem ele (`hooks.controller.ts:36`); o proxy Next que é a URL entregue ao cliente só repassa `content-type` (`apps/web/app/api/hooks/[chave]/route.ts:17-21`). Formulários/ERPs comuns não enviam esse header de qualquer forma.
FILES: `apps/api/src/automations/hooks.controller.ts:36`; `apps/web/app/api/hooks/[chave]/route.ts:17-21`; `apps/api/src/automations/triggers.service.ts:107-131`
IMPACT: `gatilho.webhook` (única via de "formulário enviado"/ERP) retorna 400 sempre. Sem teste, ninguém percebeu.
RECOMMENDED FIX: tornar o header opcional e derivar a chave de idempotência de hash do corpo + chave do workflow (janela curta); repassar `idempotency-key` no proxy; limitar tamanho do corpo e aplicar rate limit por chave; adicionar spec de `HooksController` e de `processarWebhook`.
ACCEPTANCE CRITERIA: POST com JSON simples e sem header na URL exibida no painel retorna 202 e gera 1 run; reenvio idêntico em <=60 s não gera 2º run; chave inválida segue 202 sem criar nada; spec cobre os 3 casos.

### ISSUE-02 Condição sem ramo casado segue o primeiro ramo
SEVERITY: High
ROOT CAUSE: `condicao()` retorna `ramo: undefined` quando nada casa (`executor.service.ts:171`); `proximoDe` sem ramo escolhe a aresta sem rótulo ou `saidas[0]` (`runs.service.ts:412`), isto é, o primeiro ramo rotulado. O spec `runs.service.spec.ts:106` usa um ramo inexistente (`'nao-existe'`), não o retorno real do executor.
FILES: `executor.service.ts:166-172`; `runs.service.ts:408-413`; `runs.service.spec.ts:106-112`
IMPACT: contatos que deveriam cair no "else"/encerrar recebem a ação do primeiro ramo (ex.: oferta VIP para quem não é VIP).
RECOMMENDED FIX: executor devolve `encerrar:true` (ou ramo `'__nenhum'`) quando nada casa; `proximoDe` com `ramo` definido nunca cai em fallback; validação exige ramo `NONE` ("senão") em toda condição ou aviso explícito.
ACCEPTANCE CRITERIA: teste de integração Executor+Runs com grafo de 2 ramos e contato que não casa termina `concluido` sem executar nenhum ramo.

### ISSUE-03 Tags sobrescritas por contexto velho (lost update)
SEVERITY: High
ROOT CAUSE: `mexerTag` calcula `tags` a partir de `ctx.contato.tags`, snapshot do início do run (`triggers.service.ts:211-214`, `executor.service.ts:422-427`) e grava o array inteiro. Após uma espera de horas/dias ou edição humana concorrente, tags adicionadas nesse intervalo são apagadas. Condições também avaliam contato/valor velhos.
FILES: `executor.service.ts:417-429,270-275`; `crm.service.ts` (`updateContact`)
IMPACT: perda silenciosa de segmentação e de gatilhos de tag; decisões de condição com dados desatualizados.
RECOMMENDED FIX: operações atômicas `add_tag/remove_tag` no CRM (SQL `array_append/array_remove`) e recarregar contato/negócio do banco no início de cada nó que lê o contexto (ou após cada espera).
ACCEPTANCE CRITERIA: teste: contato com tag X adicionada manualmente durante `esperar` mantém X após `adicionar_tag Y`.

### ISSUE-04 `pararNoReply` cancela o run antes do ramo "Respondeu"
SEVERITY: High
ROOT CAUSE: o inbound cancela, na mesma transação, runs de workflows com `pararNoReply` (`messages.service.ts:121`), antes de `avisarResposta` acordar o nó `esperar_resposta` (`triggers.service.ts:45-48`, `runs.service.ts:332`). Em um workflow com os dois recursos, o run morre cancelado e nunca segue o ramo `resposta`.
FILES: `messages.service.ts:119-121`; `runs.service.ts:321-352`
IMPACT: o caso de uso nuclear de follow-up ("se responder, marca engajado") falha quando o usuário também marca "parar ao responder".
RECOMMENDED FIX: no inbound não cancelar runs que estão com `estado.aguardandoResposta` igual ao `noAtual`; centralizar a lógica de resposta em um só lugar (`avisarResposta`) e dentro da transação marcar `respondeu`.
ACCEPTANCE CRITERIA: teste de integração: workflow com `esperar_resposta` e `pararNoReply=true`, contato responde -> run segue ramo `resposta`; outros runs do mesmo contato sem espera são cancelados.

### ISSUE-05 Follow-ups não cancelam em mudança de estágio, reunião, humano assumindo, conversa encerrada
SEVERITY: High
ROOT CAUSE: só existem 3 cancelamentos: resposta com `pararNoReply` (padrão desligado), opt-out, negócio ganho/perdido (que cancela todos os runs do contato, `022:62-63`). Não há eventos de agenda, handoff ou encerramento no motor.
FILES: `db/022_production_foundation.sql:60-64`; `messages.service.ts:60,121`; `agenda/agenda.service.ts` (sem emissão); `011` (`parar_no_reply DEFAULT false`)
IMPACT: lead agendado, em negociação avançada ou atendido por humano continua recebendo cadência automática.
RECOMMENDED FIX: política de "cancelamento por condição de saída" por workflow (checkbox: respondeu, mudou de etapa, agendou, humano respondeu, encerrou, ganho/perdido), implementada no motor central; emitir `appointment.*`, `conversation.closed` e "humano respondeu" (autor humano) no outbox; padrão `pararNoReply=true` em templates de follow-up; restringir o cancelamento por ganho/perdido ao `deal_id` do run ou a workflows marcados.
ACCEPTANCE CRITERIA: testes por evento: run em `esperando` vira `cancelado` com motivo legível; workflow não relacionado do mesmo contato não é cancelado quando a política é por negócio.

### ISSUE-06 Opt-out por regex: falso positivo permanente, sem reversão, e só SMS respeita
SEVERITY: High
ROOT CAUSE: `^(stop|parar|sair|cancelar|remover|não quero|nao quero)\b` casa "Cancelar minha reunião" ou "Não quero pagar tanto, tem desconto?" e grava `optedOutAt` definitivo (`messages.service.ts:119-120`). Não há tela/ação para limpar; `enviar_email` e `webhook` ignoram o campo.
FILES: `messages.service.ts:60,119-121`; `executor.service.ts:318-337`; `schema.prisma:350`
IMPACT: perda de leads válidos (silenciados para sempre) e risco LGPD/anti-spam para e-mail.
RECOMMENDED FIX: aceitar só mensagem curta inteira (ex.: `^(sair|parar|stop)[.!\s]*$`), registrar origem/data, dar opt-in manual na UI do contato, e checar `optedOutAt` (por canal) em todo nó de comunicação.
ACCEPTANCE CRITERIA: "Cancelar minha reunião" não gera opt-out; "PARAR" gera; botão "reativar" limpa; `enviar_email` falha como `cancelled` para contato com opt-out.

### ISSUE-07 Gatilhos de agenda, formulário, campanha e prazo de follow-up não existem
SEVERITY: High
ROOT CAUSE: catálogo fechado em 7 gatilhos (`catalogo.ts:9-17`); `AgendaService` não emite eventos; não há scheduler por tempo.
FILES: `catalogo.ts:9-41`; `triggers.service.ts:10-17` (MAPA); `agenda/agenda.service.ts`; `db/022:42-80`
IMPACT: automações de confirmação/lembrete de reunião, no-show, formulário nativo, lead de campanha e "sem resposta há N dias" (reativação) não podem ser montadas; só dá para improvisar com `esperar`.
RECOMMENDED FIX: adicionar `gatilho.agendamento_{criado,confirmado,cancelado,no_show}`, `gatilho.lead_campanha` (com campanha/anúncio no contexto), `gatilho.inatividade` (job periódico) e emitir os eventos no outbox junto da escrita.
ACCEPTANCE CRITERIA: cada novo gatilho tem emissor em transação, entrada em `MAPA`, filtro em `filtroBate` e teste de ponta a ponta (evento -> run criado).

### ISSUE-08 Ações com efeito externo não são idempotentes em retry/crash
SEVERITY: Medium
ROOT CAUSE: só `enviar_sms` usa chave de idempotência. `criar_oportunidade`, `criar_tarefa`, `criar_nota`, `enviar_email`, `webhook` repetem o efeito se o job é reentregue (crash entre ação e `avancar`, lease expirado, retry após falha do log/avanço: `runs.service.ts:177-205,206-218`).
FILES: `executor.service.ts:318-337,442-481,483-504`; `runs.service.ts:123-139`
IMPACT: negócios, tarefas, notas e e-mails duplicados; webhook duplicado em sistema do cliente.
RECOMMENDED FIX: passar `executionKey` a cada ação e gravar o resultado do passo (tabela de efeitos ou unique `(run_id, generation)` nos criadores); enviar `Idempotency-Key` no webhook.
ACCEPTANCE CRITERIA: simular exceção após a ação e reexecutar o passo -> 1 só registro criado.

### ISSUE-09 Filtro de origem do `contato_criado` falha para contato vindo do WhatsApp
SEVERITY: Medium
ROOT CAUSE: o trigger SQL usa `campos_custom->>'origem'` com fallback 'Manual' (`022:47`); o contato criado por mensagem inbound não grava origem (`messages.service.ts` entrada: `contact.create` sem `camposCustom`). O evento em tempo real diz 'WhatsApp', mas o motor usa o do outbox.
FILES: `db/022:45-47`; `messages.service.ts:108-111`
IMPACT: automação "novo contato do WhatsApp" com filtro de origem não dispara.
RECOMMENDED FIX: gravar `origem` ao criar contato por inbound; adicionar teste de `contact.created` por origem.
ACCEPTANCE CRITERIA: contato criado por inbound dispara workflow com filtro `origem=WhatsApp`.

### ISSUE-10 Drip derruba o run após 200 reentradas; contadores nunca limpos
SEVERITY: Medium
ROOT CAUSE: cada reentrada do drip passa por `avancar` e incrementa `passos` (`runs.service.ts:252`), com `MAX_PASSOS=200` (`:30,152`); `workflow_drip_counters` não tem rotina de limpeza (`015`).
FILES: `runs.service.ts:30,152,193-199`; `executor.service.ts:197-225`; `db/015_drip.sql`
IMPACT: em lote grande com vazão baixa (ex.: 10/hora) contatos do fim da fila falham por "loop"; tabela cresce indefinidamente.
RECOMMENDED FIX: não contar passos de espera/drip em `passos` (ou limite separado), e job de purge de janelas antigas.
ACCEPTANCE CRITERIA: drip 1/janela com 250 contatos conclui todos; janelas >7 dias são removidas.

### ISSUE-11 Pausar congela runs; publicar/rollback reativam silenciosamente
SEVERITY: Medium
ROOT CAUSE: run de workflow pausado só retorna (`runs.service.ts:147`) e fica `esperando`; ao reativar, `reconcile` o retoma mesmo dias depois. `publicar` e `rollback` forçam `status:'ativo'` (`workflows.service.ts:250,262`).
FILES: `runs.service.ts:147`; `workflows.service.ts:235-279`; `operations.service.ts:34`
IMPACT: mensagens atrasadas e fora de contexto após reativar; usuário que pausou por problema volta ao ar ao publicar correção sem querer.
RECOMMENDED FIX: ao pausar perguntar "cancelar execuções em andamento?"; publicar preserva `pausado`; opção de expirar runs mais velhos que N horas.
ACCEPTANCE CRITERIA: publicar em workflow pausado mantém `pausado`; UI oferece cancelar pendentes.

### ISSUE-12 Builder sem excluir/duplicar/rollback e com validação incompleta
SEVERITY: Medium
ROOT CAUSE: UI não expõe `remover` e `rollback` (existem em `lib/automations.ts:97,101`), não há "duplicar" em lugar algum; `validar()` não checa ramos de `esperar_resposta`/`split`, existência de stage/workflow, necessidade de negócio no contexto, ciclos, credenciais, `{{var.x}}` não resolvido.
FILES: `workflows.service.ts:191-232`; `apps/web/app/(app)/automacoes/[id]/page.tsx`; `automacoes/page.tsx`
IMPACT: usuário não técnico acumula rascunhos que não consegue apagar, não reaproveita fluxo, e só descobre erro quando o run falha (ex.: `mover_etapa` sob gatilho de mensagem).
RECOMMENDED FIX: botões excluir (com aviso de runs ativos), duplicar, histórico de versões com rollback; ampliar `validar()` com as regras acima e mostrar avisos de credencial faltando.
ACCEPTANCE CRITERIA: specs de `validar()` para cada regra nova (hoje não há spec de `WorkflowsService`); fluxo duplicado abre como rascunho independente.

### ISSUE-13 Webhook de saída: SSRF incompleto e efeito de resposta
SEVERITY: Medium
ROOT CAUSE: o bloqueio olha só o hostname literal (`executor.service.ts:506-510`): não resolve DNS (nip.io/rebinding), não trata `100.64/10`, IPv6 mapeado, IP decimal/hex, e `fetch` segue redirects por padrão (redirect 302 para metadata passa).
FILES: `executor.service.ts:483-510`
IMPACT: automação de tenant pode alcançar rede interna; resposta (500 chars) é gravada no log do passo.
RECOMMENDED FIX: resolver DNS e validar IP final, `redirect:'manual'`, lista de bloqueio completa, allowlist opcional por tenant.
ACCEPTANCE CRITERIA: specs para domínio que resolve a 127.0.0.1, redirect para 169.254.169.254, `http://2130706433`.

### ISSUE-14 Janela de envio e business hours restritas ao SMS
SEVERITY: Medium
ROOT CAUSE: `esperarJanela` retorna 0 se `no.tipo !== 'acao.enviar_sms'` (`runs.service.ts:360`); `esperar` não tem modo dias úteis.
FILES: `runs.service.ts:359-381`; `catalogo.ts:102-105`
IMPACT: e-mail e webhook saem de madrugada/fim de semana; "esperar 2 dias" cai em sábado.
RECOMMENDED FIX: incluir `acao.enviar_email` (e IA que responde) na janela; opção "dias úteis/respeitar janela" no `esperar`.
ACCEPTANCE CRITERIA: `janela.spec` cobre e-mail; espera de 1 dia útil iniciada na sexta acorda na segunda.

### ISSUE-15 DLQ/observabilidade incompletas
SEVERITY: Medium
ROOT CAUSE: `reconcile` marca `falhou` sem DLQ (`operations.service.ts:43`); eventos `automation.run` de `falhar/concluir` saem com `workflowId:''` (`runs.service.ts:235,245`); sem notificação ao usuário; runs/DLQ sem paginação ou filtro por contato; `cancelar`, `reprocessar` e `testar` sem audit log.
FILES: `operations.service.ts:41-45`; `runs.service.ts:229-246,417-466`; `automations.controller.ts:122-154`
IMPACT: falhas silenciosas e irrecuperáveis pela UI; auditoria incompleta.
RECOMMENDED FIX: gravar DLQ também no caminho do reconcile; passar `workflowId` real; notificação in-app/e-mail de falha; paginação + filtro; audit log nas três ações.
ACCEPTANCE CRITERIA: run falho por limite aparece no DLQ e é reprocessável; teste de audit.

### ISSUE-16 Templates instalam ativos e sem checagem de requisitos
SEVERITY: Medium
ROOT CAUSE: `instalar` chama `publicar` direto (`marketplace.service.ts:90`); variáveis sem valor permanecem `{{var.x}}`; `requirements` não é verificado; seed manual.
FILES: `marketplace.service.ts:79-92,95-110`; `apps/api/scripts/seed-marketplace.mjs`
IMPACT: cadência de WhatsApp entra no ar sem o usuário revisar texto, janela ou credenciais.
RECOMMENDED FIX: instalar como rascunho (ou ativo só após confirmação), falhar se variável obrigatória estiver vazia, bloquear/avisar quando `requirements` não estiver conectado.
ACCEPTANCE CRITERIA: instalar sem valor obrigatório retorna 400; workflow instalado nasce `rascunho`.

### ISSUE-17 Permissões coarse e ação "sistema" sem identidade
SEVERITY: Low
ROOT CAUSE: um único `automations.write` cobre publicar, excluir, testar (que envia mensagem real) e cancelar (`permissions.guard.ts:21`); tarefas/notas criadas com `identityId ''` (`executor.service.ts:465,479`).
IMPACT: manager pode disparar mensagem real via "Testar"; autoria das notas/tarefas vazia.
RECOMMENDED FIX: permissões separadas (`automations.publish`, `automations.test`), ator "automação:<workflow>" nos registros criados.
ACCEPTANCE CRITERIA: viewer/member negados; registros criados exibem origem da automação.

### ISSUE-18 Código morto e inconsistências
SEVERITY: Low
ROOT CAUSE: `FILA_GATILHOS`/`GatilhosProcessor`/`dedupeKey` do `DomainEventsService` sem produtor; comentários do catálogo ("6 gatilhos", "10 ações", "15 nós") divergem dos 7/14 reais (`catalogo.ts:4-7,18,26`; `automations.controller.ts:46`); defaults do Zod descartados, então `condicao` sem `regras`/`juncao` quebra em runtime.
FILES: `automations.processor.ts:34-51`; `events/domain-events.service.ts`; `catalogo.ts`; `executor.service.ts:238`
RECOMMENDED FIX: remover fila morta, gravar `r.dados` (config normalizada) ao salvar/publicar, alinhar comentários.
ACCEPTANCE CRITERIA: condição salva sem `regras` publica com default `[]` e não lança erro.

## 11. Cobertura de testes (fato)

Existem 6 specs (executor, runs, esperar-resposta, janela, triggers, marketplace). Todos usam mocks de Prisma/BullMQ. **Sem teste** para: emissão via trigger SQL/outbox, `reconcile`, `avisarResposta`, `processarWebhook`, `HooksController`, `WorkflowsService` (validar/publicar/testar), filtros `negocio_criado/contato_criado`, claim/lease concorrente, cancelamento por opt-out/resposta, `encadear`. Nenhum teste de integração com Postgres/Redis reais.

## 12. O que está sólido (para não regredir)

Estado em Postgres e delay durável com reconcile; versão publicada imutável por run; dedupe de gatilho por `(workflow_id, dedupe_key)`; claim por generation/lease; envio SMS reservado antes de enviar e nunca reenviado em incerteza; guarda de resposta recente no envio; reentrada configurável; fallback `aoFalhar`; DLQ com reprocesso; RLS por tenant; webhook de entrada com chave revogável e roteamento sem confiar no corpo.

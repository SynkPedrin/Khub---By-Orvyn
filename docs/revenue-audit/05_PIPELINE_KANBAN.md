# 05 — Pipeline/Kanban, Leads/Contatos e Inbox/Conversas

Auditoria SOMENTE LEITURA. Nenhum código foi alterado e nenhum teste foi executado: os testes existentes são citados como evidência estática. Legenda de STATUS: **REAL** (backend + UI ligados), **PARCIAL**, **API-ONLY** (backend existe, sem UI), **UI-ONLY/DEMO** (só dados de demonstração), **AUSENTE**.

Premissa do modo demo: `apps/web/lib/demo/flag.ts:19-23` força `modoDemo()=false` em produção. Tudo que só existe em `Quadro`, `LeadsComDados`, `/conversas` demo e `/leads/[id]` demo é vitrine e NÃO conta como funcionalidade.

## 1. Kanban / Pipeline

Arquivos centrais: `apps/api/src/crm/crm.service.ts`, `crm.controller.ts`, `apps/web/app/(app)/pipeline/page.tsx` (`PipelineReal` linhas 58-206; `Quadro` demo 208+).

| Capacidade | STATUS | Evidência |
|---|---|---|
| Listar pipeline/estágios | PARCIAL | `crm.service.ts:376-391` retorna TODOS os estágios do tenant misturados, sem filtro por `pipelineId` e sem seletor de funil na UI |
| Criar pipeline | API-ONLY (só Nyro/blueprint) | `createPipeline` `crm.service.ts:413`; chamado só por `nyro/tool-executor.service.ts:132` e `blueprints/blueprint.service.ts:47`. Nenhuma rota REST em `crm.controller.ts` |
| Criar estágio | API-ONLY (só Nyro) | `createStage` `crm.service.ts:429`, só `tool-executor.service.ts:134` |
| Editar/renomear/reordenar/excluir pipeline ou estágio | AUSENTE | Nenhum método de update/delete/reorder em `crm.service.ts`; sem rota |
| Criar oportunidade | PARCIAL | `POST /crm/deals` existe (`crm.controller.ts:96`, `crm.service.ts:393`), mas `PipelineReal` não tem botão/modal; `crm.createDeal` (`lib/crm.ts:112`) não é chamado. O "Nova oportunidade" existe só em `Quadro` (demo, `page.tsx:298`, sem onClick) |
| Editar oportunidade (título, valor, origem, contato) | API-ONLY | `PATCH /crm/deals/:id` (`crm.controller.ts:111`); sem UI real |
| Excluir oportunidade | API-ONLY | `DELETE /crm/deals/:id`; sem UI; sem confirmação |
| Drag-and-drop persistido | REAL | `PipelineReal.mover` `page.tsx:77-102` chama `PATCH deals/:id/stage` (`crm.service.ts:439`) |
| Falha de rede no drag | REAL (honesto) | Update otimista; em `catch` mostra aviso e chama `carregar()` (recarrega do servidor), `page.tsx:95-98`. Não há teste de componente cobrindo isso |
| Reordenar dentro da coluna | AUSENTE | `Deal` não tem campo de posição; backend ordena por `createdAt asc` (`crm.service.ts:380`), a UI insere no topo (`page.tsx:87`) e após refresh o card volta de lugar |
| Mover por teclado | PARCIAL | Menu "Mover para" existe só no `Cartao` do demo (`page.tsx:493-507`); `PipelineReal` é só HTML5 DnD (inacessível por teclado/touch) |
| Audit log | PARCIAL | `AuditInterceptor` (`common/audit.interceptor.ts`) grava linha genérica `deals.stage` com `actor_id`, SEM antes/depois. `Activity` grava texto "moveu X para Y" com `actor:'Você'` fixo (`crm.service.ts:447`), não o usuário real |
| Disparo de automação ao mudar de estágio | REAL | Trigger SQL `orvyn_domain_outbox` (`db/022:57-59`) insere `deal.moved` ao mudar `stage_id` (vale também para `PATCH /deals/:id` com stageId); `TriggersService` mapeia para `gatilho.etapa_mudou` (`triggers.service.ts:12`) e filtra por `stageId`. Teste: `crm.service.spec.ts:148` (apenas evento realtime, não o worker) |
| Ganho/perda | API-ONLY | `status` aberto/ganho/perdido via `PATCH /deals/:id` (`crm.controller.ts:40`); trigger cancela runs ao ganhar/perder (`db/022:64-66`) e publica `deal.status_changed`. Sem UI, sem motivo de perda, sem data de fechamento. `overview` considera "ganho" = deals na ÚLTIMA etapa (`crm.service.ts:106-107`), ignorando `status` (inconsistente com o campo de status) |
| Filtros / busca / responsável | UI-ONLY/DEMO | Controles existem só em `Quadro` e não têm handlers (`page.tsx:272-296`). `Deal` não tem owner. Busca global ⌘K cobre deals por título/origem/contato (`crm.service.ts:472`) |
| Tags no deal | AUSENTE | Só `Contact.tags`; `Deal` sem tags |
| Histórico do deal | PARCIAL | `Activity.dealId` é gravada; `GET /deals/:id` (`crm.service.ts:281`) NÃO retorna activities; sem painel de detalhe no board real |
| Próxima ação | PARCIAL | Existe `Contact.proximaAcaoAt/Tipo` e `ownerId` no schema (`schema.prisma` ~375-377) mas nenhum endpoint/DTO os escreve ou lê (grep em `apps/api/src`, `apps/web` sem uso fora de demo). Tarefas (`Task` com `dealId`) existem (`crm-f2.controller.ts:87-104`) |
| Contexto no card | PARCIAL | Card real mostra título, nome do contato, valor, origem (`page.tsx:191-196`). Sem tempo parado (embora `Deal.updatedAt` exista), sem última interação, sem próxima ação, sem indicador de atenção. Sem probabilidade inventada no card real. O demo (`Quadro`) tem dados fabricados, isolados por `modoDemo` |
| KPIs do board real | REAL, limitados | Valor, nº, ticket médio, nº etapas, calculados do que foi carregado (`page.tsx:141-150`); sem conversão/ciclo (corretamente ausentes). Inclui deals perdidos/ganhos no "Valor em Pipeline" (não filtra `status`) |
| Pipelines por cliente (modo agência) | REAL por isolamento de tenant | Cliente = tenant próprio (`db/026_agency.sql`); entrar no cliente troca `tenantId` do JWT, então funis são por cliente via RLS. Não há visão consolidada nem template de funil entre clientes (só blueprint) |
| Tempo real no board | AUSENTE | `PipelineReal` não usa `useRealtime`; `deal.created/moved` são emitidos (`crm.service.ts:408,450`) mas ninguém ouve. Outra aba/usuário só vê após reload |

### ISSUEs — Kanban

**ISSUE K-1: Sem CRUD de pipeline/estágio e sem criação/edição de oportunidade na UI real**
SEVERITY: Alta
ROOT CAUSE: UI real foi reduzida a "mover card"; endpoints REST de funil nunca foram criados (só chamadas internas da Nyro).
FILES: `apps/api/src/crm/crm.controller.ts:91-119`; `apps/api/src/crm/crm.service.ts:413,429`; `apps/web/app/(app)/pipeline/page.tsx:58-206`; `apps/web/lib/crm.ts:93,111-112`
IMPACT: Operador só consegue ter funil se a Nyro/blueprint criar; não cria oportunidade, não edita, não marca ganho/perda, não exclui. Board vazio mostra `PipelineVazio`.
RECOMMENDED FIX: Rotas `POST/PATCH/DELETE /crm/pipelines` e `/crm/pipelines/:id/stages` (+ reorder), com bloqueio de exclusão de estágio com deals (exigir destino); modal "Nova oportunidade", painel de detalhe com editar/ganho/perda (motivo)/excluir.
ACCEPTANCE CRITERIA: usuário cria funil, renomeia/reordena/exclui etapa (com migração de deals), cria/edita/exclui deal e marca ganho/perda pela UI; cada ação gera Activity com o usuário real e audit_log com antes/depois; testes de serviço + isolamento RLS.

**ISSUE K-2: Pipeline mistura todos os funis do tenant**
SEVERITY: Média
ROOT CAUSE: `pipeline()` faz `stage.findMany` sem `pipelineId`; `moveDeal` aceita stage de qualquer funil e reescreve `pipelineId` (`crm.service.ts:444`).
FILES: `apps/api/src/crm/crm.service.ts:376-391,439-452`
IMPACT: Com 2+ funis (ex.: criados pela Nyro) as colunas se misturam; arrastar entre funis diferentes é permitido sem regra.
RECOMMENDED FIX: parâmetro `pipelineId`, seletor na UI, e validar que origem e destino pertencem ao mesmo funil.
ACCEPTANCE CRITERIA: GET retorna só estágios do funil pedido; mover para stage de outro funil retorna 400; teste unitário para ambos.

**ISSUE K-3: Cards sem contexto operacional (tempo parado, última interação, próxima ação, atenção) e sem ordem persistida**
SEVERITY: Média
ROOT CAUSE: `pipeline()` só seleciona título/contato/valor/origem; sem `updatedAt`, sem última Activity/Message, sem `position`.
FILES: `apps/api/src/crm/crm.service.ts:383-388`; `apps/web/app/(app)/pipeline/page.tsx:183-197`; `apps/api/prisma/schema.prisma` (model Deal)
IMPACT: Vendedor não vê o que está parado nem o que fazer; ordem muda após reload.
RECOMMENDED FIX: devolver `parado_desde` (desde último `deal.moved`/updatedAt), `ultimaInteracaoAt` (contact.lastInboundAt/última mensagem), próxima tarefa aberta, flag de atenção derivada por regra determinística (ex.: sem interação > N dias, tarefa vencida) e rotulada pela regra; coluna `posicao`. Não exibir probabilidade.
ACCEPTANCE CRITERIA: card mostra "parado há N dias", última interação e próxima tarefa a partir de dados reais; sem dado, mostra "—"; reorder persiste após reload.

**ISSUE K-4: Falta tempo real, acessibilidade por teclado e filtros no board real**
SEVERITY: Média
ROOT CAUSE: `PipelineReal` não usa `useRealtime` nem o menu "Mover para"; filtros só existem no demo sem handlers.
FILES: `apps/web/app/(app)/pipeline/page.tsx:58-206,272-296`
IMPACT: Dois usuários divergem; sem alternativa a DnD (touch/teclado); sem busca/filtro por owner.
RECOMMENDED FIX: assinar `deal.created/moved/updated/deleted`; reaproveitar menu "Mover para"; busca e filtro por owner (exige `Deal.ownerId`).
ACCEPTANCE CRITERIA: mover em uma aba reflete em outra em <2s; mover funciona por teclado; busca filtra cards.

**ISSUE K-5: Audit/Activity sem autor real e sem diff; "ganho" inconsistente**
SEVERITY: Média
ROOT CAUSE: `actor:'Você'` fixo; interceptor genérico; `overview` usa última etapa como ganho.
FILES: `apps/api/src/crm/crm.service.ts:262,333,345,366,404,447,106-107,120`; `apps/api/src/common/audit.interceptor.ts:42-60`
IMPACT: Trilha não identifica quem mudou nem o que mudou; KPIs de funil divergem do `status`.
RECOMMENDED FIX: passar `identityId`/nome ao serviço; gravar `payload` antes/depois no `audit_logs`; calcular ganho por `status='ganho'`.
ACCEPTANCE CRITERIA: audit_logs de `deal.moved` traz actor_id e `{de,para}`; overview ganho == soma de deals `status='ganho'`.

## 2. Leads / Contatos

Arquivos: `crm.service.ts`, `leads.service.ts`, `telefone.ts`, `notes.service.ts`, `tasks.service.ts`, `companies.service.ts`; web `/contatos`, `/contatos/[id]`, `/leads`, `/leads/[id]`.

| Capacidade | STATUS | Evidência |
|---|---|---|
| Criar contato manual | REAL | `POST /crm/contacts`; modal em `contatos/page.tsx:59-72` |
| Criar contato via WhatsApp inbound | REAL | `messages.service.ts:115-117` |
| Lead externo (Meta Lead Ads) | REAL (backend) | `LeadsService.upsertFromLead` `leads.service.ts:41`; testes `leads.service.spec.ts` (criação, dedupe e-mail, reentrega, telefone formatado, tenant) |
| Importação CSV | AUSENTE | Nenhum endpoint/UI de importação (grep "csv" sem ocorrências em crm/web de leads). Comentário em `crm.service.ts:131-138` cita "lote de importação" mas não há código |
| Deduplicação | PARCIAL | Telefone (últimos 8 dígitos, índice `db/012`) e e-mail só em lead externo/inbound. `createContact` manual NÃO deduplica (`crm.service.ts:352-374`); não há UNIQUE em `contacts` (`UNIQUE(tenant_id,email)` de `db/003:18` é da tabela `users`). Webhook de automação deduplica por e-mail ou `contains` dos 8 dígitos (`triggers.service.ts:150-153`), regra diferente do helper único |
| Atualizar/excluir contato | REAL | `PATCH/DELETE /crm/contacts/:id`; UI em `contatos/[id]` |
| Detalhe/360 + timeline | REAL em `/contatos/[id]` | `getContact` (`crm.service.ts:191`): empresa, deals, conversas, tarefas, notas, últimas 30 activities. Timeline é só `Activity` textual |
| Notas/tarefas | REAL | `crm-f2.controller.ts:87-120`; UI em `contatos/[id]` |
| Origem | PARCIAL | `Contact.origem` existe no schema mas `createContact` não a grava (a recebe só para o evento, `crm.service.ts:372`); lead externo grava em `camposCustom.lead_origem`; o trigger SQL lê `campos_custom->>'origem'` (`db/022:46`) e portanto sempre emite "Manual" |
| Owner/responsável | AUSENTE | `Contact.ownerId` no schema, sem DTO/endpoint/UI |
| Atribuição de campanha | PARCIAL | colunas `adCampaignId` (migration 025); sem preenchimento no fluxo de criação auditado |
| Lista paginada/busca | REAL | cursor + busca (`crm.service.ts:140`); testes `crm.service.spec.ts:56-110` |
| `/leads` real | PARCIAL | Tabela somente leitura de contatos, sem busca/filtros; "Novo Lead" sem onClick (`leads/page.tsx:440`); erro faz `window.location.reload()` |
| `/leads/[id]` real | UI-ONLY/DEMO | Fora do demo sempre mostra "Lead não encontrado" (`leads/[id]/page.tsx:49-67`); a lista `/leads` linka para `/contatos/:id`, então funciona, mas a rota `/leads/:id` é morta |
| Score | PARCIAL | `lead-score.ts` determinístico com fatores explicados e testado; não verificado se é exposto na UI real |

### ISSUEs — Leads

**ISSUE L-1: Contato manual não é deduplicado e pode ser duplicado por e-mail/telefone**
SEVERITY: Alta
ROOT CAUSE: dedupe existe só em `LeadsService` e no inbound; `createContact`/`updateContact` não consultam `acharContatoPorTelefone` nem e-mail; sem índice único.
FILES: `apps/api/src/crm/crm.service.ts:352-374,239-267`; `apps/api/src/crm/leads.service.ts:107-119`; `apps/api/src/automations/triggers.service.ts:148-154`
IMPACT: Duas fichas da mesma pessoa; inbound cai na mais antiga (`ORDER BY created_at`), histórico e automações se dividem.
RECOMMENDED FIX: centralizar `acharExistente` (e-mail + telefone normalizado) em um único serviço usado por criação manual, edição, import, webhook e inbound; devolver 409 com o id existente; índice único parcial por e-mail normalizado por tenant.
ACCEPTANCE CRITERIA: POST de contato com telefone/e-mail já existente retorna 409 `{existingId}`; PATCH que colide também; testes cobrindo máscara, DDI e caixa.

**ISSUE L-2: Sem importação de contatos (CSV)**
SEVERITY: Alta
ROOT CAUSE: funcionalidade nunca implementada.
FILES: ausência em `apps/api/src/crm/*`, `apps/web/app/(app)/contatos/*`
IMPACT: Não há como migrar base existente; bloqueia onboarding de clientes de agência.
RECOMMENDED FIX: upload CSV com pré-visualização, mapeamento de colunas, dedupe (L-1), relatório de linhas rejeitadas, processamento em lote idempotente, origem "Importação".
ACCEPTANCE CRITERIA: importar 1.000 linhas com 50 duplicadas cria 950, reporta 50 e linhas inválidas; reimportar o mesmo arquivo não cria nada.

**ISSUE L-3: Origem do contato perdida e evento `contact.created` com origem errada**
SEVERITY: Média
ROOT CAUSE: trigger SQL `orvyn_domain_outbox` lê `campos_custom->>'origem'`, mas nenhum caminho grava essa chave (lead externo grava `lead_origem`; manual/WhatsApp não gravam); `Contact.origem` nunca é escrita.
FILES: `db/022_production_foundation.sql:46`; `apps/api/src/crm/crm.service.ts:352-372`; `apps/api/src/crm/leads.service.ts:60-64,85-94`; `apps/api/src/crm/messaging/messages.service.ts:116`
IMPACT: Gatilho "Contato criado" filtrado por origem ("Meta Lead Ads", "WhatsApp") não dispara (o outbox durável traz "Manual"); relatórios de origem não confiáveis.
RECOMMENDED FIX: gravar `contacts.origem` em todos os caminhos e fazer o trigger ler a coluna.
ACCEPTANCE CRITERIA: contato criado via WhatsApp/Meta/manual tem `origem` correta e o gatilho com filtro de origem dispara; teste de integração com trigger.

**ISSUE L-4: Responsável e próxima ação inexistentes na API/UI; rota `/leads/:id` morta; "Novo Lead" sem ação**
SEVERITY: Média
ROOT CAUSE: colunas criadas (migration 023) sem DTO/serviço/UI; telas reais de lead ficaram stubs.
FILES: `apps/api/prisma/schema.prisma` (Contact.ownerId, proximaAcaoAt/Tipo); `apps/api/src/crm/crm.controller.ts:26-35`; `apps/web/app/(app)/leads/[id]/page.tsx:49-67`; `apps/web/app/(app)/leads/page.tsx:440`
IMPACT: Sem atribuição de vendedor nem fila de follow-up; usuário que cai em `/leads/:id` vê "não encontrado".
RECOMMENDED FIX: expor `ownerId`/`proximaAcao*` em PATCH/GET (validando membership do tenant); redirecionar `/leads/:id` para `/contatos/:id`; ligar "Novo Lead" ao modal de contato.
ACCEPTANCE CRITERIA: atribuir owner e próxima ação pela UI persiste e aparece em lista, perfil e card do Kanban.

## 3. Inbox / Conversas

Arquivos: `apps/web/app/(app)/inbox/page.tsx` (tela real), `/conversas/page.tsx` (real = `ConversasVazio`, demo = `Inbox`), `messaging/*`, `realtime/*`, `operations/operations.service.ts`.

| Capacidade | STATUS | Evidência |
|---|---|---|
| Inbound WhatsApp (Evolution) | REAL (texto) | webhook `evolution-webhook.controller.ts` valida token timing-safe, ignora grupo/status/fromMe, resolve tenant por instância, grava `outbox_events` com dedupe `evolution:instância:id` (L121-128). Formato de `messages.upsert` NÃO foi observado ao vivo (docstring L9-16). Testes só de provider/parse de QR; não há spec do webhook controller |
| Persistência + dedupe | REAL | `messages.service.ts:104-141`: `webhook_events ON CONFLICT DO NOTHING`, advisory lock por número, transação única. Testes `messages.service.spec.ts:158-208` (máscara, idempotência, não lidas, contact.created, tenant) |
| Outbound WhatsApp | REAL com guardas | `send` `messages.service.ts:45-87`: Idempotency-Key obrigatório, reserva antes de enviar, nunca retenta aceitação incerta, cancela se opt-out ou resposta durante run, `config_required` sem credencial. Testes `messages.service.spec.ts:95-146` |
| Status de entrega | PARCIAL | Só até `sent/failed/unknown/pending/...` (sem `delivered/read`: webhook ignora `messages.update`; só `connection.update` e `messages.upsert` tratados). A UI converte `sent` em `delivered` (✓✓) (`inbox/page.tsx:125`), o que é falso |
| Agrupamento por contato/canal | PARCIAL | 1 conversa por contato+WhatsApp (`messages.service.ts:123`). Canais Instagram/E-mail são só texto no cabeçalho (`inbox/page.tsx:154`) |
| Não lidas | PARCIAL | Incrementa no inbound (`messages.service.ts:127`); NUNCA zera: nenhum endpoint de "marcar como lida" (grep `naoLidas`); o badge fica para sempre. O realtime de envio manda `naoLidas:0` (`messages.service.ts:85`) mas o banco não zera |
| Atribuição de conversa | AUSENTE | `Conversation` sem owner/assignee; `status` existe sem endpoint |
| Busca | PARCIAL | Só ⌘K global (`crm.service.ts:478`); a tela de Inbox não tem busca nem filtros (filtros existem só no demo `/conversas`) |
| Anexos/mídia | AUSENTE | Parser só extrai texto (`evolution-webhook.controller.ts:45-50`); imagem/áudio/documento são descartados em silêncio (retorna `null` → `{ignored:true}`); `Message` sem campo de mídia; sem envio de anexo |
| Listagem | PARCIAL | `listConversations` carrega TODAS as conversas com TODAS as mensagens, sem paginação (`crm.service.ts:512-523`) e é rebuscada inteira a cada evento (`inbox/page.tsx:70`) |
| Tempo real: isolamento | REAL | Sala `tenant:<id>` pelo ticket assinado; 10 testes `events.gateway.spec.ts` (ticket forjado/expirado/access token, cliente não escolhe tenant) |
| Tempo real: inbound | VERIFICAR/PROVÁVEL FALHA | ver I-1 |
| Detecção de resposta | REAL | `entrada` seta `lastInboundAt`, cancela runs (`messages.service.ts:120-121`) e `TriggersService` acorda "Esperar resposta" (`triggers.service.ts:46-50`, `runs.service.ts:321`) |
| Opt-out | REAL | regex "stop/parar/sair…" marca `optedOutAt` e cancela todos os runs (`messages.service.ts:119-121`); falso positivo possível (ex.: "sair" no início de frase) |

### Cadeia de uma mensagem recebida (webhook → ... → follow-ups)

1. Webhook (`hooks/evolution/:token`) -> valida, resolve tenant, `outbox_events` (kind `evolution.inbound`, dedupe). REAL.
2. Worker `reconcile` (a cada 5s, varre todos os tenants sequencialmente, `operations.service.ts:21-36`) enfileira `event` -> `OperationsProcessor.event` -> `MessagesService.receiveInbound`. REAL, latência de até ~5s + fila.
3. Persistência: `webhook_events` dedupe + contato achado/criado + `lastInboundAt` + conversa + mensagem na mesma transação. REAL.
4. Inbox: leitura por `GET /crm/conversations` após evento socket. Evento socket PROVAVELMENTE NÃO chega (I-1).
5. Atualiza contato: só `lastInboundAt`/`ultimoContatoAt` apenas na criação (não atualiza `ultimoContatoAt` em contato existente, `messages.service.ts:120`). PARCIAL.
6. Atividade: NENHUMA `Activity` é gravada para mensagem recebida (nem na timeline do contato). AUSENTE.
7. Automação: trigger SQL em `messages` insere outbox `message.created` (`db/022:68-69`) -> `TriggersService` -> `gatilho.mensagem_recebida` (ignora `de!='contato'`). REAL.
8. Cancela follow-ups: dentro da transação (`workflowRun.updateMany`, só workflows com `pararNoReply`, ou todos se opt-out) e depois `avisarResposta`. REAL, duplicado e coberto parcialmente pelos testes de automação (`esperar-resposta.spec.ts`, `runs.service.spec.ts`).

### ISSUEs — Inbox

**ISSUE I-1: Evento realtime de mensagem recebida é emitido no processo worker, que não tem servidor de sockets**
SEVERITY: Alta (verificar em runtime)
ROOT CAUSE: `receiveInbound` roda em `OperationsProcessor` (somente `ORVYN_PROCESS_ROLE=worker`, `operations.module.ts:11`). O worker é `createApplicationContext` sem adapter WS (`worker.ts:9`); `EventsGateway.server` fica indefinido e `emitirParaTenant` retorna silenciosamente (`events.gateway.ts:70`). Não há `@socket.io/redis-emitter` (grep sem resultado). O adapter Redis só é ligado na API (`main.ts:33-35`).
FILES: `apps/api/src/realtime/events.gateway.ts:69-73`; `apps/api/src/events/domain-events.service.ts:44-48`; `apps/api/src/worker.ts`; `apps/api/src/crm/messaging/messages.service.ts:90-102`; `apps/web/app/(app)/inbox/page.tsx:97-109`
IMPACT: Com socket conectado a tela não faz polling (só faz se `conectado=false`), então mensagens recebidas só aparecem em reload. O indicador verde "Ao vivo" dá falsa segurança. Também vale para `contact.created`.
RECOMMENDED FIX: no worker usar `@socket.io/redis-emitter` (mesmo Redis do adapter) para publicar na sala do tenant; ou manter um polling leve de segurança no Inbox mesmo conectado.
ACCEPTANCE CRITERIA: teste de integração API+worker+Redis: mensagem entrando pelo webhook aparece no cliente socket do tenant em <3s, e não chega ao socket de outro tenant.

**ISSUE I-2: Não lidas nunca zera; sem atribuição, filtros, busca ou anexos**
SEVERITY: Alta
ROOT CAUSE: sem endpoint de leitura; `Conversation` sem assignee; parser descarta mídia.
FILES: `apps/api/src/crm/messaging/messages.service.ts:85,125-127`; `apps/api/src/crm/crm.controller.ts:121-132`; `apps/api/src/crm/messaging/evolution-webhook.controller.ts:45-50`; `apps/web/app/(app)/inbox/page.tsx:158-172`
IMPACT: Contador de não lidas inútil (e alimenta a lista de notificações, `settings.service.ts:152`); mídia recebida some sem aviso ao operador; sem fila por responsável.
RECOMMENDED FIX: `POST /crm/conversations/:id/read` ao abrir; coluna `assigneeId` + filtros (todas/não lidas/minhas) + busca; guardar tipo de mídia (ao menos placeholder "[imagem recebida]") e depois storage S3.
ACCEPTANCE CRITERIA: abrir a conversa zera `naoLidas` no banco e em outra aba; imagem recebida gera mensagem visível como anexo/placeholder; filtro "minhas" funciona.

**ISSUE I-3: Status de entrega exibido incorretamente (sent vira "entregue") e sem atualização por webhook**
SEVERITY: Média
ROOT CAUSE: UI mapeia `sent` -> `delivered`; `Tick` trata `undefined` como duplo check; `pending/unknown/cancelled/sem_telefone` caem em `sent`; webhook ignora `messages.update`.
FILES: `apps/web/app/(app)/inbox/page.tsx:14-19,125`; `apps/api/src/crm/messaging/evolution-webhook.controller.ts:94-100`; `apps/api/src/crm/crm.service.ts:520`
IMPACT: O operador acredita que a mensagem foi entregue quando só foi aceita pelo provedor (ou nem enviada: `unknown`, `cancelled`).
RECOMMENDED FIX: tratar `messages.update` (delivered/read) em `Message.deliveryStatus`; mapear cada status do backend 1:1 na UI com rótulos (enviada, entregue, lida, falhou, incerta, cancelada).
ACCEPTANCE CRITERIA: ✓ apenas para `sent`, ✓✓ só após `delivered`; status `unknown/cancelled` com aviso visível; teste do mapeamento.

**ISSUE I-4: Mensagem recebida não gera Activity nem atualiza `ultimoContatoAt`; listagem sem paginação; "digitando…" é cenografia**
SEVERITY: Média
ROOT CAUSE: `entrada` não escreve `Activity`; `listConversations` sem limite; a UI mostra "digitando" por 900ms para qualquer inbound (`inbox/page.tsx:89-91`), sem sinal real de presença.
FILES: `apps/api/src/crm/messaging/messages.service.ts:104-141`; `apps/api/src/crm/crm.service.ts:512-523`; `apps/web/app/(app)/inbox/page.tsx:89-91,186`
IMPACT: Timeline do contato e "última interação" não refletem conversa; custo cresce com o histórico (todas as mensagens de todas as conversas a cada evento); indicador falso.
RECOMMENDED FIX: gravar Activity ("recebeu mensagem") e atualizar `ultimoContatoAt` no inbound; paginar conversas e mensagens (cursor) e entregar mensagens só da conversa aberta; remover o falso "digitando".
ACCEPTANCE CRITERIA: inbound aparece na timeline e em "última interação"; endpoint de conversas responde em tempo constante com 10k mensagens.

**ISSUE I-5: `/conversas` real é vazio e Inbox tem texto/provider hardcoded**
SEVERITY: Baixa
ROOT CAUSE: `ConversasPage` renderiza `ConversasVazio` fora do demo (`conversas/page.tsx:40`); `/inbox` diz "WhatsApp (STEVO)" e fixa `provider:'stevo'` no gating (`inbox/page.tsx:129,154`) embora Evolution seja o provider prioritário.
FILES: `apps/web/app/(app)/conversas/page.tsx:40`; `apps/web/app/(app)/inbox/page.tsx:129,131,154`
IMPACT: Duas rotas para o mesmo conceito, uma morta; mensagens de configuração citam o provedor errado.
RECOMMENDED FIX: consolidar em uma rota; ler o provider ativo do backend.
ACCEPTANCE CRITERIA: uma única rota de conversas real; texto reflete o provider conectado.

## 4. Evidência de testes (estática, não executados)

- Cobrem: paginação/cursor e eventos realtime do CRM (`crm.service.spec.ts`), dedupe/idempotência de lead (`leads.service.spec.ts`), normalização de telefone (`telefone.spec.ts`), envio/recebimento/idempotência/isolamento (`messages.service.spec.ts`), isolamento do gateway (`events.gateway.spec.ts`), score (`lead-score.spec.ts`), QR/conexão (`whatsapp-connection.service.spec.ts`, `evolution.provider.spec.ts`).
- NÃO cobrem: webhook Evolution (`parseEvolutionMessage`, token), `moveDeal`/`createPipeline`/`createStage`, `updateDeal` status, entrega worker->socket, fluxo completo webhook->outbox->worker, qualquer componente web (rollback do DnD, Inbox), importação (inexistente).

## 5. Prioridade sugerida

1. I-1 (realtime do inbound) e I-2 (não lidas/mídia).
2. L-1/L-3 (dedupe e origem) antes de L-2 (import).
3. K-1 (CRUD de funil/oportunidade/ganho-perda), depois K-3/K-4.
4. I-3, I-4, K-2, K-5, L-4, I-5.

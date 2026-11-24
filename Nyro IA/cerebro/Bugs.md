# Bugs — KHUB

> Reprodução, severidade, status. Alimenta a triagem da sprint ([[Sprint]]). Toda correção: causa raiz + verificar se existe em outros pontos + teste de regressão.

Severidade: `S0` catastrófico (ex.: vazamento entre tenants) · `S1` crítico · `S2` maior · `S3` menor.
Status: `aberto` · `em correção` · `corrigido` · `não reproduz`.

---

## Abertos

### BUG-051 — Nó "Ativar IA na conversa" não mostrava os agentes da conta (S2) — corrigido 2026-11-24
- **Reprodução:** editor de automações › Ativar IA na conversa › Agente: só aparecia "Agente padrão do canal". A Ritinha (pausada, não padrão) sumia da lista.
- **Causa raiz:** o painel filtrava `status === 'ativo'` antes de listar. Com o único agente pausado, a lista ficava vazia e o fluxo falhava em produção sem aviso (o backend exige agente ativo, e o "padrão" exige um agente padrão ativo).
- **Correção:** `PainelNoMotor.tsx` lista todos os agentes não arquivados com status e marca de padrão; o "padrão" mostra qual agente é hoje (ou "nenhum ativo"); aviso vermelho quando o escolhido está pausado, sem versão ativa ou sem WhatsApp, com link para o agente.

### BUG-052 — Aviso "o fluxo precisa de pelo menos um gatilho" ficava na tela com o gatilho já no canvas (S3) — corrigido 2026-11-24
- **Causa raiz:** os avisos gerais da última validação ficavam guardados até a próxima validação.
- **Correção:** a página do editor esconde na hora os avisos gerais que o canvas já resolveu (tem gatilho / tem passo).

### BUG-050 — Ritinha marcava em cima de horário já ocupado no Avec (S1) — corrigido 2026-11-19 (ADR-0052, db/077)
- **Reprodução (17/11, 14:12–19:07):** a IA fez 21 reservas pelo WhatsApp; conferidas contra a agenda AO VIVO do Avec em 19/11: 15 caíam em cima de atendimento ou bloqueio, 2 eram de clientes que já tinham horário em outro momento no Avec, 3 estavam livres mas não foram lançadas no Avec e 1 a equipe já tinha lançado.
- **Causa raiz:** a IA só enxergava a agenda do KHUB, uma cópia da exportação do Avec de 14/11 e 18/11. A equipe continuou marcando no Avec (é o sistema do salão), então o KHUB não via nada novo. O expediente era deduzido do histórico, e bloqueios e folgas do Avec não existiam no KHUB.
- **Correção:** sync do Avec (ADR-0052): a cada 10 min mais leitura ao vivo antes de oferecer e de reservar. Avec fora do ar → não reserva. Jornada real por dia. A IA não duplica um serviço que a cliente já tem marcado e não remarca nem cancela atendimento do Avec.
- **Testes:** `cognito-srp.spec.ts` (vetor da AWS) e `avec-agenda.spec.ts` (mapeamento, chave, plano do dia: criar, atualizar, cancelar, adotar, conflito). QA com o Avec real (somente leitura): 14 dias em 8,5 s, 412 linhas, segunda rodada com 0 mudanças, cópia antiga adotada sem duplicar, reserva da IA em horário do Avec recusada.
- **Pendente:** escrever no Avec (a reserva da IA ainda depende de a equipe lançar no Avec) só depois de um canário autorizado.

### BUG-049 — Travas de agenda da IA só conheciam as ferramentas da clínica (S1 para o salão) — corrigido e no ar 2026-11-17 (d997bd6)
- **Causa:** `semAgendamentoInventado` e `semDisponibilidadeInventada` só consideravam `solicitar_agendamento` e `ver_agendamentos`. A Ritinha usa as ferramentas do salão (`reservar_horario_salao`, `ver_horarios_salao`). Com isso, a confirmação de uma reserva real ("Prontinho! Reservei…") podia ser apagada como inventada, e uma oferta de horário real ("temos horário amanhã às 14h") podia ser removida.
- **Correção:**
  - As listas `FERRAMENTAS_QUE_AGENDAM` e `FERRAMENTAS_QUE_CONSULTAM_AGENDA` cobrem clínica e salão.
  - **Travas novas:**
    - **preço:** um valor em reais só sai na resposta se tiver fonte (instruções, base, ferramentas do turno ou o que a empresa já disse). Soma de dois valores e sinal de 50% passam.
    - **desconto/promoção:** não é oferecido sem estar cadastrado.
    - **dia fechado:** dia sem faixa no horário do agente, ou feriado, bloqueia a consulta e a reserva no salão (segunda-feira do Studio).
  - Testes em `engines.spec.ts` e `agenda-salao.spec.ts`.

### BUG-048 — Instruções do agente acima de 8 mil caracteres davam HTTP 500 (S2) — corrigido 2026-11-17 (db/076)
- **Causa:** a API passou a aceitar 20 mil caracteres (8db177c), mas o CHECK `agents_instrucoes_chk` da db/030 continuou em 8 mil.
- **Correção:** `db/076_agents_instrucoes_20k.sql`, aplicada no QA e no Neon.

### BUG-041 — Webhook do WhatsApp (Stevo) com HTTP 500 em reentrega simultânea (S1) — corrigido na árvore 2026-11-16, aguarda deploy
- **Como apareceu:** auditoria dos logs do Render. Em 15/11, às 17:45 UTC, `POST /v1/webhooks/stevo-api` respondeu 500 com `Unique constraint failed` em `outboxEvent.upsert`.
- **Causa raiz:** o `upsert` do Prisma faz SELECT e depois INSERT, sem atomicidade. Duas entregas do mesmo evento ao mesmo tempo (a Stevo reenvia quando a primeira demora) passam pelo SELECT, e a segunda estoura a unique `(tenant_id, dedupe_key)`. Reproduzido no QA com 20 entregas simultâneas: **19 falhas de 20**.
- **Existe em outros pontos?** Sim, em todos os pontos de entrada que gravam no outbox: Evolution, Stevo legado, Meta Lead Ads e webhooks de automação (com e sem Idempotency-Key).
- **Correção:**
  - `common/outbox.ts` (`registrarNoOutbox`) faz `INSERT … ON CONFLICT (tenant_id, dedupe_key) DO NOTHING RETURNING` e relê a linha. A reentrega é reconhecida, responde 2xx e não processa de novo.
  - Aplicado nos 6 pontos de entrada.
  - Teste de concorrência no Postgres do QA: **0 falhas de 20, 1 inserção, mesmo id para todas**.
  - Specs atualizados (`outbox.fake.ts`).

### BUG-042 — Conectar WhatsApp: erro 502 da Stevo virava HTTP 500 "erro interno" (S2) — corrigido na árvore 2026-11-16
- **Como apareceu:** em 16/11, às 11:43 UTC, `POST /v1/integrations/whatsapp/connect` deu duas vezes `stevo_api_502_upstream_error` (QR code) e a API respondeu 500.
- **Correção:**
  - O `ProblemDetailsFilter` reconhece `StevoApiError` e responde **502** (falha ou recusa do provedor) ou **503** (limite atingido), com `code` `stevo_<código>`, `provider`, `retryable` e `Retry-After`.
  - O título explica: "O provedor do WhatsApp (Stevo) está instável agora. Tente de novo em alguns segundos." O canal não é marcado como desconectado.
  - 2 testes novos no spec do filtro.

### BUG-043 — Varredura de lembretes: falha sem causa no log (S3) — corrigido na árvore 2026-11-16
- **Como apareceu:** em 15/11, às 14:39 UTC, o log registrou "varredura de lembretes falhou (tenant Studio)".
- **Causa raiz:** o `.catch(() => …)` descartava o erro, então a causa não pode ser recuperada.
- **Impacto verificado no Neon:**
  - **0 lembretes perdidos.** A varredura é um UPDATE atômico: na falha nada é marcado, e ela roda de novo 1 minuto depois.
  - 5 lembretes foram marcados desde 15/11, e todos os `reminder_due` estão `processed`.
  - 0 lembretes pendentes na janela.
- **Correção:** o log passa a trazer a mensagem do erro.

### BUG-044 — Lead da Meta: dedupe sem tenant e corrida no registro (S3) — corrigido na árvore 2026-11-16
- **Contexto:** `webhook_events` tem a unique global `(provider, event_id)`. Todas as entradas já prefixam o `event_id` com o tenant (`<tenant>:<id>`), exceto o Meta Lead Ads, que usava o `leadgenId` puro e fazia `findFirst` seguido de `create`, com a mesma corrida do BUG-041.
- **Correção:**
  - A chave passa a ser `<tenant>:<leadgenId>`, e a chave antiga continua reconhecida.
  - O INSERT passa a ser atômico com `ON CONFLICT DO NOTHING`.
  - Sem migração: a unique composta `(tenant_id, provider, event_id)` deixa de ser necessária enquanto a convenção do prefixo valer.

### BUG-045 — Agente afirmava haver (ou não haver) horário sem consultar a agenda (S1 para o atendimento) — guarda no código 2026-11-16 (complementa o BUG-039)
- **Correção:** o validador pós-resposta `semDisponibilidadeInventada` remove a frase que afirma vaga ("temos horário amanhã às 14h") ou falta de vaga ("agenda lotada", "não temos horário") quando `ver_agendamentos` não rodou com sucesso no turno. No lugar, pede a preferência do contato.
- Vale para qualquer agente, inclusive os que nem têm a ferramenta (a Ritinha v2).
- 15 testes novos em `engines.spec.ts`.

### BUG-046 — "Resumo financeiro" da NICO/MCP dizia recebido = 0 com 45 mil lançamentos no caixa (S2) — corrigido na árvore 2026-11-16
- **Causa raiz:** a ferramenta somava só `financeiro_cobrancas` (cobranças emitidas pelo KHUB). O histórico importado do Avec mora em `financeiro_transacoes` (livro-caixa).
- **Correção:** `resumo_financeiro` devolve as duas fontes separadas e rotuladas:
  - `caixa`: mês atual e anterior, a receber e a pagar, categorias, e a contagem de lançamentos com data futura.
  - `cobrancas`
  - Teste E2E com MCP (40/40).
- **Nota (não é bug):** o status `cancelled` em "Enviar mensagem" de automação é proposital. O contato respondeu depois do início do fluxo (ou optou por sair), e o follow-up não é enviado. Agora o motivo fica gravado (`contato_respondeu_depois_do_inicio` ou `contato_optou_por_sair`) na mensagem e na saída do passo.

### BUG-040 — Passo de automação descartado quando o passo anterior ainda segurava o lease (S2) — corrigido na árvore 2026-11-16, aguarda deploy
- **Como apareceu:** teste E2E em produção (16/11). O teste do rascunho "Novo Lead 🚀 (importado do GHL v14)" parou duas vezes em `identificar`, logo depois do "Esperar" pulado (`attempts=0`, sem lease, sem passo registrado). Um terceiro teste, de 13/11, estava parado do mesmo jeito em `aguarda_origem`. No fluxo ativo, cada passo encadeado saía cerca de 5–7 s atrasado: no teste real, a oportunidade foi criada 7 s depois das boas-vindas.
- **Causa raiz:** `RunsService.executarPasso` enfileira o próximo passo ANTES do `finally` de `processarPasso` soltar o lease. Com `concurrency: 8`, o worker pega o job novo nesse intervalo, e o claim é recusado pelo lease alheio. `jobAdiantado` só reagendava quando `scheduledAt` estava no futuro; caso contrário, devolvia `{}` e o job sumia. O fluxo ativo só andava quando o `reconcile` (a cada 5 s) reenfileirava. O teste de rascunho não entra no reconcile (`workflow.status='ativo'`), então parava para sempre.
- **Correção:**
  - `jobAdiantado` reagenda em `LEASE_OCUPADO_RETRY_MS` (1 s) quando o lease está ocupado.
  - O `reconcile` também recupera run de teste iniciado na última hora (`TESTE_RECONCILE_MS`).
  - Specs: 2 novos casos em `motor-q3.spec.ts`. A suíte completa passa (1475 testes).
- **Pendente:** deploy da API e repetir o teste do v14 em modo teste.

### BUG-039 — Ritinha dizia "não tenho horário livre" com a agenda do salão livre (S1 para o atendimento) — mitigado 2026-11-16
- **Como apareceu:** teste E2E em produção ("Tem horário na terça à tarde?" → "infelizmente na terça não tenho nenhum horário livre").
- **Causa raiz:** a agenda do Studio tem 20.890 compromissos importados (até 14/11), todos com `responsavel_id` nulo. `slotsDoDia` calcula como se o salão fosse um único recurso (`responsaveis: []`), então qualquer compromisso bloqueia o horário para todas as profissionais. A agenda também não sincroniza com o sistema do salão depois da importação.
- **Mitigação (sem código):** a Ritinha v2 perdeu `ver_agendamentos` e `solicitar_agendamento`. Ela agenda como a IA do GHL fazia: tag "serviço escolhido" + "nossa equipe vai verificar os horários…" + `transferir_para_humano`. A tag dispara a Notificação Interna para a equipe. A versão anterior está guardada em `apps/api/scripts/operar/ritinha-instrucoes-antes-2026-11-16.txt`.
- **Aberto:** para a IA voltar a agendar sozinha, a agenda precisa de profissional por compromisso e de sincronização com o sistema do salão.

### BUG-038 — Produção (Neon) sem 7 CHECKs do financeiro: lançamento de valor zero aceito (S2) — corrigido 2026-11-14
- **Como apareceu:** no deploy de 14/11, o teste de isolamento da 070 falhou no Neon ("FALHA[valor]: lançamento de valor zero aceito"); no QA passava.
- **Causa raiz:** as tabelas do financeiro nasceram no Neon de uma versão ANTERIOR da 070. A 070 atual usa `CREATE TABLE IF NOT EXISTS`; reaplicada, não recria os CHECKs inline. Diff Neon × QA: `valor_centavos >= 0` (devia ser `> 0`) e faltavam 6 CHECKs (descrição, nome da categoria, cargo, competência no dia 1, comissão paga ⇔ pago_em, valor ≤ base, percentual 0–100). Colunas idênticas.
- **Correção:** `db/070b_financeiro_checks.sql` (aditiva, idempotente, no-op onde já está certo). Aplicada no Neon (tabelas vazias: nada recusado) e no QA; testes de isolamento 070 e 071 OK no Neon.
- **Lição:** migração reaplicável com `CREATE TABLE IF NOT EXISTS` não corrige CHECK inline: mudança de regra em tabela existente precisa de `ALTER TABLE` próprio (ou arquivo `0NNb`). Antes de deploy, comparar `pg_constraint` do Neon com o QA.

### BUG-036 — Horários das conversas errados (lista e mensagens) (S2) — corrigido na árvore 2026-11-13, aguarda deploy
- **Reprodução (produção, Studio da Beleza):** em Conversas, a hora da lista e das bolhas não batia com a hora real da mensagem; conversas antigas mostravam "HH:MM" em vez de "Ontem"/data.
- **Causa raiz:** a tela exibia o TEXTO `hora`/`ultimaHora`, gravado pelo servidor no fuso do processo (UTC no Render: 3 h adiantado) e congelado; a lista nunca usava a data. Segunda causa: a ingestão de Instagram/Messenger/YouTube gravava `created_at` = hora em que o KHUB recebeu, ignorando a hora real que a rede informa (`recebidoEm`): comentário antigo do YouTube aparecia com a hora da sincronização.
- **Correção:** `lib/hora-conversa.ts` (lista e bolhas a partir do instante ISO, no fuso do navegador; lista no padrão WhatsApp: hora/Ontem/dia da semana/data) + API devolvendo `criadaEm`/`ultimaMensagemEm` + `horaCurta` com fuso de São Paulo (feito por outra sessão, 2026-11-13). Nesta sessão: `canais-ingestao.service.ts` grava `createdAt = recebidoEm` (futuro cai para agora); `?canal=` em Conversas.
- **Teste:** `hora-conversa.test.ts` (3), regressão em `canais.spec.ts` ("hora REAL da rede"), QA visual: mensagem de 35 min atrás = "13:16" e de ontem = "Ontem" no fuso America/Sao_Paulo.
- **Pendente:** o print do usuário é da produção, que roda o snapshot anterior. Corrige ao publicar a árvore atual.

### BUG-037 — QA: `INTEGRATIONS_ENCRYPTION_KEY` do `.env.qa` em hex (64 chars), o serviço exige base64 de 32 bytes (S3) — aberto
- **Efeito:** no QA, qualquer integração que cifra credencial (canais, redes, Meta Ads) quebra ao conectar/ler ("deve ter 32 bytes (base64)").
- **Contorno usado em 2026-11-13:** chave base64 nova só no processo da API de QA (arquivo no scratchpad da sessão).
- **Correção sugerida:** gerar `openssl rand -base64 32` e trocar no `.env.qa` (dado de QA cifrado com a chave antiga deixa de abrir; é QA).

### BUG-035 — Rotas de origem/foto 404: controller importado mas não registrado no módulo (S2) — corrigido 2026-11-13
- **Reprodução:** com a 066 no ar, `GET /v1/crm/contacts/:id/origem`, `/foto` e `/crm/atribuicao/*` respondiam 404 em runtime, com tsc e jest verdes.
- **Causa raiz:** `OrigemFotoController` estava importado no `crm.module.ts` mas fora do array `controllers` — o Nest só registra o que está no array; o typecheck não reclama porque o import era "usado".
- **Correção:** controller no array; regressão E2E `apps/api/scripts/qa/e2e-origem-foto.mjs` (20/20), que exercita as rotas contra API real.
- **Lição:** import de controller sem registro passa em tsc e em todo teste unitário — só E2E contra a API de verdade pega. Na mesma leva: o campo `origem` ficava "WhatsApp" mesmo com anúncio confirmado; a regra `origemAtualizada` (atribuicao.ts) promove placeholder de canal e preserva origem específica (teste unitário no `atribuicao.spec.ts`).

### BUG-030 — Vault interno visível para clientes (S1) — corrigido 2026-11-10
- **Reprodução:** qualquer usuário logado de qualquer subconta abria `/conhecimento` ou `GET /api/cerebro` e lia PRD, Bugs, Arquitetura e revisões de segurança; a imagem de produção copiava o vault inteiro.
- **Causa:** `lib/cerebro.ts` listava todo o diretório; o Dockerfile do web copiava `Nyro IA/cerebro` inteiro.
- **Correção:** fora de dev só `RAG/conhecimento/**` é listado/lido (`slugVisivel`, flag `KHUB_VAULT_INTERNO`); o Dockerfile copia só essa subpasta. Regressão: `apps/web/lib/cerebro.test.ts`.

### BUG-029 — Gatilho "Contato criado" com filtro de origem nunca disparava (S1) — corrigido 2026-11-10
- **Reprodução:** fluxo com gatilho `contato_criado` filtrado por origem (ex.: "MetaAds" do Studio da Beleza) nunca abria run.
- **Causa:** a função de outbox lia `campos_custom->>'origem'`; o cadastro manual grava a coluna `contacts.origem` e o lead de anúncio grava `campos_custom.lead_origem`. O filtro sempre via "Manual".
- **Correção:** `db/050` (função de outbox com `COALESCE(origem, lead_origem, origem, 'Manual')`), `leads.service` e `createContact` gravam a coluna, filtro normalizado ("Meta Ads" = "metaads"). Regressão: `triggers.service.spec`, `contato-origem.spec`, `db/050_automation_isolation_test.sql`.

### BUG-031 — Condição sem ramo casado seguia o primeiro ramo (S2) — corrigido 2026-11-10
- **Causa e correção:** o executor caía na aresta do primeiro ramo quando nenhum casava; agora o run encerra. Teste em `executor`/`workflows.service.spec`.

### BUG-032 — Links `?aba=` de Configurações caíam na aba padrão (S3) — corrigido 2026-11-10
- **Causa e correção:** seis links usavam `?aba=`; a página lia só `?tab=`. Agora aceita os dois, com apelido `ia → integracoes`.

### BUG-028 — Webhooks de WhatsApp morriam no body parser (Inbox nunca carregava)
- Severidade: **S1** (mensageria real quebrada em produção-local: mensagem recebida não virava conversa)
- Status: **corrigido** (2026-11-09)
- Reprodução: conectar WhatsApp (Stevo/Evolution) numa subconta → mensagens chegam → `POST /v1/webhooks/stevo-api` → 500 `PayloadTooLargeError` → Inbox vazio.
- Causa raiz (duas camadas):
  1. Payloads com mídia em base64 (~170 kb) estouram o default de 100 kb do Express.
  2. O parser global do Nest (json 100 kb) é registrado ANTES dos `app.use` do `main.ts` — a exceção por rota nunca rodava para webhooks. Além disso, parte dos webhooks chega como `form-urlencoded` e caía no parser urlencoded (também 100 kb).
- Correção (`apps/api/src/main.ts`): `bodyParser: false` e parsing 100% manual, na ordem — webhooks `/v1/(webhooks|hooks)/*` com `json({limit:'100mb'})` → upload de conhecimento (22 mb) → resto da API com defaults; TODOS com `verify` capturando `rawBody` (Meta HMAC e Stripe dependem do corpo cru; `rawBody:true` do Nest foi removido junto).
- Regressão/verificação: 74/74 testes de messaging; mensagens reais da Dra. Bárbara entrando (6 → 10) e outbox processando (4534 processed, 0 stevo pendente) logo após a correção.
- Lição: teste de webhook com payload pequeno não pega isso — falta teste de integração com body >100 kb no webhook da Stevo.

### BUG-027 — Sync de Ads morria por timeout de transação (Meta conectada, zero dados)
- Severidade: S1 (integração conectava, sync sempre falhava, `/marketing/ads` vazio)
- Status: **corrigido** (2026-11-09)
- Reprodução: conectar Meta Ads → `handleCallback` enfileira `ads-sync` → run falha com `Transaction API error: Transaction already closed: ... timeout ... 5000 ms`; integração fica `health=down`, `ad_accounts/ad_campaigns/ad_insights` vazios.
- Causa raiz: `AdsSyncService.run` fazia as chamadas à Graph API (listAdAccounts/syncCampaigns/syncCreatives/syncInsights) DENTRO de uma transação interativa do Prisma (timeout padrão 5s). A rede estourava o teto → transação expirava → primeira escrita (`adAccount.upsert`) quebrava.
- Correção: rede fora da transação (busca tudo do provider primeiro, `Promise.all` por conta); a transação fica só com as escritas, com `{ timeout: 30_000 }` via novo param opcional `options` em `PrismaService.withTenant`.
- Regressão/verificação: `npx jest src/integrations` (31/31) + sync real enfileirado no worker: `success`, 239 registros (8 contas, 10 campanhas, 398 insights), `health=ok`, `last_sync_at` preenchido.
- Existe em outros pontos?: padrão "rede dentro de withTenant" merece varredura nos demais services que chamam provider externo.

### BUG-001 — `retrieval.service.ts`: `tenant_id` interpolado em string no `SET LOCAL` (risco de SQL injection)
- Severidade: S1 (S0 se `tenantId` puder vir de fonte não confiável)
- Status: **corrigido** (R1.4). O `RetrievalService` implementado usa `PrismaService.withTenant` (UUID validado + `set_config(...,$1,...)` parametrizado); o padrão vulnerável do arquivo de referência não foi para o código. Regressão coberta por `retrieval.service.spec.ts` (tenant sempre da sessão).
- Ambiente: código de referência fornecido (ainda não wired)
- Reprodução: `tx.$executeRawUnsafe(\`SET LOCAL app.current_tenant_id = '${ctx.tenantId}'\`)` — interpolação direta. Idem `SET LOCAL hnsw.ef_search` (constante, ok) e `EmbeddingsService.toSqlVector`.
- Esperado: `tenantId` validado como UUID **antes** de qualquer uso; preferir `set_config('app.current_tenant_id', $1, true)` parametrizado em vez de interpolar. Vetor: garantir que só contém números/`,`/`.`/`-`/`e`.
- Causa raiz: uso de `$executeRawUnsafe`/`$queryRawUnsafe` com template string.
- Existe em outros pontos?: `logQuery` usa `$executeRawUnsafe` mas com parâmetros posicionais (`$1..$7`) — ok. O ponto crítico é o `SET LOCAL` e o literal de vetor.
- Correção + teste de regressão: validar UUID (zod/regex) na borda; teste unitário com `tenantId` malicioso deve lançar antes de tocar o banco.
- **Padrão correto já implementado** em `apps/api/src/prisma/prisma.service.ts` (`withTenant`): valida UUID por regex e usa `set_config('app.current_tenant_id', $1, true)` **parametrizado**. Ao integrar o `retrieval.service.ts` fornecido em R1.4, substituir o `SET LOCAL ... '${tenantId}'` por este helper.

### BUG-007 — `rag_search_hybrid` nunca resolvia via API (42883: function does not exist)
- Severidade: **S1** (a busca do RAG estava quebrada em produção-real, embora "verde" nos testes)
- Status: **corrigido** (Sprint G)
- Reprodução: `POST /v1/rag/search` → 500 `Raw query failed. Code: 42883 — function rag_search_hybrid(vector, text, text, unknown, text[], bigint, bigint, bigint) does not exist`.
- **Causa raiz:** o driver do Prisma envia números JS como **bigint (int8)** e `null` como **unknown**; a função é `(vector, text, text, text, text[], int, int, int)`. O Postgres **não faz downcast** na resolução de função → nenhuma assinatura casa.
- **Por que passou despercebido:** os unit tests mockam o Prisma (nunca tocam o Postgres) e o SQL foi validado direto no `psql` (onde os literais já vêm com o tipo certo). O bug só aparece na junção dos dois.
- Correção: casts explícitos no `$queryRawUnsafe` (`$1::vector, $4::text, $6::int…`) em `retrieval.service.ts`.
- Regressão: teste `BUG-007: SQL leva casts explícitos` em `retrieval.service.spec.ts`.
- **Lição:** unit test com Prisma mockado não prova integração — vale um teste de integração real do retrieval (pendente).

### BUG-008 — Voyage: chave sem método de pagamento → 3 RPM / 10K TPM
- Severidade: S2 (operacional)
- Status: aberto — **ação do operador**
- Sintoma: buscas seguidas retornam `Voyage 429: "You have not yet added your payment method… reduced rate limits of 3 RPM and 10K TPM"`.
- Impacto: backfill (1 request) passou; a busca ao vivo estoura se houver >3 queries novas/min. O cache (TTL 1h) e o fallback BM25 amortecem, mas produção exige billing na Voyage.

### BUG-003 — Inbox: botão de enviar sob o FAB da Nyro (z-index) e Enter não envia
- Severidade: S2 (usabilidade)
- Status: **corrigido** (ADR-0028) — o composer usa `<form onSubmit>` + input (Enter envia) e `pr-20` reserva a faixa do FAB da Nyro, sem sobreposição.
- Origem: QA do usuário. O `NyroDock` (FAB, `fixed bottom-5 right-5 z-40`) cobre o botão de enviar do `/inbox`. Além disso o envio não está implementado (Enter/click não disparam) — é fachada até `POST /v1/messages`.
- Correção: (a) quick-fix de layout — subir o input de envio / reposicionar o FAB ou reduzir z-index quando no inbox; (b) implementar envio real (FASE 3). Sugestão da Nyro é estática (mesmo texto p/ toda conversa) — ligar na IA (FASE 5).

### BUG-017 — Nyro mandava `temperature` para `claude-sonnet-5`, que recusa amostragem (400)
- Severidade: S2 · Status: **corrigido** (adaptador Anthropic, 2026-11-06)
- Causa raiz: o adaptador sempre enviava `temperature: 0.3`; modelos 5.x e Opus 4.7/4.8 recusam parâmetros de amostragem (referência `claude-api`).
- Correção: `aceitaTemperatura(modelo)` — só envia para modelos que aceitam; profundidade via `effort`. Não validado contra a API real (sem chamada paga nesta sessão).

### BUG-018 — Seed de demo gravava grafos que o motor não executa (`ramos is not iterable` e follow-ups que paravam em silêncio)
- Severidade: S2 · Status: **corrigido no código**; dados já semeados no banco de dev seguem com o formato antigo (re-seed corrige).
- Reprodução: worker em 2026-11-06 — "Hot Opportunity" com 93 runs falhados; `seed-content-demo-run.mjs` usava `condicoes` e arestas `condicao: 'verdadeiro'|'respondeu'|'nao_respondeu'`, mas o motor usa `ramos` e arestas por `ramo` (`resposta`/`timeout`).
- Causa raiz: o seed grava direto no banco, sem a validação do `WorkflowsService`.
- Correção: executor valida a config do nó contra o catálogo e falha com `UnrecoverableError` legível (sem retry); seed reescrito no formato atual. Regressão em `executor.service.spec.ts`.

### BUG-019 — Fora de produção, envio ia para o telefone real do contato
- Severidade: S1 latente · Status: **corrigido** (doc 18, B-3)
- Causa raiz: destino `STEVO_TEST_NUMBER || telefone`; a variável não existia no `.env`.
- Correção: sem `STEVO_TEST_NUMBER` a mensagem é gravada como `bloqueado_dev` e nada sai; com ela, sai só para o número de teste. 2 testes de regressão.

### BUG-020 — `/api/cerebro` servia o vault interno sem sessão; token de webhook ia para logs/Sentry
- Severidade: S2 · Status: **corrigido**
- Correção: rotas exigem sessão validada na API (5 testes); `urlSegura()` redige `/hooks/:chave`, `/hooks/evolution/:token` e `?token=` em log, Sentry e corpo de erro (5 testes). Pendente (produto): `/conhecimento` e ⌘K ainda mostram o vault da KHUB a qualquer usuário logado — trocar pela base RAG do tenant.

### BUG-023 — Conversas e Agenda vazias no modo real (dados existiam)
- Severidade: S1 · Status: **corrigido** (ADR-0039)
- Reprodução: menu Conversas e Agenda fora do modo demo → sempre o estado vazio, com 405 conversas importadas / compromissos no banco. O inbox real existia em `/inbox`, fora do menu.

### BUG-024 — KPIs do funil errados (fechados contados como abertos; funis misturados)
- Severidade: S1 · Status: **corrigido** (ADR-0039, `crm/funil.ts` + 6 testes)
- Reprodução: tenant com negócios ganhos/perdidos ou com 2 funis → "Negócios abertos" = total, "Valor em pipeline" soma perdidos, Kanban mistura etapas dos dois funis, conversão = última etapa / total.

### BUG-025 — Lista de conversas carregava todas as mensagens a cada evento; não lidas nunca zeravam
- Severidade: S2 · Status: **corrigido** (ADR-0039)
- Reprodução: 405 conversas / 6.572 mensagens → payload de megabytes a cada mensagem nova ou a cada 5 s sem socket; abrir a conversa não baixava o contador.

### BUG-026 — "Esperar resposta": resposta não chegava à condição; trava cancelava boas-vindas; resposta rápida se perdia; 2ª mensagem sobrescrevia a 1ª
- Severidade: S1 (qualquer fluxo com "Esperar resposta" quebrava; o "Novo Lead" do GHL inviável) · Status: **corrigido** (importação GHL, 4 testes novos)
- Reprodução: (1) a resposta acordava o run mas o TEXTO não entrava no contexto — a condição "resposta contém Google" caía sempre no ramo errado; (2) a trava "contato respondeu, cancela o envio" comparava com o início do run, então as boas-vindas pós-resposta eram canceladas; (3) resposta que chegava nos ms entre a mensagem anterior e a marca da espera se perdia e o follow-up ia para quem JÁ tinha respondido; (4) duas mensagens rápidas ("Vi no Instagram" + "Quero progressiva"): a 2ª sobrescrevia `mensagem` antes da condição ler a 1ª. Achado no teste ponta a ponta da automação importada.
- Correção: `avisarResposta` leva o texto da resposta ao contexto e marca `baseResposta` (a trava passa a contar dali); 1ª passada do "Esperar resposta" reconhece resposta antecipada por `lastInboundAt >= baseResposta` e carrega o texto; run já acordado (`respondeu` ainda não consumido) não é sobrescrito por mensagem nova.

### BUG-022 — Base de conhecimento de cliente nunca indexava (RLS)
- Severidade: S1 (IA sem base própria) · Status: **corrigido** (db/033)
- Reprodução: `POST /v1/rag/documents` de qualquer tenant → documento não gravava (`rag_documents_write` exige `app.current_tenant_id`, o serviço gravava fora do `withTenant`); e mesmo com documento, todo chunk falhava com 42501 — `rag_chunks` só tinha policy de LEITURA. Achado na importação do GHL (0 documentos de tenant existiam no banco).
- Correção: `IngestionService` grava base de tenant em `withTenant`; a fila leva o `tenantId` e o `IngestionProcessor` lê/grava/publica sob a RLS dele; db/033 cria `rag_chunks_write` (espelha a de documentos + exige documento do MESMO tenant); documento `failed` com o mesmo conteúdo volta para a fila em vez de ficar preso. 4 testes novos (31 no RAG) + bloco 18 no teste de isolamento (escrita em B, na global e em documento de B barradas).

### BUG-021 — Teste intermitente "espera de 1 dia vira delay na fila"
- Severidade: S3 · Status: aberto
- Reprodução: falhou 1 vez em 3 na suíte completa; passa isolado. Provável cálculo de `delay` a partir do relógio (diferença de ms sob carga).

### BUG-015 — Overlay dos modais cobria só o `<main>` e os sheets de vidro não desfocavam
- Severidade: S3
- Status: **corrigido** (ADR-0029)
- Ambiente: local
- Reprodução: abrir "Novo contato" em `/contatos`: o escurecimento não cobria sidebar/topbar e deixava uma faixa de 20px no topo; o texto atrás do sheet ficava nítido.
- Causa raiz: o `PageTransition` (framer-motion) deixava `filter: blur(0px)` inline no wrapper da página — `filter` cria containing block para `position: fixed` e backdrop root. A faixa vinha do `space-y-5` do container injetando `margin-top` no overlay.
- Existe em outros pontos?: todos os modais renderizados dentro de páginas (contatos, empresas, tarefas, automações, agência, marketing, DealDrawer).
- Correção + teste de regressão: `transitionEnd: { filter: 'none', transform: 'none' }` em `pageVariants`; `.lg-backdrop { margin: 0 !important }`. Verificado no Chromium headless: overlay em `0,0,1440×900`.

### BUG-016 — Menu do builder de automações sem fundo
- Severidade: S3
- Status: **corrigido** (ADR-0029)
- Reprodução: `/automacoes/:id` → clicar na logo da ilha: o popup aparecia transparente sobre o canvas.
- Causa raiz: usava `.frost`, neutralizada (classe vazia) na migração para o design flat.
- Correção: `.frost` virou alias de `.lg-popover`.

### BUG-013 — Cristal quebrou o posicionamento de todo componente `.glass` (chat da Nyro fora da tela)
- Severidade: S2 (UI inutilizável em componentes-chave)
- Status: **corrigido** (F, 2026-07-17)
- Reprodução: abrir o chat da Nyro → o painel some (fica em `x = -20`, fora da tela). Mesmo efeito no menu do canto superior direito.
- Causa: a identidade de cristal deu `position: relative` a `.glass` (para a aresta refratada `::before`). O `globals.css` vem **depois** das utilities do Tailwind e, com a mesma especificidade, `relative` **venceu** o `fixed`/`absolute` de quem escreve `glass fixed`. O painel virou `relative` e escorregou para fora do viewport.
- Correção: mover o `position: relative` de `.glass`/`.crystal-edge` para dentro de `@layer components`. Na cascade de layers, **utility sempre vence component** — que é o que `glass fixed` deveria significar desde o começo.
- Lição: introduzir uma regra de `position` numa classe de "aparência" (glass/card) é armadilha — ela colide com o posicionamento de quem usa a classe. Regra estrutural em classe base vai para `@layer components`.

### BUG-014 — RLS não protegia as partições de `ad_insights` (vazamento cross-tenant)
- Severidade: **S1 — incidente de isolamento** (não explorado via API, mas a 1ª camada estava furada)
- Status: **corrigido** (Fase 0, 2026-07-18)
- Reprodução: como `khub_app`, **sem** `app.current_tenant_id`: `SELECT count(*) FROM ad_insights_default` → **14 linhas** (de todos os tenants). Via tabela-pai `ad_insights`, a mesma query devolve 0 — a policy só vale por lá.
- Causa: `ad_insights` é particionada por RANGE(date). No Postgres, `ENABLE ROW LEVEL SECURITY` na tabela-pai é aplicada quando a leitura passa **por ela**; a partição acessada diretamente tem a **própria** (in)existência de policy. A migration 005 criou a partição `default` sem RLS, e o teste `db/002` só exercitava a tabela-pai.
- Impacto real: nenhuma rota da aplicação consulta a partição direto, então **não vazou pela API**. Mas isso transformava a *aplicação* na 1ª camada de isolamento — o oposto do invariante 1 ("isolamento é do banco"). Um `$queryRaw` futuro, um dump ou um SELECT de suporte já bastariam.
- Correção: `db/014_rls_particoes.sql` — RLS + FORCE + policy `tenant_rw` em toda partição de `ad_insights`, num bloco **reexecutável** (partição nova nasce protegida ao rodar de novo). Verificado: sem tenant → 0 linhas; com tenant A → 14 (todas dele); tenant B → 0.
- Regressão: `db/002` bloco 15 — falha se A ler linha de B pela partição **e** se qualquer partição existir sem `relrowsecurity`.
- Lição: **RLS não é herdada por partição.** Toda tabela particionada precisa de policy na pai *e* nas partições, e o teste de isolamento tem que exercitar a partição, não só a pai.

---

## Dívida técnica mapeada (Fase 0 — não corrigida ainda)

> Inventário completo em `ESTADO_ATUAL.md` §4. Priorizado por risco × esforço.

### ~~D-01 — `auth` com 21% de cobertura de branches~~ · **QUITADA** (pré-Fase 1, 2026-07-18)
Era: `auth.service`/`token.service` sem spec — rotação de refresh, ticket `typ:'ws'` e convite de uso único só verificados à mão.
**Feito:** `token.service.spec.ts` (13) + `auth.service.spec.ts` (14). Cobre: replay de refresh recusado, hash-only no banco (token cru nunca persistido), access token não abre socket, ticket expirado/forjado/sem tenant, convite de uso único, tenant vem **do convite** e nunca de quem clica, identidade existente entra em 2º tenant sem duplicar perfil.
**Resultado:** `token.service` 58%→**100% st / 86% br** · módulo `auth` 58%→**72% st / 58% br**.
*Quitada antes da Fase 1 porque o link público de agendamento reproduz o padrão do convite (entrada sem sessão prévia).*

### D-02 — `crm`: `tasks.service` 9%, `notes.service` 17%, 0% de branches · risco médio
Regras reais sem teste: só o autor edita nota (403), toggle de tarefa, filtros `hoje`/`atrasadas`, validação de vínculo cross-tenant.

### ~~D-03 — `messages.service` 13,8% / 0% branches~~ · **QUITADA** (pré-Fase 1, 2026-07-18)
Era: o caminho do WhatsApp — onde nasceram BUG-011 e BUG-012 — era o menos coberto do sistema.
**Feito:** `messages.service.spec.ts` (13). Cobre: mensagem **persiste sempre** (com credencial, sem credencial, com STEVO fora do ar), `config_required` + `missing`, sem telefone, conversa inexistente, idempotência do webhook (reentrega não republica evento — senão a automação dispararia 2x), incremento de não lidas, **regressão do BUG-012** (número cru acha contato salvo com máscara) e isolamento por tenant em toda transação.
**Resultado:** 13,8%→**100% st / 95% br**.
*Quitada antes da Fase 1 porque a Agenda dispara confirmação e lembrete por aqui.*

### D-04 — `workflows.service` e `triggers.service` sem spec · risco médio
`validar()` (o que barra publicação de fluxo quebrado) e o match de gatilho/filtro não têm teste unitário. A engine (`runs`/`executor`) está coberta; a borda de entrada, não.

### D-05 — `nyro.service` e `tool-executor.service` sem spec · risco ALTO
Tools e guardrails têm 21 testes, mas o **orquestrador** (loop de tool-use, limite de voltas, human-in-the-loop, registro de custo) não. É o código que mais se beneficia de teste, porque roda contra um modelo não determinístico.

### D-06 — `settings.service` sem spec · risco médio
Convites, mudança de papel e notificações passam por aqui. Permissão sem teste é convite a regressão silenciosa.

### D-07 — Sem rate limit e sem circuit breaker · risco ALTO
Invariante 6 exige "rate limiting por tenant e por integração; circuit breaker em conector externo". Nenhum dos dois existe. Endpoints públicos (`/hooks/:chave`, `/webhooks/*`) e o login estão sem defesa contra abuso. **Bloqueante para produção** (Sprint H).

### D-08 — Migrações sem controle de versão · risco médio
15 arquivos em `db/`, aplicados manualmente na ordem certa. Não há `schema_migrations`: nada garante que um ambiente novo receba tudo, nem detecta migração pulada. Risco de drift silencioso entre dev e produção.

---

### BUG-012 — Inbox duplicava o contato a cada resposta (e a automação esperava um fantasma)
- Severidade: S1 (dado sujo + automação inerte)
- Status: **corrigido** (E.2, 2026-07-17)
- Reprodução: contato salvo como `+55 11 97777-1234`; ele responde no WhatsApp (o STEVO manda `5511977771234`) → o inbox **cria um contato novo** em vez de achar o existente. Consequência silenciosa: um fluxo parado em "Esperar resposta" nunca acorda, porque a resposta foi atribuída a outra pessoa.
- **Duas causas empilhadas, ambas invisíveis para mock:**
  1. `contains: digits.slice(-8)` comparava dígitos crus (`77771234`) com a string **formatada** do banco — o traço em `97777-1234` quebrava o match.
  2. Ao reescrever em SQL, `regexp_replace(telefone, '\D', '', 'g')` dentro de **template literal do JS**: a barra invertida é comida (`'\D'` → `'D'`) e o Postgres recebia `regexp_replace(telefone,'D','','g')` — que remove **a letra D**, não a máscara. A query rodava sem erro e não achava ninguém.
  3. De brinde, a mesma armadilha do [[Bugs|BUG-007]]: `right(text, ${8})` → o driver manda bigint, `right(text, bigint)` não existe → 42883.
- Correção: helper único `acharContatoPorTelefone` (usado pelo inbox **e** pela ingestão de lead — os dois precisam concordar sobre "mesma pessoa"), comparando `right(só_dígitos, 8)` dos dois lados, com `[^0-9]` (sem barra, à prova do escape do JS) e `::int` explícito. Índice funcional em `db/012` com a **mesma expressão** — se divergir, o índice não é usado.
- Verificado E2E: contato salvo com máscara + resposta crua → **1 contato**, fluxo acorda no ramo "Respondeu".
- **Lição (a terceira vez seguida):** o mock aceita qualquer tipo e qualquer string; o Postgres não. Criado `apps/api/scripts/verificar-sql.mjs`, que roda as queries cruas contra o banco real — e que agora testa **semântica**, não só "não explodiu": a primeira versão do verificador passou com o bug do `\D` ativo, porque a query resolvia.

### BUG-011 — `contact.created` só era publicado pelo WhatsApp: o gatilho mais óbvio não disparava
- Severidade: S1 (feature principal do Sprint E inerte)
- Status: **corrigido** (E, 2026-07-17)
- Reprodução: publicar um workflow com gatilho "Contato criado", ativar, criar contato pela UI → **nenhuma execução**.
- Causa: `CrmService.createContact` e `LeadsService.upsertFromLead` gravavam o contato e **não publicavam** `contact.created`. O único emissor era `MessagesService.receiveInbound` (contato criado a partir de mensagem de WhatsApp). Ou seja: o gatilho funcionava só para quem chegasse pelo WhatsApp — cadastro manual, import e **lead de anúncio** (o caso que mais importa) não disparavam nada.
- Correção: publicar `contact.created` nos dois pontos, com `origem` (Manual / Meta Lead Ads / WhatsApp) para o gatilho poder filtrar. Lead que só **enriquece** contato existente não dispara — seria disparar por quem já está no funil.
- Lição: os testes de unidade do CRM mockavam o barramento e não sabiam que o evento *deveria* existir. Só apareceu ao rodar o fluxo de verdade.

### BUG-010 — `jobId` com ":" fazia o BullMQ recusar TODO enfileiramento (nenhuma automação rodava)
- Severidade: S1 (motor inteiro inerte, em silêncio)
- Status: **corrigido** (E, 2026-07-17)
- Reprodução: criar contato com workflow ativo → `WARN [DomainEvents] falha ao enfileirar gatilho contact.created: Custom Id cannot contain :` e **zero execuções**.
- Causa: o BullMQ proíbe `:` no `jobId` (usa esse separador nas chaves do Redis) e o `add()` **lança**. Os dois enfileiramentos montavam id com `:` — `${tenantId}:${dedupeKey}` (dedupeKey já continha `evento:{json}`) e `${runId}:${noId}:${delay}`. Como a publicação é best-effort (`.catch()` que só loga), a falha virava um WARN e o motor ficava parado sem ninguém perceber.
- Correção: `idDeJob()` saneia tudo fora de `[a-zA-Z0-9_-]` (o id do nó vem do usuário) e limita a 200 chars; o gatilho usa `tenant_sha1(dedupeKey)` — curto e estável qualquer que seja o payload.
- **Lição (a mesma do [[Bugs|BUG-009]]):** o mock mentiu. O teste unitário afirmava `jobId === 'run1:wait:0'` — ou seja, **consagrava o valor quebrado**, porque a fila falsa aceita qualquer string. Trocado por asserção da **regra** (“jobId nunca contém `:`, mesmo com id de nó torto”), que é o que o BullMQ real cobra.

### BUG-009 — Paginação por cursor perdia lotes inteiros (microssegundos vs milissegundos)
- Severidade: S1 (perda silenciosa de dados na tela)
- Status: **corrigido** (D1, 2026-07-16)
- Reprodução: seed real insere 8 contatos no mesmo lote → `created_at = 2026-07-14 12:04:54.34792+00` para todos. `GET /v1/crm/contacts?limit=3` → página 1 ok; seguir o `nextCursor` → **página 2 vazia**, como se a lista tivesse acabado com 3 de 9 contatos.
- Causa: cursor keyset montado em JS (`createdAt.toISOString()`). `timestamptz(6)` guarda microssegundos; `Date` do JS só tem milissegundos. O cursor virava `.347`, e o filtro `created_at < '.347' OR (created_at = '.347' AND id < …)` era **falso para todas** as linhas em `.34792`. Qualquer importação em massa (o caso normal de cliente novo) perderia a base inteira depois da primeira página.
- Correção: cursor **nativo do Prisma** (`cursor: { id }, skip: 1` com o mesmo `orderBy`) — a comparação acontece no banco, com a precisão da coluna. Cursor opaco passa a carregar só o id. Bônus: cursor apontando para registro removido devolvia 0 linhas em silêncio → agora **400 "cursor expirado"** e o front recarrega a lista.
- Lição: o mock mentiu (JS `Date` compara com JS `Date` e passa). Só apareceu ao paginar **dado real**. Teste de regressão: `crm.service.spec.ts` → "lote com created_at idêntico continua paginando".

### BUG-004 — Busca global (Cmd+K) não pesquisa contatos/negócios; "Nada encontrado" para termos reais
- Severidade: S2
- Status: **corrigido** (S0-4, 2026-07-16)
- Origem: QA. O `CommandBar` só busca navegação + conhecimento (via `/api/cerebro`); não consulta CRM. Digitar "Marina" (contato real) → "Nada encontrado".
- Correção: `GET /v1/crm/search?q=` (`CrmService.search`, dentro de `withTenant`) busca contatos (nome/email/telefone/empresa/tag), negócios (título/origem/nome do contato) e conversas (nome/prévia/corpo das mensagens), 5 por tipo. `CommandBar` consome com debounce de 180ms e ordena **dados do tenant antes** da navegação; inbox abre a conversa por `?c=`.
- Verificado: "mar" → contato Marina Alves + negócio + conversa; "99640" → acha por telefone. Isolamento coberto pela RLS (`db/002`).

### BUG-005 — Dev server derruba com `Cannot find module './352.js'`
- Severidade: S2 (ambiente/DX, não produção)
- Status: mitigado / processo
- Origem: QA (e reproduzido nesta sessão). **Causa raiz:** rodar `next build` (produção) enquanto o `next dev` está ativo — ambos usam o mesmo `.next/`, corrompendo os chunks do dev. Não é a digitação em si.
- Correção/mitigação: não rodar `build` com o `dev` ligado; ao acontecer, `rm -rf apps/web/.next` e reiniciar o dev. Para produção usar `next start` (não afetado). Regra p/ CI/scripts: nunca buildar contra o dir de dev.

### BUG-006 — Vários controles são fachada (sem ação)
- Severidade: S3 (esperado — fora de fase)
- Status: conhecido, documentado em [[Estado-do-Sistema]]
- Origem: QA. Sem ação: "Novo negócio" (sem modal), clique no card do deal, clique na linha de contato (perfil 360), "Usar"/telefone/"..." no inbox, sino de notificações, "Meu perfil"/"Configurações", "Ativar"/"Priorizar leads" (Insights). São escopo de **FASE 2** (CRM completo/perfil 360/criar-editar negócio), **F3/F5** (Nyro/notificações). Não são regressões — são telas ainda não construídas.

### BUG-002 — `nyro_guardrail_hits` sem RLS no schema fornecido
- Severidade: S2
- Status: mitigado nesta sessão
- Reprodução: `001_rag_schema.sql` habilita RLS em documents/chunks/queries/feedback, mas **não** em `nyro_guardrail_hits` (que tem `tenant_id`).
- Correção: RLS + policy adicionadas em `db/001a_rls_harden.sql`. Manter alinhado se o schema base mudar.

### BUG-033 — Agente de WhatsApp no Ollama respondia genérico/errado e em ~130 s (Ritinha, 2026-11-11)
- Severidade: S1
- Status: corrigido (código em `src`, aguardando build oficial; validado ao vivo no WhatsApp com `dist-ritinha`)
- Ambiente: local (AI_PROVIDER=ollama, qwen3.5:9b)
- Reprodução: "quanto tá o alongamento de gel e vocês atendem sábado?" → 131 s; tratou unha como "cabelo com química", cobrou sinal inexistente; "aceita cartão?" → "aceitamos crédito e débito" (inventado); "quero agendar sexta de manhã" → "vou verificar" sem consultar agenda; "sim" → "vaga garantida" sem agendar.
- Causas raiz: (1) `conversarOllama` sem `num_ctx` → janela 4096 corta o INÍCIO do prompt (some o system); sem `keep_alive` (recarga a cada 5 min); (2) prompt sem a data de hoje; (3) modelo pequeno não chama ferramentas de escrita e afirma ações que não fez; (4) chunker/validador remontavam listas em frase corrida; (5) descritor de formalidade alta ("o senhor/a senhora") brigava com "trate pelo primeiro nome"; (6) memória da máquina em swap (Docker 7,75 GB + 9b 6 GB em 16 GB).
- Correção: `num_ctx`/`keep_alive` (OLLAMA_NUM_CTX, OLLAMA_KEEP_ALIVE); calendário no contexto; guia ESTILO_WHATSAPP com par ruim/bom; pré-consulta de agenda + agendamento determinístico no aceite explícito de horário livre (`engines/agenda-intent.ts`); dados do sistema colados na última mensagem; transferência prometida vira transferência; afirmação de agendamento inexistente removida; cumprimento repetido e frases de enchimento removidos; rajada atravessa automação; atraso de rajada 4→7 s (AGENTE_ESPERA_RAJADA_MS); resposta velha descartada se o contato escreveu durante a geração. Specs: 103/103 nos agentes.
- Existe em outros pontos?: a mesma `conversarOllama` atende a NICO — o `num_ctx` também a corrige.
- Pendências: fluxo "Novo Lead 🚀" (importado do GHL) fala junto com a IA em todo contato novo — decisão do dono; "digitando…"/marcar como lida não existem na API de gestão Stevo (openapi.yaml); análise por IA desligada na Ritinha (custa 16–27 s no Mac) → sem extração de campos do CRM.

### BUG-034 — Restringir subcontas ou rebaixar papel de membro da agência não valia dentro das subcontas já abertas (2026-11-12)
- Severidade: S1 (segurança: acesso que deveria ter sido retirado continuava)
- Status: corrigido (`AgencyService.sincronizarAcessos`), validado em runtime no QA (`apps/api/scripts/qa/seletor-subcontas.mjs`, 14/14)
- Reprodução: membro admin entra nas subcontas A e B → dono edita o membro para viewer com acesso só à A → o membro continuava entrando na B com o mesmo token e continuava admin na A.
- Causa raiz: `atualizarMembro` só gravava `agency_member_client_access`/`role`; as `memberships` criadas por `ativarCliente` (upsert com `update: {}`) nunca eram revistas.
- Correção: ao editar o membro, vínculos não padrão de subcontas que saíram da visibilidade são apagados (+ sessões revogadas + perfil removido) e o papel das que ficaram é ajustado; `ativarCliente` também alinha o papel a cada entrada. O tenant próprio da pessoa (`isDefault`) nunca é tocado. Specs: 20/20 em `agency.service.spec.ts`.

---

## Template de registro

```
### BUG-000 — Título curto
- Severidade: S0|S1|S2|S3
- Status: aberto
- Ambiente: local|staging|prod
- Reprodução: passos numerados
- Esperado / Obtido:
- Causa raiz:
- Existe em outros pontos?:
- Correção + teste de regressão:
```

### INCIDENTE — Env vars do Render apagadas por PUT parcial na API (2026-11-13)
- **Severidade:** S1 (a instância antiga seguiu no ar com o env em memória; qualquer restart derrubaria a produção).
- **Causa raiz:** `PUT /v1/services/{id}/env-vars` da API do Render **substitui o conjunto inteiro** de variáveis (não faz merge). Um PUT com só `FIRECRAWL_API_KEY` e `NICO_PROVEDOR` apagou as outras 20 (DATABASE_URL, JWT_SECRET, chaves Stevo/Meta/Voyage etc.).
- **Como foi pego:** o deploy seguinte falhou no boot do worker; o erro só apareceu depois de instrumentar o `worker.ts`, que engolia a exceção real ("Worker failed to start" genérico → agora imprime `Error: Env inválida — JWT_SECRET: Required`).
- **Correção:** conjunto completo restaurado (22 vars) a partir de `deploy/.env.render` (JWT/DB/proxy), `apps/api/.env` (chaves de provedor) e `render.yaml` (AI_PROVIDER, REDIS_URL derivada do keyvalue). Opcionais `ANTHROPIC_EFFORT_MAX` e `ANTHROPIC_MODEL_FORCE` não foram restauradas (valor desconhecido; o código tem default).
- **Lição (permanente):** para mudar UMA var no Render, primeiro GET a lista inteira e fazer PUT com a lista completa alterada. Melhor: manter as vars no `render.yaml` (que faz merge) e não na API.

### BUG-047 — Conectar Instagram/Messenger em Conversas falhava com "Invalid Scopes: pages_manage_engagement" (2026-11-17)
- Severidade: S1 (ninguém conseguia conectar ou reconectar Instagram/Messenger; as conexões antigas seguiam funcionando, por isso a DM continuava chegando)
- Status: corrigido
- Ambiente: prod
- Reprodução: Configurações → Conversas → Conectar Instagram → diálogo da Meta: "Este conteúdo não está disponível no momento · Invalid Scopes: pages_manage_engagement".
- Causa raiz: `ESCOPOS_META_CONVERSAS` pedia `pages_manage_engagement` (só usada para responder comentário de post da página do Facebook), mas o app da Meta não tem essa permissão liberada no caso de uso. Para quem administra o app, a Meta bloqueia o diálogo inteiro.
- Correção: `pages_manage_engagement` saiu da lista padrão; só é pedida com `META_COMENTARIOS_PAGINA=1` (ligar depois de liberar a permissão no app da Meta). Responder comentário da página sem a permissão concedida não chama a Meta e falha com o motivo; o cartão mostra "Responder comentários da página" indisponível com o motivo. Specs novos em `canais.spec.ts` (38/38; suíte API 1598 ok).

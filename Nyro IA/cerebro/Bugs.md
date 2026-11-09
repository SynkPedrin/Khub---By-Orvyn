# Bugs — Orvyn

> Reprodução, severidade, status. Alimenta a triagem da sprint ([[Sprint]]). Toda correção: causa raiz + verificar se existe em outros pontos + teste de regressão.

Severidade: `S0` catastrófico (ex.: vazamento entre tenants) · `S1` crítico · `S2` maior · `S3` menor.
Status: `aberto` · `em correção` · `corrigido` · `não reproduz`.

---

## Abertos

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
- Correção: rotas exigem sessão validada na API (5 testes); `urlSegura()` redige `/hooks/:chave`, `/hooks/evolution/:token` e `?token=` em log, Sentry e corpo de erro (5 testes). Pendente (produto): `/conhecimento` e ⌘K ainda mostram o vault da Orvyn a qualquer usuário logado — trocar pela base RAG do tenant.

### BUG-023 — Conversas e Agenda vazias no modo real (dados existiam)
- Severidade: S1 · Status: **corrigido** (ADR-0039)
- Reprodução: menu Conversas e Agenda fora do modo demo → sempre o estado vazio, com 405 conversas importadas / compromissos no banco. O inbox real existia em `/inbox`, fora do menu.

### BUG-024 — KPIs do funil errados (fechados contados como abertos; funis misturados)
- Severidade: S1 · Status: **corrigido** (ADR-0039, `crm/funil.ts` + 6 testes)
- Reprodução: tenant com negócios ganhos/perdidos ou com 2 funis → "Negócios abertos" = total, "Valor em pipeline" soma perdidos, Kanban mistura etapas dos dois funis, conversão = última etapa / total.

### BUG-025 — Lista de conversas carregava todas as mensagens a cada evento; não lidas nunca zeravam
- Severidade: S2 · Status: **corrigido** (ADR-0039)
- Reprodução: 405 conversas / 6.572 mensagens → payload de megabytes a cada mensagem nova ou a cada 5 s sem socket; abrir a conversa não baixava o contador.

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
- Reprodução: como `orvyn_app`, **sem** `app.current_tenant_id`: `SELECT count(*) FROM ad_insights_default` → **14 linhas** (de todos os tenants). Via tabela-pai `ad_insights`, a mesma query devolve 0 — a policy só vale por lá.
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

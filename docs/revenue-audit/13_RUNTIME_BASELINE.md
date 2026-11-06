# 13 — Baseline de Runtime

> Sprint 0. Primeiro baseline com **Postgres, Redis, API, worker e front rodando de verdade**. Data: 2026-10-14.
> Tudo aqui foi executado e medido. Onde não foi, está dito.

## 1. Classificação dos testes (para não confundir mock com prova)
| Tipo | O que é | Neste projeto |
|---|---|---|
| `MOCK_TEST` | Jest/Vitest com Prisma/HTTP simulados | 304 (API) + 18 (web). **Não provam integração.** Três defeitos P1 de runtime passaram por eles (ver 16) |
| `INTEGRATION_TEST` | Contra Postgres real, role `orvyn_app` | `db/002_isolation_test.sql` (RAG) + `scripts/qa/rls-matrix.sql` (122 verificações) |
| `REAL_RUNTIME_TEST` | API + worker + Redis + Postgres reais, e navegador real | `scripts/qa/scenarios.mjs` (52), `webhook-proxy.mjs` (12), `browser.mjs` (10) |
| Integração externa real | WhatsApp, Meta, Anthropic, SMTP | **Nenhuma.** Não é validada por mock nem por este baseline |

## 2. Ambiente reproduzível
Stack isolada (nomes, volume e portas exclusivos; nada compartilhado com o dev):
| Serviço | Onde | Como sobe |
|---|---|---|
| PostgreSQL 16 + pgvector | container `orvyn-qa-pg`, `127.0.0.1:55440`, volume `orvyn_qa_pg`, banco `orvyn_qa` | `docker compose -p orvyn-qa -f docker-compose.qa.yml up -d` |
| Redis 7 | container `orvyn-qa-redis`, `127.0.0.1:6395`, volume `orvyn_qa_redis` | idem |
| API NestJS | `:4010` | `cd apps/api && set -a && . ./.env.qa && set +a && node dist/main.js` |
| Worker BullMQ | processo `node dist/worker.js` | idem, com `dist/worker.js` |
| Front Next (build de produção) | `:3220` | `cd apps/web && env -u NODE_ENV NEXT_DIST_DIR=.next-qa ORVYN_API_URL=http://localhost:4010 NEXT_PUBLIC_ORVYN_DEMO=0 npx next build && ... npx next start -p 3220` |

Segredos do QA ficam só em `apps/api/.env.qa` (ignorado pelo git, permissão 600), gerados aleatoriamente. **Nenhum segredo está em log ou documento.**

Para parar só o QA: `docker compose -p orvyn-qa -f docker-compose.qa.yml stop` e matar os PIDs das portas 4010/3220 e o `node dist/worker.js`. **Nunca** `down -v`, `prune` ou `pkill` genérico.

### Infraestrutura pré-existente (não tocada)
`orvyn-postgres`/`orvyn-redis` (5432/6379, dev), containers `orvyn-audit-*`, `orvyn-finance-*`, `orvyn-evolution`, `evolution_*`, e os volumes `orvyn_pg`, `orvyn-os_orvyn_*`, `nyroia_orvyn_*`. Nenhum foi alterado, parado ou apagado.

## 3. Incidente de isolamento durante o baseline (relato honesto)
Na primeira subida, a API de QA **leu o `apps/api/.env` de desenvolvimento**: o Prisma carrega esse arquivo ao ser importado e preenche, sem sobrescrever, toda variável que o ambiente não definiu. Isso injetou chaves reais (`META_APP_ID`, `STEVO_*`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `EVOLUTION_*`) no processo de QA.

Impacto medido: **uma única chamada externa** saiu, do cenário 7 ("conectar WhatsApp"), para o Evolution local `127.0.0.1:8080` (HTTP 404; nenhuma instância criada). Os logs não mostram chamadas a Stevo, Resend, Anthropic nem Graph API.
Correção: o `.env.qa` agora define **explicitamente em branco** as 21 chaves do `.env` de dev, e um *canário* (`GET /integrations/meta/auth-url` → 501 `config_required`) confirma o isolamento antes de cada rodada. Todos os resultados deste baseline foram refeitos depois da correção.
Classe: `INFRASTRUCTURE_DEFECT` (carga implícita de `.env`). Recomendação em 16 (RT-07).

## 4. Gates de qualidade
| Gate | Estado | Evidência |
|---|---|---|
| API typecheck | **PASS** | `evidence/gate-API_typecheck.log` |
| API tests (jest) | **PASS** 304/304, 37 suítes | `gate-API_tests_(jest).log` |
| API build | **PASS** | `gate-API_build.log` |
| WEB typecheck | **PASS** | `gate-WEB_typecheck.log` |
| WEB lint | **PASS** (0 erros, 3 warnings pré-existentes: 2× `<img>`, 1× deps de `useCallback`) | `gate-WEB_lint.log` |
| WEB tests (vitest) | **PASS** 18/18, 4 arquivos (antes: não existiam) | `gate-WEB_tests_(vitest).log` |
| WEB build | **PASS** | `gate-WEB_build.log` |
| Migrations 000–027 | **PASS** (28 arquivos, idempotentes) | `migrations-apply.log`, `migrations-reapply.log` |
| RLS isolamento (002 + matriz como `orvyn_app`) | **PASS** 122/122 | `rls-002.log`, `rls-matrix.log` |
| Worker startup | **PASS** (heartbeat Redis + job repetível `reconcile`) | `worker-run.log` |
| Browser smoke | **PASS** 10/10, 55 páginas | `browser-report.json` |
| Cenários de runtime | **PASS 48/52** (4 FAIL = lacunas de produto confirmadas) | `scenarios-results.json` |
| Webhook público via proxy | **PASS** 12/12 | `webhook-proxy-results.json` |
| Testes de segurança de API (rate limit) | executado: **achou defeito** (RT-04) | ver 16 |
| Testes E2E de integrações externas | **NOT_EXECUTED** (sem credencial, por desenho) | — |

## 5. API, worker, Redis
| Verificação | Resultado |
|---|---|
| `GET /v1/health` | `200 {status:ok}` |
| `GET /v1/ready` | `200 {database:true, redis:true}` |
| Worker no ar | heartbeat `orvyn:worker:heartbeat` (TTL 30 s) e `bull:orvyn-maintenance:repeat:reconcile` ativo |
| Execução de job, persistência | outbox → reconcile (5 s) → run → passos persistidos em `workflow_run_steps` |
| Retry | observado: passo falho reexecutado 4× (1/4…4/4) com backoff, depois `falhou` (ver RT-02, RT-03) |
| Reinício do worker no meio de uma espera | **PASS**: espera de 90 s sobreviveu ao `kill` e ao novo processo; ação pós-espera executou **1 vez** |
| Latência (n=30, base pequena) | `/auth/me` p50 4,0 ms · `/crm/overview` 5,3 · `/crm/contacts` 3,7 · `/crm/pipeline` 4,2 · `/crm/conversations` 3,7 · `/automations/workflows` 4,1 · `/agency/overview` 6,3 · `/integrations` 3,4 (p95 ≤ 8,7 ms) |

A latência foi medida com **4 contatos e 1 oportunidade**: prova que não há lentidão estrutural, **não** prova escala. `crm.overview` e `pipeline` carregam todos os negócios (ARQ-04) e não foram testados com volume.

## 6. Os oito cenários (resultado real)
Legenda: **PASS** = caminho principal funciona e nada falhou; **PASS_COM_LACUNAS** = o caminho principal funciona, mas verificações de produto falharam (listadas); **FAIL** = caminho principal quebrado.

| # | Cenário | Resultado | Verificações | O que falhou / ressalva |
|---|---|---|---|---|
| 1 | Organização cliente → entrar → contexto | **PASS** | 3/3 (+ UI) | Agência só nasce por seed SQL (não há como criar pela API/UI): `PRODUCT_GAP` |
| 2 | Criar lead → persistir → consultar → ver na UI | **PASS_COM_LACUNAS** | 4/6 | L-1: `POST /crm/contacts` não deduplica telefone (2 contatos iguais, HTTP 201). L-3: `origem` não é gravada |
| 3 | Oportunidade → Kanban → reload | **PASS** | 6/6 (+ UI drag-and-drop) | Criar oportunidade **não existe na UI** com dados (só API) |
| 4 | Automação com espera → restart do worker | **PASS** | 9/9 | Espera de 90 s, worker morto e recriado no meio |
| 5 | Inbound (adaptador de teste) → conversa → cancela follow-up | **PASS_COM_LACUNAS** | 7/8 | I-4: inbound não grava Activity do contato. **Não é WhatsApp real** (payload sintético no webhook real) |
| 6 | Trocar de cliente → isolamento → acesso indevido | **PASS_COM_LACUNAS** | 14/15 | **SEC-01 (P0)**: ex-membro da agência mantém `membership` e o token antigo continua lendo contatos (HTTP 200) |
| 7 | Falha de integração → tratamento → status | **PASS** | 5/5 | Degradação explícita (501 `config_required`; WhatsApp `nao_configurado`). **Não é OAuth real validado** |
| 8 | Usuário novo → navegar → operar | **PASS_COM_LACUNAS** | 10/10 de navegador | 4 dos 10 CTAs testados não fazem nada; sem onboarding guiado (ver 15) |

**Total: 4 PASS · 4 PASS_COM_LACUNAS · 0 FAIL.**

**Antes das correções desta sprint** os cenários 4 e 5 e a automação de webhook estavam quebrados em runtime (RT-01, RT-02, RT-03). Os testes com mock estavam verdes o tempo todo.

### Verificações de isolamento (cenário 6) que passaram
Cliente A2 não lê, não acessa por id, não move nem exclui dados de A1. Agência B não acessa dados nem clientes da A (IDOR em contatos, oportunidades, workflows, detalhe de cliente, ativação). Listagens, membros e visão geral de cada agência não vazam. JWT com `tenant_id` adulterado → 401. Sem token → 401. Troca de contexto pela UI funciona e os dados trocam junto.

## 7. O que funcionou de verdade (REAL_RUNTIME_TEST)
Cadastro e login; criação de cliente de agência; entrar na subconta e trocar de cliente; contatos (criar/consultar/listar); funil padrão de 5 etapas; criar e mover oportunidade com persistência, evento no outbox e audit log; mover para etapa inexistente falha; workflows (salvar grafo, validar, publicar, ativar); execução com espera persistente; webhook de entrada (token inválido 401, idempotência); recebimento de mensagem persistida, conversa, não lidas e cancelamento de follow-up; webhook público de workflow pelo proxy; isolamento entre tenants e agências; telas e fluxos principais no navegador.

## 8. O que continua SEM validação
- **Qualquer integração externa real:** WhatsApp (Evolution/Stevo), Meta (OAuth, Lead Ads, Ads), Google, Stripe, SMTP/Resend, Anthropic/Voyage. Dependem de credenciais e de contas reais; por regra desta sprint não foram usadas.
- **Mecanismo de tempo real do Inbox** (a mensagem aparece sem reload em até 14 s, mas não se sabe se por socket ou por polling; a hipótese I-1 da auditoria estática, de que o worker não emite socket, **não** produziu falha observável).
- **Ações de automação além de** adicionar tag, criar tarefa, criar nota e esperar; entre elas enviar WhatsApp/e-mail/SMS, criar oportunidade, mover oportunidade, webhook de saída, nós de IA.
- **Gatilhos além de** `contato_criado` e `webhook` e `mensagem_recebida` (via outbox). `etapa_mudou` só teve o evento de outbox confirmado, não a execução de uma automação.
- **Carga e volume** (milhares de contatos/negócios, conversas longas), concorrência real, filas com backlog, DLQ sob falha prolongada.
- **Acessibilidade**, teclado, outros navegadores.
- **Operações de produção:** backup, restore, observabilidade, deploy.
- **Billing/Stripe** (inexistente) e **Agenda/Financeiro** em runtime (as rotas existem, não foram exercitadas).

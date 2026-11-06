# 17 — Relatório da Sprint 0 (Runtime Baseline)

> 2026-10-14. Escopo: transformar evidência de leitura em evidência de funcionamento. Status do produto **não muda**: `NOT_AGENCY_READY`.

## Respostas obrigatórias

| # | Pergunta | Resposta |
|---|---|---|
| 1 | PostgreSQL está funcionando? | **Sim.** PostgreSQL 16.14 + pgvector em container isolado (`orvyn-qa-pg`, porta 55440), banco novo `orvyn_qa` |
| 2 | Redis está funcionando? | **Sim.** Redis 7 isolado (`orvyn-qa-redis`, porta 6395); `/v1/ready` confirma `redis:true`; filas BullMQ ativas |
| 3 | Todas as migrations foram aplicadas? | **Sim.** 28/28 (000 a 027), sem erro, sem alterar arquivo antigo, registradas em `schema_migrations` com checksum e reaplicáveis (0 falhas na reaplicação) |
| 4 | API está funcionando? | **Sim.** `:4010`, `/health` e `/ready` 200, `typecheck` e `build` verdes, 304 testes |
| 5 | Worker está funcionando? | **Sim.** Heartbeat no Redis, reconcile a cada 5 s, processa outbox e passos, e **sobreviveu a um reinício real no meio de uma espera de 90 s** |
| 6 | Frontend está funcionando? | **Sim.** Build de produção em `:3220`, 55 páginas, 0 erro de console, 0 request com falha, 0 overflow, ≤ 1,4 s por página |
| 7 | Quantos cenários passaram? | **8 de 8 executados sem quebra do caminho principal**: 4 PASS e 4 PASS_COM_LACUNAS (ver 13 §6) |
| 8 | Quantos falharam? | **0 cenários falham.** 4 verificações de produto dentro dos cenários falham (L-1, L-3, I-4, SEC-01) e há 4 de 10 CTAs sem ação |
| 9 | Quais falhas são P0? | **SEC-01**: acesso de agência a clientes nunca é revogado (ex-membro mantém `membership` e o token antigo lê dados). Ressalva: a auditoria apontou tabelas de agência sem RLS (SEC-02, P1): o isolamento passou nos testes de API, mas depende só do código |
| 10 | Principais problemas visuais? | CTAs principais sem ação; texto de dev exposto ("Como ativar o modo demo"); "Plano Pro/Fazer upgrade" fixo; "Responsável" como nome do dono; Kanban pobre (sem filtros, sem criar oportunidade, card sem tempo parado/próxima ação); inbox sem layout mobile e prometendo "Instagram · E-mail"; 4 itens de menu com telas vazias. Detalhe e screenshots em 15 |
| 11 | O que realmente funcionou? | Ver 13 §7. Destaques: cadastro/login, agência → cliente → troca de contexto com isolamento, contatos, Kanban com drag-and-drop persistido, automação com espera persistente, webhook público, recebimento e cancelamento de follow-up, rate limit, degradação explícita sem credencial |
| 12 | O que continua sem validação? | **Todas as integrações externas reais**, ações de automação além de 4, gatilhos além de 3, tempo real (mecanismo), carga/volume, acessibilidade, billing, Agenda/Financeiro em runtime. Ver 13 §8 |
| 13 | Quais correções foram realizadas? | RT-01 a RT-07 (16 §A). As três da auditoria mais **quatro defeitos P1 que só existiam em runtime** |
| 14 | Todos os builds passaram? | **Sim**: API typecheck/tests/build e Web typecheck/lint/tests/build, todos PASS (13 §4). Warnings de lint (3) pré-existentes |
| 15 | Próximo bloqueio comercial? | **Conexão Meta confiável por cliente** (token sem renovação e importação para o tenant errado) e **SEC-01**. O primeiro depende de credenciais e App Review (externo) para ser provado; o segundo é código e é o próximo a corrigir |

## O que esta sprint mudou na leitura do produto
1. **O baseline de mocks mentia.** 304 testes verdes escondiam que **nenhuma mensagem recebida era persistida** (RT-01), que **duas ações centrais de automação nunca funcionavam** (RT-02) e que o **webhook de entrada quebrava** (RT-03/05). Depois das correções, o motor passou ponta a ponta. Isso confirma o valor de testar em runtime, e que os 3 defeitos eram baratos de corrigir.
2. **A base é mais sólida do que a auditoria estática temia em alguns pontos:** isolamento entre tenants e agências resistiu a 14 de 15 ataques de API e 122 de 122 verificações de RLS; a espera de automação sobrevive a restart; o tempo real do Inbox funcionou; a degradação sem credencial é honesta.
3. **O risco comercial mais subestimado era o rate limit por tenant** (RT-04): uma única sessão intensa derruba o app inteiro do tenant por 60 s.

## Decisões tomadas e desvios (transparência)
- **Incidente de isolamento (13 §3):** a API de QA leu o `.env` de dev e uma chamada saiu para o Evolution **local** (`127.0.0.1:8080`, 404, nada criado). Corrigido e todo o baseline refeito. É o único contato com serviço externo/real; nenhuma mensagem foi enviada.
- **Erro meu:** ao reiniciar o front de QA usei `pkill -f next-server`, que derrubou também o servidor de dev da porta 3210 que você me pediu no início. **Foi restaurado** (`npm run dev`, HTTP 200). Os demais reinícios usaram o PID exato da porta.
- **Dependências:** adicionei 4 `devDependencies` exatas ao `apps/web` (vitest, jsdom, Testing Library). Sem isso não havia como criar o teste de regressão pedido. O lockfile mudou.
- **Não fiz:** migrations estruturais, mudança de `UNIQUE(page_id)`, billing, apagar dados, enviar mensagens, conectar contas externas, redesign.
- **Fora de escopo, mas relevante:** `framer-motion` aparece como dependência não commitada do `apps/web` (já estava assim antes da sprint).

## Atualização do scorecard (só dimensões com evidência nova)
Notas antigas em 01. Escala 0 a 5.
| Dimensão | Antes | Agora | Evidência nova | Bloqueio restante |
|---|---|---|---|---|
| Arquitetura | 3,5 | **3,5** | Migrations 28/28 idempotentes, stack sobe do zero | Sem runner oficial único de migrations |
| Automações | 3,0 | **3,5** | Espera sobrevive a restart; webhook→run→ações; mas 3 defeitos P1 achados e corrigidos; RT-08/09 abertos | Só 4 ações e 3 gatilhos verificados |
| Kanban | 2,0 | **2,5** | Drag-and-drop persiste e sobrevive a reload na UI real | Sem criar oportunidade na UI, sem filtros, card pobre |
| Leads | 2,0 | **2,0** | Criar/consultar/listar OK | L-1 (sem dedupe), L-3 (sem origem), sem CSV |
| Conversas | 2,0 | **3,0** | Inbound persistido, idempotente, na UI sem reload; follow-up cancela; RT-01 corrigido | Sem WhatsApp real; I-4; sem busca/atribuição; mobile ruim |
| Agency Mode | 1,8 | **2,3** | Criar cliente, entrar, trocar sem logout (31 ms) e isolamento A×B funcionam na UI e na API | SEC-01 (P0), sem saúde/alertas, agência só por seed |
| Segurança | 2,5 | **2,5** | RLS 122/122 e IDOR 14/15; contra: SEC-01, SEC-02, rate limit | Não testados: SSRF, segredo de webhook, auth |
| Performance | 2,0 | **2,5** | p95 ≤ 9 ms em base pequena | Sem teste de volume; 48 FKs sem índice |
| UX | 1,5 | **2,0** | 0 erro de console, 0 overflow, ≤ 1,4 s; mas CTAs mortos e menu enganoso | Ver 15 §7 |
| Visual | 2,0 | **3,0** | Inspeção real: identidade consistente, layout limpo em 3 viewports | Texto de dev exposto, itens hardcoded |
| Dashboard | 2,0 | **2,0** | Métricas reais coerentes com os dados | "Taxa de conversão" e "negócios abertos" imprecisos |
| Integrações | 1,5 | **1,5** | Degradação sem credencial verificada | Nenhuma integração real provada |
| IA | 2,5 | **2,5** | Estado "IA não configurada" honesto na UI | Sem chave: não validável |
| Analytics, Onboarding, Prontidão comercial | — | **sem mudança** | — | — |

## Próximos passos recomendados (ordem)
1. **SEC-01** (P0): revogação de acesso. Código puro, sem credencial, alto risco comercial.
2. **B-RT-04**: ajustar o rate limit (isentar `/auth/me`, limite por usuário). Decisão sua sobre o teto.
3. **Suíte `INTEGRATION_TEST` no CI** com a stack `docker-compose.qa.yml` (RT-13), para que RT-01/02/03 não voltem.
4. **Sprint 1 do roadmap** (segurança de agência: RLS das tabelas de agência com migration aprovada, reset de senha, lockout).
5. Em paralelo, desbloqueios externos: credenciais Meta/Evolution reais de QA para validar a Sprint 2.

## Decisões que preciso de você
1. **Migrations estruturais** (SEC-02 RLS de agência, índices das 48 FKs, `UNIQUE(page_id)`): quer que eu proponha o SQL com rollback para aprovação?
2. **Limite de requisições:** qual teto por tenant/usuário é aceitável comercialmente?
3. **Runner oficial de migrations** com `schema_migrations`/checksum no fluxo normal (hoje só no QA): adotar?
4. **Stack de QA no CI:** posso transformar `docker-compose.qa.yml` + `scripts/qa/*` em job de CI?

## Como reproduzir tudo
`docker compose -p orvyn-qa -f docker-compose.qa.yml up -d` → aplicar migrations em ordem (ver 14 §2) → criar `apps/api/.env.qa` (ver 13 §2) → subir API/worker/front → `node apps/api/scripts/qa/scenarios.mjs main` → `webhook-proxy.mjs` → `browser.mjs` (exige `playwright-core` e Chrome) → `psql ... -f apps/api/scripts/qa/rls-matrix.sql` como `orvyn_app`. Evidências em `docs/revenue-audit/evidence/` (tokens de QA em `*-state.json` são ignorados pelo git).

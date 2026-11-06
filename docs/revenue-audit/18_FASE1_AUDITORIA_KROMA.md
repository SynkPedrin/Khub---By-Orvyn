# 18 — Fase 1: auditoria para a operação KROMA

> Data: 2026-11-06. Pedido: "Prompt master — auditoria, hardening e implementação do ORVYN Revenue OS" (Fase 1: diagnóstico e plano antes de alterar código).
> Método: releitura das auditorias 01–17 (14/10) + reverificação do **código atual** em 4 frentes (agência/RBAC/isolamento; WhatsApp/webhooks/credenciais/GHL; CRM/comercial/dashboards; segurança/observabilidade/testes) + checagens diretas feitas nesta sessão (git, banco de dev em modo leitura, API da Stevo com `GET /v1/me`).
> Convenção de estado: **COMPROVADO** (evidência de runtime ou teste real) · **POR LEITURA** (código existe e parece correto, sem prova de ponta a ponta) · **PARCIAL** · **SÓ UI** · **DEMO** · **INEXISTENTE** · **DEFEITO**.

## 0. Status

**`NOT_AGENCY_READY`** (mantido desde 14/10).

Nenhum dos 14 itens do checklist de prontidão comercial está comprovado de ponta a ponta (ver §8). Base técnica real: auth com refresh rotativo, RLS no Postgres, motor de automações com DLQ, RAG isolado, Nyro com tools tipadas. A distância é entre "o código existe" e "uma agência opera 10 clientes pagantes".

## 1. Achados que bloqueiam qualquer avanço (resolver antes da Fase 2)

| # | Achado | Evidência | Sev. |
|---|---|---|---|
| B-1 | **O código que roda não está no git.** HEAD `51edbf0` é de 30/07. Working tree: 117 modificados, 101 não rastreados — inclui `auth/permissions.guard.ts` (todo o RBAC do backend), `worker.ts`, módulos `agency/`, `operations/`, `billing/`, `agents/`, migrações `026–031` e `.github/workflows/`. O `app.module.ts` do HEAD não registra o `PermissionsGuard`. Um deploy a partir do repositório sobe **sem controle de permissão**. | `git status --porcelain` (06/11) | P0 |
| B-2 | **Duas sessões de IA alteram o mesmo repositório ao mesmo tempo.** A sessão `nyro-ia-56` reiniciou API/worker (≈09:10), rodou `pnpm install` às 09:13 (interrompido: o pacote `next` sumiu e o web passou a responder 500) e criou `db/031_fix_outbox_grants.sql`. Sem coordenação, migrações e arquivos colidem. | `ps`, `stat` de `pnpm-lock.yaml`/`.modules.yaml`, `ListAgents` | P0 |
| B-3 | **Envio em dev vai para o número real do contato.** Fora de produção o destino é `STEVO_TEST_NUMBER \|\| telefone`; a variável não existe no `.env`. Vale para Inbox, automações, Nyro e agentes. Hoje latente: nenhuma instância pareada (2 Evolution em `conectando`), 304 contatos com telefone no banco de dev. | `messages.service.ts` (destino), consulta de leitura ao banco | P0 latente |
| B-4 | **Vault interno público.** `/api/cerebro` e `/api/cerebro/[...slug]` servem PRD, Bugs etc. sem sessão (o middleware exclui `/api`); o vault entra no deploy. | `apps/web/app/api/cerebro/route.ts` sem checagem de sessão | P1 |

Incidente desta sessão: o `pnpm install` interrompido (B-2) foi completado com `pnpm install --frozen-lockfile --prefer-offline` (só restaurou o pacote `next` a partir do lockfile; nenhuma versão mudou). O web compila (0 erros). O servidor web em 3210 precisa ser reiniciado para carregar o pacote restaurado.

## 2. Mapa da arquitetura atual

```
Browser ──► Next.js 14 (apps/web, :3210)
             ├─ páginas (app/(app), (auth), (marketing))
             ├─ proxies com cookie httpOnly: /api/v1/*, /api/crm/*, /api/auth/*
             └─ /api/cerebro (lê o vault Obsidian)  ◄─ B-4
                  │ Bearer (JWT 15 min; refresh 30 d rotativo)
                  ▼
           NestJS (apps/api, :3333)  ── guards globais: JWT → Permissions → RateLimit
             módulos: auth, tenants, agency, settings, crm (+messaging), automations,
             nyro, agents, rag, integrations, analytics, agenda, financeiro, billing,
             marketplace, blueprints, operations, realtime (Socket.IO por tenant), health
                  │ Prisma + withTenant() → SET LOCAL app.current_tenant_id
                  ▼
           PostgreSQL 16 + pgvector (RLS FORCE nas tabelas de negócio; agência SEM RLS)
                  │ triggers SQL → outbox_events
                  ▼
           Worker (mesmo código, ORVYN_PROCESS_ROLE=worker) ── BullMQ/Redis
             filas: orvyn-maintenance (reconcile 5 s), automation-triggers, automation-steps,
             agent-replies, ads-sync, rag-ingestion
                  │
                  ▼
           Externos: Evolution (WhatsApp, self-hosted) · Stevo (só envio, API de instância)
                     Anthropic · Voyage · Meta Ads/Leads · Stripe · SMTP · Google/GitHub OAuth
```

Pontos de arquitetura que importam para a KROMA:
- **Agência é camada de identidade, não de dados.** Subaccount = `tenant`. A agência acessa o tenant do cliente por `membership` criada no momento do acesso. Não há RLS nas tabelas de agência.
- **Evento durável nasce no banco** (trigger → `outbox_events`), o worker consome. Webhooks gravam no outbox e respondem rápido.
- **Gating por credencial** (ADR-0008): sem chave, a API responde `501 config_required` — padrão correto e consistente.

## 3. Inventário de módulos e estado real

| Domínio | Estado | Resumo |
|---|---|---|
| Auth (login, signup, refresh, OAuth) | POR LEITURA | Sem reset de senha (link `href="#"`), sem proteção de força bruta, 409 revela e-mail existente. |
| Agência (contexto, clientes, troca, convites) | PARCIAL | Criar cliente só pede nome e nicho; criação não é atômica nem cria o dono do cliente. Troca sem re-login só para owner/admin (member/viewer: 403). **Sem remover membro nem arquivar cliente (SEC-01).** Sem criação de agência fora de seed. |
| RBAC | PARCIAL | Matriz só em código (`permissions.guard.ts`), papéis owner/admin/manager/member/viewer. Agenda, financeiro, billing e agents caem no mapeamento padrão. Sem teste do guard. Sem escopo "vendedor vê só as suas oportunidades" (não há responsável em deal). |
| Isolamento | PARCIAL | RLS FORCE forte nas tabelas de negócio; `002_isolation_test.sql` cobre 17 seções, mas **não** contacts, deals, pipelines, users, agenda, financeiro, api_keys, campanhas nem agência. |
| CRM — contatos | PARCIAL | Criar (só em `/contatos`, fora do menu; empresa escolhida é descartada), sem importação CSV, sem dedupe manual, `origem` nunca gravada, sem responsável, campos custom só como JSON sem definição. |
| CRM — funis/oportunidades | PARCIAL | Arrastar entre etapas persiste. **Sem CRUD de funil/etapa (REST e UI).** Criar/editar/ganhar/perder só pela API (`DealDrawer` pronto mas não importado). Sem responsável, motivo de perda, próxima atividade, ordem na coluna. |
| Propostas · Carteira | INEXISTENTE | Nenhum modelo, rota ou tela. |
| Atividades | PARCIAL | Tarefas e notas reais; agenda com API mas tela vazia fora do demo; sem tipo (ligação/reunião). |
| Inbox / Conversas | PARCIAL | Mensagens e tempo real. Status de entrega enganoso (`sent` aparece como entregue; incerto aparece como enviado). Rótulos "via STEVO" com Evolution. |
| Automações | POR LEITURA | 28 nós, BullMQ, DLQ, esperar resposta, drip. Bug ativo no worker: `ramos is not iterable` (nó de ramificação com config legada). |
| Nyro (copiloto interno) | POR LEITURA | Tools tipadas, aprovação humana, guardrails. **BUG-017:** envia `temperature` para `claude-sonnet-5`, que a API recusa (corrigido no adaptador nesta sessão, ver §7). |
| Agentes de IA (Sprint AG) | PARCIAL | **Backend novo nesta sessão:** tabelas `agents`/`agent_runs` (migração 030, aplicada no dev, isolamento verde), API `/v1/agents`, runtime no worker (idempotente, transfere para humano em qualquer desvio), atendimento IA↔humano no Inbox (API). 369 testes verdes. **Falta:** UI `/agentes`, UI de atendimento em `/conversas`, horário de atendimento, vínculo a instância/funil, clonagem, gate de validação antes de ativar. |
| RAG / base de conhecimento | POR LEITURA | Ingestão de documento, busca híbrida isolada por tenant. Sem ingestão por URL nem FAQ estruturado; sem filtro por documento por agente. |
| Dashboard / Analytics | PARCIAL | Números reais com rótulos errados (abertos conta todos; pipeline inclui ganhos/perdidos). Analytics só de IA e automações, com taxa de sucesso errada (`falha` vs `falhou`). Sem métrica comercial. `AdsSimulador` fabrica números em produção. "Plano Pro" fixo. |
| Observabilidade | PARCIAL | `/health`, `GET /operations` (worker, outbox, runs) sem tela; logs JSON com correlationId; Sentry só na API e só pelo filtro HTTP. Sem tela de saúde, sem alertas. |
| Testes | PARCIAL | API: 42 suítes / 369 testes (mocks). Web: 4 arquivos / 18 testes. QA/E2E manuais (`apps/api/scripts/qa`), fora do CI. CI existe só local (não versionado). |
| Onboarding/implantação | INEXISTENTE | Sem checklist, sem status de implantação. `/onboarding` aplica 1 de 3 blueprints e não está no menu. |
| KROMA / 4 modos | INEXISTENTE | Nenhuma referência. Base aproveitável: blueprints (funil + automações), `tenant.templateId`, `plano` do billing. |

## 4. Integrações

| Integração | Estado | Observação |
|---|---|---|
| **Stevo — API de instância** (`sm-linguado.stevo.chat/message/sendText/<instância>`) | POR LEITURA, inativa | Única chamada existente. Evolution sempre vence quando configurada. Nenhum código cria integração `stevo` por tenant: em produção cai em `config_required`. |
| **Stevo — API de gestão** (`openapi.stevo.chat/v1`) | INEXISTENTE no código · **chave validada** | `GET /v1/me` com a chave nova → HTTP 200, sem restrição de instância, 60 req/min. Documentação oficial lida: instâncias (CRUD, QR, connection/health, disconnect, delete com `confirm`), envio com `Idempotency-Key`, webhooks de conta com HMAC-SHA256 (`X-Stevo-Signature`, janela de 300 s, `event_id`), entregas com retry. Detalhe em §5. |
| Evolution (self-hosted) | POR LEITURA · QR **comprovado** | Pareamento, envio e recebimento reais **não** comprovados. Perde mensagens enquanto o status não é `connected` (só o poll grava). Sem apagar instância; desconectar existe na API, sem UI. |
| Webhooks Stevo/Evolution | DEFEITO | Token global (query/path), sem HMAC; tenant escolhido pelo nome de instância (previsível) no corpo; o token vai para logs/Sentry em erro 5xx (URL logada). |
| Meta Ads / Leads | PARCIAL | HMAC correto; leads dependem de Advanced Access (bloqueio externo). |
| Stripe (billing) | PARCIAL | HMAC correto; dedupe grava antes de processar (evento perdido em falha). Sem UI. |
| Anthropic | Configurado | Usado pela Nyro e agentes. |
| GHL | **Fora do produto (ADR-0031)** | Decisão de 06/11: o Revenue OS **substitui** o GHL; sem integração. Auditoria: zero dependência funcional (ver §11). Escopo `ghl:manage` deve sair da chave Stevo. |
| Marketplace (UI) | PARCIAL | Instagram/Messenger aparecem "Conectado" junto com Meta Ads sem estar; Stripe aparece "em breve" com backend pronto; Stevo não aparece. |

## 5. Stevo: o que a documentação oficial permite e o que a chave concede

Fonte: guia REST e SDK oficiais (`tutorial.stevo.chat/docs/para-desenvolvedores/api-gestao/`, `…/sdk-stevo-gestao/`). A referência interativa completa (`openapi.stevo.chat/openapi.yaml`) ainda não foi lida — ler antes de implementar cada rota (regra: não inventar endpoint).

**Escopos da chave entregue (06/11):** `instances:read`, `instances:manage`, `links:generate`, `ghl:manage`, `ai:manage`, `messages:send`, `webhooks:write`, `groups:write`, `dispatch:manage`, `voice:manage`. Sem restrição de instância. Limite 60 req/min.

**Menor privilégio — o que o Revenue OS precisa:**

| Função | Escopo | Na chave? |
|---|---|---|
| Listar/consultar instâncias, conexão, saúde | `instances:read` | sim |
| Criar, QR, desconectar, apagar instância | `instances:write` (sinônimo legado `instances:manage`) | sim |
| Enviar mensagem | `messages:send` | sim |
| Consultar status de mensagem | `messages:read` | **não** |
| Webhook de conta (criar/rotacionar) | `webhooks:write` (+ `webhooks:read` para listar) | só write |
| Link de acesso para o cliente | `links:generate` | sim (manter só se a KROMA usar) |
| GHL | `ghl:manage` | sim — **remover** (ADR-0031: sem GHL) |
| Stevo IA, grupos, disparo em massa, StevoVoice | `ai:*`, `groups:*`, `dispatch:*`, `voice:*` | sim — **remover** (o Revenue OS tem agentes próprios; disparo em massa não é usado) |
| Billing | `billing:*` | não (correto) |

Recomendação: criar **uma chave de conta** (sem restrição de instância, exigida para webhook de conta) só com `instances:read/write`, `messages:send/read`, `webhooks:read/write` (+ `links:generate` se usado), e revogar a atual. **60 req/min por chave é baixo para várias empresas na mesma conta** — confirmar com a Stevo o limite contratável antes de colocar clientes.

Onde a chave está: `apps/api/.env` → `STEVO_REVENUE_API_KEY` (arquivo ignorado pelo git; nunca enviado ao browser; nenhum código usa ainda). `STEVO_ACCOUNT_KEY` (outra chave, já no `.env`) também não é usada por código — definir se deve ser revogada.

## 6. Riscos de segurança (consolidado, por severidade)

| Sev. | Risco | Estado vs 14/10 |
|---|---|---|
| P0 | B-1 código fora do git (deploy sem RBAC) | piorou |
| P0 | SEC-01: sem offboarding; `revokeAllForIdentity` nunca chamado; refresh de 30 d sobrevive | igual |
| P0 | Webhook WhatsApp com segredo global → injetar mensagem em qualquer tenant | igual |
| P0 latente | B-3 envio de dev para número real | novo achado |
| P1 | B-4 vault público em `/api/cerebro` | novo achado |
| P1 | SSRF do nó webhook (sem resolver DNS, segue redirect) | igual |
| P1 | Rate limit inútil atrás de proxy (sem trust proxy/XFF); login sem força bruta | igual |
| P1 | Sem reset de senha | igual |
| P1 | Tabelas de agência sem RLS e sem teste A×B; "uma agência por identidade" não garantida | igual |
| P1 | Token do webhook em logs/Sentry (URL logada em 5xx) | novo achado |
| P1 | LGPD: sem anonimização/retenção; mensagens sobrevivem à exclusão do contato; viewer exporta; consentimento não checado no envio | parcial (endpoints novos) |
| P2 | CSRF só por SameSite=lax nos proxies; redirect pós-login não validado; refresh reusado não revoga família; cripto sem versão de chave | igual |

## 7. O que foi alterado nesta sessão (antes do prompt master)

Registrado para transparência — nada disso está commitado.
1. **Design system Liquid Glass** (ADR-0029): `globals.css`, `tailwind.config.ts`, shell, modais. Verificado no navegador.
2. **Sprint AG — backend** (ADR-0030 em andamento): `db/030_agents.sql` (**aplicada no banco de dev**, aditiva, rollback no arquivo), bloco 17 do `002`, `apps/api/src/agents/*`, `crm/messaging/atendimento.service.ts`, alterações em `messages.service.ts`, `crm.controller.ts`, `crm.service.ts`, `operations/*`, `app.module.ts`, Prisma, `packages/types`. Adaptador Anthropic: preços 5.5, sem `temperature` para modelos que recusam (BUG-017), `effort`, blocos brutos para o loop de tools, fallback de recusa no servidor. 369 testes da API verdes; isolamento verde. **Não implantado:** a API/worker em execução usam o build anterior.
3. **Front da Sprint AG: não iniciado** (só `lib/agents.ts` e tipos em `lib/crm.ts`). Pausado pela Fase 1.
4. Ambiente: `pnpm install --frozen-lockfile` para restaurar o `next` (B-2); linha `.next-glass` removida do `tsconfig.json`; chave Stevo guardada em `.env`.

## 8. Checklist de prontidão comercial

| Pergunta | Estado | Prova que falta |
|---|---|---|
| Cadastrar um cliente? | PARCIAL | Formulário só com nome/nicho; sem CNPJ, dono, contato, plano/oferta, status de implantação, responsável interno. |
| Criar uma subaccount? | PARCIAL | Provisiona tenant + funil; não atômico; não cria o dono do cliente. |
| Convidar o cliente? | PARCIAL | Convite existe (hash, 7 dias); e-mail depende de SMTP; sem reset de senha; aceite não validado ponta a ponta. |
| Conectar WhatsApp? | NÃO COMPROVADO | Nenhuma instância pareada; Stevo de gestão não implementada. |
| Configurar um agente? | PARCIAL | API pronta e testada; sem UI. |
| A IA responde mensagens reais? | NÃO COMPROVADO | Runtime testado só com mocks; worker novo não implantado; sem WhatsApp pareado. |
| A IA usa a base de conhecimento? | PARCIAL | Tool e busca isolada existem; sem teste com documento real do cliente. |
| Transferir para humano? | PARCIAL | Backend pronto e testado; sem UI. |
| Estruturar o CRM? | PARCIAL | Sem CRUD de funil/etapa, sem campos custom definidos, sem responsável. |
| Configurar pipelines? | NÃO | Só via Nyro ou blueprint. |
| Executar follow-ups? | PARCIAL | Motor existe; não comprovado com envio real. |
| Visualizar indicadores? | PARCIAL | Dashboard com rótulos errados; sem métricas comerciais. |
| A KROMA administra todos os clientes? | PARCIAL | Troca de cliente (owner/admin); sem saúde, sem offboarding. |
| O cliente administra só a própria operação? | PARCIAL | RLS forte no negócio; agência sem RLS; CRM core fora do teste no CI. |

## 9. Decisões que precisam do product owner antes da Fase 2

1. **Versionamento (B-1):** autorizar organizar o working tree em commits numa branch (`hardening/fase-0`), com revisão, antes de qualquer feature. Sem isso, nada do que for feito é implantável com segurança.
2. **Sessões concorrentes (B-2):** escolher uma única sessão para mexer no repositório, ou separar por pastas/branches.
3. **Provedor de WhatsApp:** recomendação — Stevo API de gestão como provedor principal (instância por subaccount via `external_ref = tenantId`, webhook de conta com HMAC), Evolution mantida como alternativa self-hosted. Escolha do provedor **por tenant**, não global.
4. **Chave Stevo de menor privilégio** (§5) e confirmação do limite de 60 req/min.
5. ~~GHL~~ **Decidido em 06/11 (ADR-0031): o Revenue OS substitui o GHL, sem integração.** Pendente só: a KROMA tem clientes operando no GHL hoje? Se sim, quais dados precisam vir (contatos, oportunidades, histórico de conversas, tarefas) e em que prazo — define a prioridade do importador (§11).
6. **Número de teste (B-3):** informar um número de WhatsApp de teste da KROMA para `STEVO_TEST_NUMBER`, e aprovar a trava "em não-produção, sem número de teste, não envia".

## 10. Plano priorizado (ordem de dependência)

Uma sprint por sessão (contrato do repositório). Cada sprint fecha com testes, verificação no navegador e cérebro atualizado.

| Ordem | Sprint | Fase do prompt | Conteúdo | Depende de |
|---|---|---|---|---|
| 0 | **Higiene de base** | — | Commits em branch (B-1); trava de envio em dev (B-3); `/api/cerebro` exige sessão e sai do bundle (B-4); token de webhook fora dos logs; `ramos is not iterable`; reiniciar API/worker com build atual. | decisões 1, 2, 6 |
| 1 | **Fundação SaaS I — acesso** | 2 | SEC-01 (remover membro, arquivar cliente, revogar sessões); RLS + teste A×B nas tabelas de agência; member/viewer trocam de cliente; reset de senha; força bruta + trust proxy. | 0 |
| 2 | **Fundação SaaS II — clientes e papéis** | 2 | Cadastro de cliente completo (campos do §4.1 do prompt + status de implantação); criação atômica com dono + convite; papéis KROMA (proprietário, admin, gestor, vendedor, atendente, analista, visualizador) com matriz testada; responsável em contato/deal com escopo "vendedor vê as suas"; `002` cobrindo contacts/deals/users/agenda/financeiro/api_keys + no CI. | 1 |
| 3 | **Stevo I — instâncias** | 3 | Provider da API de gestão (`/v1/me` com mapa de escopos → "falta permissão X" na UI); instância por subaccount (criar, QR, connection/health, desconectar, apagar com confirmação); provedor por tenant; painel de instâncias na agência. | 2, decisões 3–4 |
| 4 | **Stevo II — mensagens e webhooks** | 3 | Webhook de conta com HMAC + janela 300 s + dedupe por `event_id` + entregas; envio com `Idempotency-Key`; status real (`message.delivered/read/failed`); corrigir status e rótulos do Inbox; homologação real com número de teste (Teste C). | 3 |
| 5 | **IA I — Sprint AG concluída** | 4 | UI `/agentes` + playground; atendimento IA↔humano em `/conversas`; pausar/retomar; horário de atendimento; vínculo a instância e funil; clonar; gate "testado antes de ativar"; deploy do worker. Teste D. | 4 |
| 6 | **IA II — conhecimento e follow-up** | 4 | Base por cliente: URL e FAQ; filtro por documento por agente (com `rag:eval`); contexto comercial no agente (etapa, responsável, próxima ação); follow-up inteligente com limites, horário, opt-out e interrupção por humano. | 5 |
| 7 | **CRM I — funil e oportunidades** | 5 | CRUD de funis/etapas (REST + UI); deal com responsável, probabilidade, motivo de perda, próxima atividade, ordem; ligar o `DealDrawer`; atividades com tipo; importação CSV com dedupe; `origem` confiável; campos custom com definição. Teste E. | 2 |
| 8 | **CRM II — propostas e carteira** | 5 | Entidade de proposta (valor, envio, validade, status, follow-up, alerta de parada); carteira (ativo/inativo, compras, recompra, listas de reativação). | 7 |
| 9 | **Modos KROMA + indicadores** | 5 | Blueprint v2 = módulos ativos + funis + automações + painéis para os 4 produtos (combináveis); analytics comercial real; corrigir rótulos do dashboard; remover `AdsSimulador`/"Plano Pro" fixos. | 7, 8 |
| 10 | **Gestão da agência** | 6 | Dashboard consolidado real (filtro por cliente/período); checklist de implantação (16 etapas com responsável, prazo, evidência); tela de saúde (instâncias, webhooks, filas, erros de IA, custo) com distinção de causa; alertas. | 3, 5, 9 |
| 11 | **Saída do GHL (migração de dados)** | — | Importador CSV com mapeamento para os exports do GHL (contatos, oportunidades com funil/etapa, tags, campos custom), dedupe, origem `migracao_ghl`, relatório de importação e reprocessamento; validação com uma exportação real antes de desligar. Sem API do GHL. Pode subir para logo após a sprint 7 se houver clientes no GHL. | 7, decisão 5 |
| 12 | **Homologação** | 7 | E2E no CI com Postgres/Redis (Testes A–F); LGPD (anonimização, retenção); documentação dos 16 entregáveis; guia de deploy; checklist de homologação de clientes. | todas |

Bloqueios externos conhecidos: chave Stevo de menor privilégio e limite de requisições; número de WhatsApp de teste; SMTP para convites e reset; Advanced Access da Meta para leads.

## 11. GHL — auditoria de dependências e plano de remoção/substituição (ADR-0031)

Pedido de 06/11: "Quero o Revenue OS no lugar do GHL". Varredura completa (código, UI, env, npm, banco, Prisma, testes, docs):

| Onde | Encontrado | Ação |
|---|---|---|
| Integração (OAuth, Agency Account, Locations, sync de contatos/oportunidades, webhooks) | **Nada** | — |
| Variáveis de ambiente (`.env`, `.env.example`, `.env.qa`, `.env.local`) | **Nada** | — |
| Dependências npm / lockfile | **Nada** (4 "acertos" são trechos de hash de integridade) | — |
| Banco, migrações, Prisma | **Nada** (nenhuma tabela/coluna; nenhum dado vinculado a GHL) | Nada a migrar dentro do Revenue OS |
| Telas, botões, menus, texto visível | **Nada** | — |
| Comentários de código | 9 ("como nas telas do GHL" em automações; `playbooks.ts`) | Reescrever como "referência de mercado" na sprint 0 (cosmético, sem efeito funcional) |
| Testes | 1 título de teste ("como no GHL") | Renomear junto |
| Documentação | PRD (posicionamento contra GHL), ADR-0015 e Trilha W (benchmark de motor), Blueprints/README | Manter como histórico; ADR-0031 registra a decisão nova |
| Chave Stevo | escopo `ghl:manage` (e `agency:*` não concedido) | Remover o escopo ao recriar a chave |

**Conclusão:** não há remoção destrutiva a fazer — o produto nunca dependeu do GHL. O que falta para "desligar o GHL e continuar operando" é capacidade nativa, já mapeada no plano (§10): subaccounts completas (sprints 1–2), WhatsApp via Stevo (3–4), agentes (5–6), CRM com propostas/carteira e campos personalizados (7–8), modos KROMA e indicadores (9), gestão da agência (10) e o **importador de dados de saída do GHL** (11), que é a única peça específica de GHL — e é importação de arquivo, não integração.

## 12. Migração do cliente KROMA que já opera no GHL (2026-11-06)

Situação informada: a KROMA tem 2 clientes; **1 já opera no GHL** com automações, histórico de mensagens e IA rodando. Token de Private Integration (PIT) do GHL entregue e guardado em `apps/api/.env` → `GHL_MIGRATION_TOKEN` (uso único, nunca no runtime — ADR-0031).

Rotas oficiais **confirmadas** na documentação (`marketplace.gohighlevel.com/docs`, base `https://services.leadconnectorhq.com`, `Authorization: Bearer <PIT>`, header `Version`):

| Dado | Rota | Escopo | Destino no Revenue OS |
|---|---|---|---|
| Subconta | `GET /locations/{locationId}` | `locations.readonly` | dados do cliente / tenant |
| Contatos (com total) | `POST /contacts/search` (`locationId`, `pageLimit` ≤ 500; `searchAfter` acima de 10 mil) | `contacts.readonly` | `contacts` (dedupe por telefone/e-mail, origem `migracao_ghl`) |
| Histórico de mensagens | `GET /conversations/messages/export` (`locationId`, cursor de 2 min, `total`) | `conversations/message.readonly` | `conversations` + `messages` (autor contato/humano/IA preservado) |
| Mensagens por conversa | `GET /conversations/{conversationId}/messages` | `conversations/message.readonly` | complemento do export |

Constam no índice oficial, mas **sem página lida** (validar antes de usar): oportunidades (`/opportunities/search`), funis (`/opportunities/pipelines`), campos custom e tags (`/locations/{locationId}/customFields`, `/tags`), agentes de Conversation AI (`/conversation-ai/agents/search`). **Workflows: nenhuma rota de exportação documentada** — as automações do cliente serão **reconstruídas** no motor do Revenue OS a partir de um levantamento feito na tela do GHL; o prompt/regras da IA serão recriados como agente do Revenue OS (Sprint AG).

Limites: 100 req/10 s por PIT por location; 200 mil/dia por location; 429 sem `Retry-After`.

**Bloqueio para começar:** o **Location ID** da subconta (GHL → Settings → Business Profile). Não há rota documentada que o descubra a partir do PIT.

**Sequência proposta (só leitura no GHL; nada é apagado lá):**
1. Inventário: contagens de contatos, conversas/mensagens, oportunidades, funis, tags, campos, agentes de IA (relatório, sem gravar).
2. Mapeamento campo a campo → aprovação do product owner.
3. Importador idempotente (script de migração fora do runtime, com relatório e reprocessamento) num tenant de homologação; conferência por amostragem.
4. Reconstrução das automações e do agente no Revenue OS; testes no playground.
5. Corte: Revenue OS assume o WhatsApp (Stevo) do cliente; GHL fica só leitura até a validação; depois, revogar o PIT e apagar `GHL_MIGRATION_TOKEN`.

### 12.1 Resultado do inventário (2026-11-06, só leitura)
- Location ID recebido; `GET /locations/{id}` com `Version: v3` → **200**: subconta **"Studio da Beleza"**, fuso `America/Sao_Paulo`.
- `POST /contacts/search` → **401** "The token is not authorized for this scope". `GET /conversations/messages/export` → **401** (mesmo motivo). O PIT só tem o escopo de location.
- Observação técnica: o Cloudflare do GHL bloqueia clientes HTTP sem User-Agent de navegador/cliente (erro 1010); o extrator usa `User-Agent: orvyn-migracao/1.0`.
- **Para seguir:** editar o PIT no GHL (Settings → Private Integrations) e liberar **somente leitura**: `contacts.readonly`, `conversations/message.readonly` (confirmados na documentação) e, conforme a documentação de cada rota, os de leitura de conversas, oportunidades, funis, campos/tags, usuários, workflows e Conversation AI. Nenhum escopo de escrita.

### 12.2 Limpeza e estado de partida (2026-11-06)
- **Contas demo apagadas** (pedido do product owner): 3 tenants `is_demo` (Vitta Prime, Helios, Forma Casa), a conta de demonstração `demo@orvyn.local` (Clínica Aurora) e 2 contas de QA `@teste.invalido` — 6 tenants, 6 identidades, 583 eventos de fila. Backup completo do banco antes (`pg_dump -Fc`, fora do repositório). Trigger de imutabilidade do `audit_logs` desligado só dentro da transação e religado (verificado ATIVO).
- Ficam: `Sua Empresa` (tenant de fallback do webhook Stevo), `Destino Ads`, `ORVYN Revenue OS`, `Orvyn IA` + agência "Pedro Gabriel".
- **Stevo (`GET /v1/instances`, leitura):** 2 instâncias SM v2 na conta — `studio-da-beleza` (**conectada**, perfil "Studio da Beleza") e `dra-barbara-lopes` (inativa, desconectada). O WhatsApp do cliente que opera no GHL **já está pareado na Stevo**: não é preciso QR.

### 12.3 Corte do inbox sem derrubar o GHL
1. **Paralelo (sem risco):** webhook de conta Stevo → Revenue OS (assinatura HMAC, `event_id`, filtro pela instância `studio-da-beleza` vinculada ao tenant do cliente por `external_ref`). Webhooks de conta são aditivos (até 10): o GHL continua recebendo. Revenue OS só **lê** — mensagens e contatos entram, nenhum envio.
2. **Ensaio de envio:** fora de produção a trava manda tudo para o número de teste (`STEVO_TEST_NUMBER`).
3. **Corte:** com automações e agente reconstruídos e validados, o Revenue OS passa a responder; a integração Stevo→GHL é desligada; GHL fica só leitura até a validação final.
- **Bloqueio de infraestrutura:** a Stevo precisa alcançar o webhook por **HTTPS público**. Hoje a API roda em `localhost`. Precisa de deploy (API + worker + Postgres + Redis) ou túnel HTTPS para o ensaio.

### 12.4 Sprint Stevo (2026-11-06)
Integração com a API de gestão implementada (ADR-0032; 404 testes verdes). Subcontas **Studio da Beleza** (instância pareada, vinculada, `connected`) e **Dra. Bárbara Lopes** (instância não pareada, vinculada, `disconnected`) criadas na agência. Envio por tenant ativo, sob a trava de dev (só para `STEVO_TEST_NUMBER`). **Pendente para receber mensagens reais:** URL HTTPS pública para o webhook de conta.


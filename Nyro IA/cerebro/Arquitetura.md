# Arquitetura — KHUB

> Stack congelada, fronteiras de módulo, diagramas, decisões técnicas (ADRs) e tokens de marca. Fonte da verdade técnica. Ver também [[PRD]] · [[Banco]] · [[APIs]] · [[RegrasNegocio]].

---

## 1. Visão geral

Arquitetura de **monólito modular** (NestJS) no início — velocidade de entrega com fronteiras claras que permitem extrair serviços depois. `nyro` e `automations` são os primeiros candidatos a virar serviço; devem ser projetados já com fronteira limpa.

```
[ Next.js (Web App) ] --- [ API Gateway / BFF ]
                                |
    +----------------+----------------+----------------+
    | CRM Core       | Nyro IA Service | Automation Engine |
    | (Node/Nest)    | (agents + RAG)  | (BullMQ workers)  |
    +----------------+----------------+----------------+
         |                  |                |
[ PostgreSQL + pgvector ] [ Redis ] [ S3/Storage ]
         |
[ Conectores: Meta | Google | LinkedIn | Stripe | WhatsApp ]
```

---

## 2. Stack (CONGELADA — não substituir sem ADR aprovado)

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Front-end | Next.js 14+ (App Router), TypeScript, Tailwind, shadcn/ui, React Query, Zustand, React Flow (canvas), Recharts | SSR para performance/SEO, ecossistema maduro, produtividade |
| Back-end | Node.js + NestJS (TypeScript), REST `/v1` + WebSocket | Tipagem ponta a ponta, módulos claros, DI nativa |
| Banco | PostgreSQL + **pgvector**, Prisma ORM, **Row-Level Security** | Relacional + vetorial no mesmo banco simplifica o RAG |
| Fila/Cache | Redis + BullMQ | Automações assíncronas, esperas longas, rate limit |
| IA | Claude (Anthropic API) como motor principal, via camada de abstração de provider | Qualidade de raciocínio; abstração evita lock-in |
| Arquivos | S3 compatível (AWS / Cloudflare R2) | Documentos do RAG, anexos, mídias |
| Infra | Vercel (front) + AWS/Digital Ocean (API e workers) + Cloudflare (DNS/WAF/CDN) | Custo controlado no MVP, caminho claro de escala |
| Observabilidade | Sentry, OpenTelemetry, Grafana/Logs estruturados | Debug de automações e da IA em produção |

> ⚠️ LACUNA: O PRD diz "Next.js 14+" mas não fixa versão exata de Node, NestJS, Prisma ou pgvector. Fixar no ADR-0002 (setup do monorepo, Bloco 2 de F0), consultando as versões estáveis vigentes na data do setup.

---

## 3. Módulos do back-end (NestJS)

Fronteira explícita: **nenhum módulo importa do interno de outro** — apenas de interfaces públicas exportadas (`index.ts` / barrel público de cada módulo).

| Módulo | Responsabilidade | Candidato a serviço |
|---|---|---|
| `auth` | Login, OAuth Google, JWT + refresh, 2FA, convites de equipe | não |
| `tenants` | Contas, planos, provisionamento de template, versionamento de blueprint | não |
| `crm` | Contatos, empresas, deals, pipelines, tarefas, notas, campos custom, tags | não |
| `inbox` | Canais, conversas, mensagens, atribuição, SLAs de resposta | não |
| `automations` | CRUD de workflows, engine de execução, scheduler, logs | **sim** |
| `nyro` | Orquestrador de agentes, tools, memória de conta, guardrails, filas de aprovação | **sim** |
| `rag` | Ingestão, chunking, embeddings, busca híbrida, namespaces por tenant/nicho | possível |
| `integrations` | Conectores, OAuth vault, webhooks in/out | não |
| `billing` | Assinaturas Stripe, medição de uso de IA (créditos), limites por plano | não |
| `analytics` | Eventos de produto, KPIs por nicho, materialized views | não |
| `audit` | Log imutável de toda ação (humana ou Nyro) | não |

### Módulos transversais (infra compartilhada)
- `common` — filtros de exceção RFC 7807, correlation-id, guards, interceptors, DTOs base Zod.
- `database` — PrismaService + middleware de contexto de tenant (`SET LOCAL app.tenant_id`).
- `config` — carregamento e validação de env (Zod), sem segredos no código.

---

## 4. Estrutura do monorepo (planejada — Bloco 2 de F0)

```
/ (repo root = "Nyro IA")
  CLAUDE.md                 # convenções, aponta para o cérebro
  Nyro IA/                  # vault Obsidian (cérebro) — dogfooding do RAG
    cerebro/                # os 8 arquivos de doc + Blueprints/
  apps/
    web/                    # Next.js 14+ (App Router)
    api/                    # NestJS (monólito modular)
  packages/
    ui/                     # design system (tokens + componentes shadcn) + assets de marca
    config/                 # eslint, tsconfig, tailwind preset compartilhados
    types/                  # contratos compartilhados front<->back (gerados/derivados)
  docker-compose.yml        # Postgres + pgvector + Redis (dev local)
  logo.png                  # asset de marca (fonte)
  Identidade visual.png     # asset de marca (fonte)
```

> ⚠️ LACUNA: O PRD não impõe ferramenta de monorepo (pnpm workspaces vs Turborepo vs Nx). Decisão no ADR-0002. Recomendação de partida: **pnpm workspaces + Turborepo** (leve, alinhado a Vercel).

---

## 5. Multi-tenancy (regra catastrófica)

- Banco único compartilhado com **RLS no Postgres**. Toda tabela de negócio tem `tenant_id NOT NULL`.
- Isolamento garantido no **banco**, não na aplicação (aplicação é a 2ª camada).
- Toda transação roda com `SET LOCAL app.tenant_id = <id>`. Middleware de contexto injeta em toda request.
- Todo PR que adiciona tabela → policy RLS + teste de isolamento (tenant A lê tenant B → 0 linhas).
- RAG: `tenant_id` em toda query vetorial (namespace por tenant).

Detalhamento e SQL em [[Banco]].

---

## 6. Identidade visual e Design System

Assets oficiais **já presentes no projeto** (usar estes, não recriar):
- `logo.png` — 1058×1058, PNG RGBA. Símbolo: trevo de quatro folhas em ametista (quatro corações de diamante roxo) + wordmark "KHUB".
- `Identidade visual.png` — 1340×1320, símbolo sobre fundo creme claro com wordmark "KHUB" abaixo.

Em F0 (Bloco 4) esses arquivos serão movidos/copiados para `packages/ui/assets/` e usados como fonte para favicon, logo do app e splash.

### 6.1 Tokens de marca (base — a validar no Bloco 4)

| Token | Valor | Uso |
|---|---|---|
| `--brand-primary` | `#7B2FBE` | Cor de ação (definida pelo PRD §10.1) — botões, links, foco |
| `--brand-primary-deep` | `#5B1E9E` | Hover/pressed, gradientes | 
| `--brand-primary-bright` | `#A93FE0` | Realces, estados ativos |
| `--brand-lilac` | `#C9A0F0` | Tints, badges suaves, ilustração |
| `--surface-cream` | `#F3F1EC` | Fundo claro premium (do "Identidade visual.png") |
| `--ink` | `#1A1A1A` | Wordmark, texto principal |

> ⚠️ LACUNA / DERIVADO: **Somente `#7B2FBE` é especificado pelo PRD.** Os demais hex acima são *derivados* da leitura da imagem `Identidade visual.png` e são **propostos**, não spec. Devem ser amostrados com precisão do arquivo e aprovados no Bloco 4 (escala 50→900, tokens semânticos de dark/light, contraste WCAG AA). Não tratar como definitivos.

### 6.2 Princípios de UI (do PRD §10.1)
- Base clara, roxo como ação, visual premium e limpo.
- **Mobile-first** — inbox e Kanban 100% responsivos.
- Nyro a um atalho: painel lateral + command bar (`Cmd/Ctrl+K`).
- Zero tela em branco: todo estado vazio com CTA da Nyro.

---

## 7. Padrões de engenharia (invioláveis)

- TypeScript `strict: true`, zero `any` sem justificativa em PR.
- Validação de entrada em toda rota (Zod / class-validator). Erros RFC 7807 + `correlation-id`.
- Rate limiting por tenant e por integração; circuit breaker em todo conector externo.
- Idempotência em webhooks e workers (chave de deduplicação por evento).
- Segredos nunca no código nem no log; OAuth criptografado por tenant (KMS); mascaramento de PII em logs.
- Testes: unitário no domínio, integração nas rotas críticas, **teste de isolamento de tenant a cada release**.
- Nyro age só via tools tipadas → mesmas APIs/permissões de um usuário → tudo em `audit_logs` com `actor:'nyro'`.

---

## 8. ADRs (Architecture Decision Records)

> Formato: contexto → opções → decisão → consequências. Consultar antes de propor mudança estrutural.

### ADR-0001 — Localização do cérebro dentro do vault Obsidian existente
- **Status:** Aceito (esta sessão).
- **Contexto:** O master prompt define a estrutura canônica `/cerebro/`. O PRD §15.1 lista os 8 arquivos *flat* dentro da pasta `Nyro IA/` e a §15.2 exige que o vault fique "na mesma pasta da Nyro IA" para dogfooding do RAG. Já existe um vault Obsidian real em `Nyro IA/` (com `.obsidian/`).
- **Opções:**
  1. `/cerebro/` na raiz do repo, separado do vault → viola §15.2 (docs fora do vault, sem dogfooding).
  2. Arquivos flat direto em `Nyro IA/` → segue §15.1 literal, mas polui a raiz do vault e diverge do nome `/cerebro/` do master prompt.
  3. Subpasta `Nyro IA/cerebro/` → dentro do vault (dogfooding OK) e mantém o agrupamento `/cerebro/`.
- **Decisão:** Opção 3. Cérebro em `Nyro IA/cerebro/`. Código-fonte em `apps/` na raiz (não em `Projeto/`). `CLAUDE.md` na raiz aponta para `Nyro IA/cerebro/`.
- **Consequências:** Obsidian abre o vault `Nyro IA/` e enxerga `cerebro/`. Reversível (mover pasta). CLAUDE.md deve referenciar caminhos com espaço (`Nyro IA/cerebro/...`).

### ADR-0002 — Ferramentas e versões do monorepo *(Aceito — Bloco 2 de F0)*
- **Status:** Aceito (esta sessão). Instalado e verificado (build verde).
- **Contexto:** Fixar gerenciador de monorepo e versões da stack.
- **Decisão:** **pnpm workspaces + Turborepo**. Layout: `apps/web`, `apps/api`, `packages/config`, `packages/types` (`packages/ui` adiado — ver Tasks F0-15). Versões fixadas:
  - Node **20.20.2** (nvm) · pnpm **9.12.3** (corepack) · Turborepo **2.10.5**
  - Front: Next **14.2.35** · React **18.3.1** · Tailwind **3.4.10** · react-markdown 9 + remark-gfm 4
  - Back: NestJS **10.4.22** · Prisma / @prisma/client **5.22.0** · class-validator 0.14.4 · zod 3.23.x
  - TypeScript **5.5.4** (strict) · Postgres alvo **pg16 + pgvector** (imagem `pgvector/pgvector:pg16` no compose)
- **Consequências:** `prisma generate` OK gerando o modelo com `Unsupported("vector(1024)")` (R0.3). Migrações do RAG continuam em SQL puro (`db/`), não no Prisma Migrate. `packages/ui` fica como dívida pequena (web tem seus componentes locais). Turbo `tasks` (schema v2). **Verificado:** `pnpm build` → 2/2 apps; API sobe e responde `/v1/health` (db:false sem Postgres) e 404 em `application/problem+json`.

### ADR-0054 — ONBOARDING KROMA: implantação de clientes da agência (dados agency-scoped, tarefas no Daily, homologação com bloqueio no backend)
- **Status:** Aceito (2026-11-22) — prompt master "ONBOARDING KROMA" do product owner.
- **Contexto:** A KROMA precisa conduzir a implantação de cada subconta (cliente da agência) com processo rastreável: coleta de conhecimento, imersão, inteligência via Genna, spec do agente de IA do cliente, tarefas distribuídas à equipe e homologação por critérios antes de liberar a operação.
- **Decisão:**
  1. **Dados agency-scoped** (padrão db/026/074): as 10 tabelas `agency_onboarding*` (`db/078_onboarding_kroma.sql`) não têm `tenant_id` nem RLS; isolamento no `OnboardingService` via `AgencyService.escopo` (member restrito só vê subcontas permitidas; viewer só lê; finalizar/decidir aprovação só owner/admin). Nenhum dado operacional de subconta é lido/gravado.
  2. **Tarefas no sistema nativo** (`agency_tasks` do Daily, ADR-0050) — vínculo onboarding↔tarefa em `agency_onboarding_tasks`; geração filtrada pelo escopo contratado (sem tarefa de entregável não contratado) com dedupe por título.
  3. **Homologação no backend:** `POST /v1/agency/onboarding/:id/finalizar` trava a linha (`FOR UPDATE`), revalida TODA verificação obrigatória aplicável ao escopo e aprova a `aprovacao_final` na própria ação (owner/admin). Idempotente; 409 `onboarding_pendencias` com a lista do que falta. Um onboarding não-finalizado por subconta (índice único parcial).
  4. **Genna (ADR-0053) consumida, não reinventada:** relatórios só via tools de leitura, resultado salvo como dado não-confiável em `agency_onboarding_reports.bruto`; sem conexão → 409 `genna_nao_conectado` (nada simulado).
  5. **Front em `/agency/onboarding`** (o `/onboarding` existente é blueprints do tenant — produto diferente). Item no `AGENCY_NAV`.
- **Consequências:** mudança de escopo por member vira `agency_onboarding_approvals` pendente (owner/admin decide, aplica e re-semeia verificações). Agente de IA do cliente: spec + 11 cenários de teste na agência; a criação real do agente no tenant do cliente usa o módulo `agents` existente (integração futura via `agent_id`). **Verificado:** jest 1731 verdes · vitest 270 · tsc API/web limpos · E2E real `scripts/qa/onboarding-e2e.mjs` 33/33 contra API+Postgres de dev (migration 078 aplicada).

### ADR-0041 — Rebrand completo Orvyn → KHUB (inclusive nomes internos)
- **Status:** Aceito (pedido do product owner, 2026-11-09: "mude tudo pra KHUB", escopo "tudo, inclusive interno", domínios mantidos).
- **Feito:** texto visível, documentação e comentários; pacotes `@khub/*`; variáveis `KHUB_API_URL`, `KHUB_PROCESS_ROLE`, `NEXT_PUBLIC_KHUB_DEMO` (os nomes `ORVYN_*` seguem aceitos como fallback até os ambientes migrarem); cookies `khub_access`/`khub_refresh` (todos precisam entrar de novo); fila `khub-maintenance` e chave `khub:worker:heartbeat`; chaves de localStorage/sessionStorage `khub:*`; metadado Stripe `khub_subscription` (o webhook ainda aceita `orvyn_subscription` de assinaturas antigas); banco via `db/035_khub_rename.sql`: papéis `khub_app`/`khub_service`, funções `khub_check_tenant_reference`/`khub_domain_outbox`, gatilho `khub_outbox` (RENAME: GRANTs, RLS e gatilhos seguem pelo OID). Logos antigos sem uso removidos (`ORVYNOS.png`, `logo-revenue.png`, wordmark ORVYN, `TopCenterLogo`).
- **Mantido de propósito:** domínios `orvyn.app`/`orvyn.dev` (e-mail e links de erro; trocar exige SPF/DKIM do domínio novo); migrações 000–034 (histórico com checksum; criam os objetos que a 035 renomeia); nomes físicos de infraestrutura (bancos `orvyn`/`orvyn_qa`, contêineres e volumes Docker): exigem tudo parado e entram num passo de manutenção separado. A pasta do repositório passou a `KHUB-OS` em 2026-11-09.
- **Deploy:** aplicar a 035 e trocar o usuário da `DATABASE_URL` para `khub_app` no MESMO deploy; atualizar variáveis `KHUB_*` no Vercel/servidores.
- **Verificação:** tsc/jest (API 497 testes), tsc/vitest/lint (web), `nest build` e `next build`, isolamento `db/002` e `db/034` com os papéis novos, E2E de agentes 51/51, cookies novos conferidos no login.

### ADR-0053 — Genna: Instagram do cliente por cliente MCP (OAuth com PKCE), publicação só com aprovação
- **Status:** Aceito (product owner, 2026-11-22: "crie uma integração com o genna que servirá para muitas funções como mostrar os dados do instagram do cliente para analisar métricas e conteúdos"; escolhas: cada empresa conecta, acesso completo com publicação por aprovação, painel em Marketing).
- **O que é o Genna:** plataforma de conteúdo para Instagram (métricas do perfil e dos posts, formatos que funcionam, radar do nicho, referências, criação de carrosséis, agendamento e publicação). Expõe um servidor MCP remoto em `https://mcp.genna.co` (Streamable HTTP, `mcp-protocol-version 2025-03-26`), protegido por OAuth: recurso em `/.well-known/oauth-protected-resource`, servidor de autorização `https://oauth.genna.co` (autorizar em `app.genna.co/oauth/authorize`, token e cadastro dinâmico em `oauth.genna.co`), escopos `mcp:read mcp:write mcp:publish`, cliente público (`none`) com PKCE S256.
- **Decisão:** o KHUB é CLIENTE MCP do Genna (primeiro cliente MCP do produto; o ADR-0049 é o KHUB como servidor). Sem SDK novo (stack congelada): `fetch` + JSON-RPC, aceitando resposta JSON ou SSE (`genna-mcp.ts`). Cada chamada abre uma sessão (`initialize` → `notifications/initialized` → `tools/*`), repassando o `Mcp-Session-Id`.
- **Dados:** nenhuma tabela nova. Credencial em `integrations` (`provider='genna'`, `credentials_encrypted` AES-256-GCM com `INTEGRATIONS_ENCRYPTION_KEY`): access token, refresh token, validade, escopos e o `client_id` do cadastro dinâmico (o refresh exige o mesmo). O `code_verifier` do PKCE viaja CIFRADO dentro do state assinado (HMAC com `JWT_SECRET`, 10 min, `fluxo:'genna'`), junto com o redirect URI usado; nada de PKCE fica no banco. Cadastro dinâmico feito uma vez por processo e redirect URI (`{WEB_URL}/api/integrations/genna/callback`).
- **Token:** renova quando falta menos de 1 min ou quando o Genna responde 401 (uma nova tentativa); renovações simultâneas do mesmo tenant compartilham a mesma promessa (refresh rotativo não se queima). Refresh recusado (400/401) → `status='error'`, `health='down'` e 409 `genna_nao_conectado`; Genna fora do ar (5xx) → 502 sem derrubar a conexão. O Genna não publica endpoint de revogação: desconectar apaga a credencial do KHUB.
- **Ferramentas:** o catálogo vem do Genna (`tools/list`, cache de 5 min por tenant, renovável pela tela) e é classificado de forma conservadora: só `readOnlyHint: true` é **leitura**; nome de publicar/agendar ou `destructiveHint` é **publicação**; o resto é **criação**. Leitura roda para quem vê a tela; criação só dono/admin com `confirmar: true`; publicação cria `nyro_action` (tool `genna_publicar`, registrada no executor da NICO via `registrarExtra`) e só executa quando um humano aprova em NICO > Aprovações. Escritas e publicações vão para `audit_logs`. Resultado do Genna é dado não confiável: a tela só renderiza (markdown sem HTML, imagens como data URL, links só `https`).
- **API:** `/v1/genna/{status, auth-url, callback (pública), conexao (DELETE), ferramentas, consultar/:nome, executar/:nome}`. Permissão: leitura/consulta = `contacts.read` (mesma régua das Redes); conectar/desconectar/executar = `integrations.manage`.
- **Web:** `/marketing/genna` (menu Crescimento › Genna) com Conectar/Desconectar, abas Métricas e conteúdos / Criar / Publicar, formulário gerado do JSON Schema de cada ferramenta e resultado em destaques numéricos, tabelas, texto, imagens e links (`lib/genna-formato.ts`). O Onboarding KROMA (ADR-0054) consome o mesmo `GennaService.consultar` para os relatórios de leitura.
- **Fora desta entrega:** ferramentas do Genna dentro da NICO (o product owner escolheu só o painel); telas dedicadas por métrica (dependem de uma conta Genna conectada para conhecer os formatos reais das respostas).

### ADR-0052 — Agenda do Avec sincronizada dentro da agenda do KHUB (salão que segue no Avec)
- **Status:** Aceito (product owner, 2026-11-19: "a cliente está usando o Avec ainda… todos os agendamentos do Avec têm que estar dentro do calendário do sistema pra IA poder ver e realizar o agendamento corretamente"). Origem: BUG-050.
- **Decisão:** o Avec é a agenda OFICIAL do Studio enquanto a equipe marcar lá. O KHUB lê o Avec (somente leitura) e mantém uma cópia viva em `agenda_compromissos` (`origem='avec'`, `externo_id`) e o expediente real por dia em `agenda_jornadas` (`db/077`). Escrever no Avec (criar/remarcar/cancelar) fica fora até um canário autorizado pela dona do salão.
- **Login sem navegador:** o Avec usa AWS Cognito (pool `us-east-1_D16vFV52G`, CUSTOM_AUTH com SRP e desafio `Avec;<conta>`) → `api.avec.beauty/auth/amplify/signin` → `admin.avec.beauty/<slug>/admin-mfe` (cookie do painel) → telas `listarTodosProfissionaisComAgendaAndServicos` e `carregarAgenda`. O SRP foi escrito com `node:crypto` (sem dependência nova; vetor de teste conferido com a biblioteca oficial da AWS). Usuário do Cognito = SSO id da conta (o pool não aceita o e-mail).
- **Chave:** o id da reserva no Avec é cifrado e muda a cada leitura; a chave é data + profissional + horário + serviço + cliente. Remarcar no Avec = some a chave velha (KHUB cancela) e nasce a nova.
- **Quando sincroniza:** a cada 10 min, hoje + 60 dias (job `avec-agenda` na fila `ads-sync`: nenhuma conexão Redis a mais); e AO VIVO antes de a IA oferecer horário (`ver_horarios_salao`, cache de 60 s) e antes de reservar (`reservar_horario_salao`, sempre relê; Avec fora do ar → a IA NÃO reserva e passa para a equipe).
- **Regras do sync:** linha `avec` que sumiu → cancelada; cópia antiga da exportação (sem origem, sem nota de IA, criada antes de ligar a integração) → adotada se bate profissional+horário, senão cancelada; reserva feita no KHUB (IA/equipe) nunca é apagada: é adotada só se a equipe lançou o mesmo atendimento no Avec (mesma cliente) e, se bate horário com outra cliente, é reportada como conflito. Bloqueios do Avec viram linhas "Bloqueio (Avec)". O sync não dispara automação (outbox marcado como processado) e linhas `avec` não recebem o lembrete D-1 do KHUB.
- **IA:** usa a jornada do Avec do dia (folga = sem horário) no lugar do expediente deduzido; não remarca/cancela atendimento `avec` (passa para a equipe); não marca o mesmo serviço duas vezes para a mesma cliente.
- **Credencial:** `PUT /v1/integrations/avec` (dono/admin) testa o login e grava cifrado (AES-256-GCM, `INTEGRATIONS_ENCRYPTION_KEY`) em `integrations` (`provider='avec'`). Sem a chave de cripto: 501 `config_required`.

### ADR-0051 — Caixa de operação (PDV) no Financeiro, estoque de produtos e senha do financeiro
- **Status:** Aceito (product owner, 2026-11-17, Studio da Beleza: "caixa que vai ficar na operação do cliente cadastrando as vendas"; forma de pagamento no lugar da observação; produto do estoque com autocompletar; profissional = colaboradoras com comissão; senha para Visão geral, Comissões e para editar/cancelar venda; publicar ao finalizar).
- **Dados (`db/075_caixa_pdv.sql`, aditiva):** `financeiro_transacoes` + `forma_pagamento` (dinheiro|debito|credito|pix), `parcelas` (só crédito, 1–24), `produto_id`, `quantidade`, status `cancelada` (+ `cancelada_em/por`, `motivo_cancelamento`); `estoque_movimentos` + origem `venda` e `transacao_id`; `financeiro_config` (RLS) com o **hash scrypt** da senha. `tenant_reference` passa a checar produto/profissional/lançamento.
- **Regras:** venda com produto baixa o estoque (saída com produto repõe); cancelar mantém o histórico, sai dos totais (que somam só `pago`), devolve o estoque e remove a comissão prevista (paga → 409). Comissão da colaboradora do catálogo (`profissionais.comissao_percent`, db/071) — as profissionais do salão não são usuárias; o campo "Profissional" do caixa lista só quem tem % > 0.
- **Senha:** `POST /financeiro/senha/verificar` devolve um desbloqueio de 30 min (HMAC com chave derivada do JWT_SECRET, preso à conta e à pessoa; 6 tentativas/10 min). Exigido por fluxo/caixa-atual (Visão geral), todas as rotas de comissão, PATCH/DELETE/cancelar lançamento e voltar recebido→pendente. Sem senha configurada nada muda. O caixa (listar/criar) segue aberto para a recepção. Rotas fora do Financeiro (dashboard, NICO, MCP) não passam pela senha.
- **Produtos:** importados do Avec a partir do histórico de vendas (relatório 0180: 383 produtos, preço da última venda); o cadastro do Avec com estoque ficou inacessível (o Avec exigiu troca de senha). Estoque começa zerado → entrada/contagem na aba Produtos e estoque.

### ADR-0050 — Daily da agência: Minhas tarefas, Todas as tarefas, Studio e Calendário
- **Status:** Aceito (product owner, 2026-11-16: "em exibição no modo agência, além de visão geral, clientes e equipe, implemente o daily igual o kroma-os.vercel.app/dashboard, com minhas tarefas, todas as tarefas, studio e calendário da agência").
- **Referência:** o Daily do KROMA OS (`DAILY KROMA/kroma-os`): tarefas por status/prazo com lista e quadro, Studio de conteúdo com aprovação, calendário com eventos + prazos + publicações.
- **Decisão de dados:** dado da AGÊNCIA, não de subconta: `db/074_agency_daily.sql` (`agency_tasks`, `agency_task_checklist`, `agency_task_comentarios`, `agency_events`, `agency_event_participantes`) com `agency_id`, **sem tenant_id e sem RLS**, mesmo modelo de `db/026` (agencies/agency_members). O isolamento é do `AgencyDailyService`: a agência sai SEMPRE da identidade da sessão (`AgencyService.escopo`), nunca de id vindo do cliente; tarefa/evento sem cliente = interno (toda a equipe vê); com cliente, só quem enxerga aquela subconta (mesma regra de Clientes/Equipe); visualizador só lê; excluir de vez = criador ou owner/admin (o normal é arquivar). Nenhum dado operacional de subconta (contato, conversa) é lido ou gravado.
- **Studio:** tarefa de tipo conteúdo (post, carrossel, reel, criativo) ganha plataformas, objetivo, legenda, hashtags, CTA, "exige legenda", data de publicação (≠ prazo) e etapa de aprovação (em produção → revisão interna → aguardando cliente → ajustes → aprovado → publicado). Publicar conclui a tarefa e marca `publicado_em`; sair de publicado reabre. Regras em `daily.catalogo.ts` (`transicao`).
- **API:** `/v1/agency/daily/{base,tarefas,tarefas/:id,studio,checklist/:id,comentarios/:id,calendario,eventos}`; corpo validado com Zod no service (`.strict()`, campo desconhecido = 400). Calendário: janela máxima de 62 dias. `@SkipAudit` (dado de agência; o interceptor gravaria no tenant da sessão).
- **Web:** grupo "Daily" no `AGENCY_NAV` → `/agency/tarefas/minhas`, `/agency/tarefas`, `/agency/studio`, `/agency/calendario` (route group `agency/(daily)` com `DailyProvider`: gaveta de tarefa por `?tarefa=` e criação rápida). Arrastar e soltar nativo (sem lib nova). "Aguardando cliente" usa o rosa do token `--ch-instagram` porque a marca é limão no escuro e roxa no claro.
- **Fora do escopo desta entrega (KROMA tem):** anexos/arquivos e miniatura do conteúdo, cronômetro de horas, notificações e menções, histórico de atividade, editor rico (descrição é texto simples).
- **Verificação:** jest 31/31 em `src/agency` (12 novos em `daily.catalogo.spec.ts`); E2E real na QA isolada 56/56 (permissões por papel, membro restrito por subconta, isolamento entre agências, transições, calendário); UI em Chrome real 11/11 (criar por modal e inline, concluir, arrastar no quadro e no Studio, gaveta, evento, celular sem rolagem lateral), claro e escuro.

### ADR-0049 — Conector MCP personalizado: Claude e ChatGPT operando o KHUB (OAuth 2.1)
- **Status:** Aceito (product owner, 2026-11-16: "crie um conector MCP personalizado que pode ser conectado tanto no Claude quanto no ChatGPT… com acesso a configurações da plataforma, gerenciar agentes, analisar funcionalidades, testar"; escolhas: login OAuth com a conta KHUB, ações sensíveis pedem aprovação no KHUB, deploy autorizado).
- **Decisão:** módulo `apps/api/src/mcp` = servidor MCP remoto (Streamable HTTP, **sem sessão**, respostas JSON, JSON-RPC 2.0) em `POST /mcp` + servidor de autorização OAuth 2.1 próprio: descoberta RFC 9728 (`/.well-known/oauth-protected-resource[/mcp]`) e RFC 8414 (`/.well-known/oauth-authorization-server`, espelho em `openid-configuration`), cadastro dinâmico RFC 7591 (`/oauth/register`), `/oauth/authorize` (PKCE S256 obrigatório), `/oauth/token` (authorization_code + refresh_token rotativo), `/oauth/revoke`. Essas rotas ficam **fora do prefixo /v1** (exclude com caminhos exatos em `main.ts`). Claude.ai e ChatGPT só aceitam OAuth ou "sem autenticação" — chave em cabeçalho não serve.
- **Consentimento:** `/oauth/authorize` assina o pedido (HMAC com chave derivada do `JWT_SECRET`, 15 min) e manda para `WEB_URL/conectar-ia/<pedido>`; a pessoa entra no KHUB (middleware) e **só dono/admin** autoriza. Negar volta ao app com `access_denied`. Redirect não cadastrado nunca é seguido (página de erro, sem open redirect).
- **Tokens:** opacos, só o sha256 no banco (`db/072`: `mcp_clientes` — registro da plataforma, sem tenant e sem dado de cliente; `mcp_conexoes` e `mcp_tokens` com RLS `tenant_rw`). Código 5 min uso único; acesso 1 h; renovação 60 dias, uso único (rotação). Resolução por UMA função SECURITY DEFINER (`mcp_resolver_token`), mesmo padrão das API keys (db/019). O papel é relido a cada chamada: perder admin ou revogar a conexão corta na hora.
- **Ferramentas:** as da NICO (menos memória/plano internos) + gestão da plataforma: visão geral, configurações, auditoria, aprovações; agentes (listar, ver, atividade, analisar, criar, editar **rascunho**, testar no **simulador**, publicar, ativar/pausar, canais/padrão); automações (ver grafo, execuções, catálogo de nós, testar no número de teste, salvar rascunho, publicar). Tudo pelos serviços (mesma validação/RLS/auditoria, `actor_type='mcp'`).
- **Human-in-the-loop:** ferramenta sensível (publicar/ativar/pausar agente, canais do agente, publicar/ativar/pausar automação, enviar mensagem, mover etapa, instalar automação/blueprint) **não executa**: cria `nyro_actions` pendente (`[App] resumo`, 24 h) e devolve "aguardando aprovação". O humano aprova em NICO › Aprovações; a execução passa pelo `ToolExecutorService` (as tools próprias do MCP são registradas nele como "extras", fora do catálogo que o modelo da NICO recebe).
- **Limites:** 120 chamadas/min por conexão; cadastro anônimo limitado a 30/h por IP; resultado de tool cortado em 60 mil caracteres.
- **Config:** `API_PUBLIC_URL` (opcional; sem ela a origem sai de `x-forwarded-proto/host`). `WEB_URL` e `JWT_SECRET` já existentes.
- **Verificação:** `db/072_mcp_conector_isolation_test.sql` verde; jest 1500/1500 (20 novos em `src/mcp/mcp.spec.ts`); E2E real `scripts/qa/mcp-e2e.mjs` 39/39 (descoberta → cadastro → consentimento → PKCE → initialize → tools → aprovação → refresh → revogação, isolamento entre subcontas).

### ADR-0048 — Modo do agente de IA (Desativado / Sugestivo / Piloto automático), como no GHL
- **Status:** Aceito (product owner, 2026-11-13: "quando eu ativar a IA tem que estar ativa pra todos os clientes; se eu colocar como sugestivo a IA não vai funcionar [sozinha] aí dentro da automação de Novo Lead [o nó ativa]").
- **Decisão:** `agents.config.modo` ∈ {`automatico`, `sugestivo`} (raiz do config, padrão `automatico` = comportamento anterior; sem migração). Desativado = `status !== 'ativo'`. Helper sem Zod em `common/modo-agente.ts` (CRM e agents leem; nenhum importa o interno do outro).
- **Piloto automático:** a conversa nova nasce com a IA (agente principal do canal). Ao ativar ou salvar o principal em piloto automático, toda conversa aberta do canal com humano, sem responsável e sem transferência da IA passa para a IA — "ativa para todos os clientes". A IA só fala quando o cliente mandar a próxima mensagem (nada dispara em conversa antiga).
- **Sugestivo:** a conversa nasce com humano; a IA sugere no Inbox e só responde onde foi ativada (nó "Ativar IA" da automação ou botão "Ativar IA" na conversa). Trocar de piloto automático para sugestivo tira a IA das conversas desse agente (voltam para humano com o agente guardado).
- **Limite do canal:** a API pública da Stevo (SM v2) só envia texto e mídia; botões/listas interativas do GHL (`#list|...`) não existem nela. Fluxos com "botões" usam opções numeradas + "Esperar resposta" + condição pela resposta. Botão interativo real só na API oficial da Meta (`cloud_api`).

### ADR-0047 — Editor de automação na horizontal, vários gatilhos, gatilho de data e hora; hora real e estado da IA nas conversas
- **Status:** Aceito (product owner, 2026-11-13: "horário das conversas irreal… como eu sei que a IA está ativa na conversa?… nó que ative em um momento específico… várias possibilidades de ativação, gatilho colocar tag… automação na horizontal igual ao avançado do GHL").
- **Editor:** layout esquerda → direita (`organizarHorizontal`): gatilhos numa coluna, passos em colunas, ramos abrindo no eixo Y. Fluxo salvo na vertical abre já na horizontal (`pareceVertical`), só grava quando a pessoa mexe. "+ Adicionar gatilho" no pé da coluna (nó de interface fora do grafo salvo). O motor já aceitava N gatilhos por fluxo (cada nó `gatilho.*` dispara sozinho); formato do grafo e tipos de nó não mudaram.
- **Gatilho de data e hora:** `gatilho.agendado` ganhou `frequencia: 'uma_vez'` + `data` (AAAA-MM-DD), no fuso do fluxo. Reaproveita `workflow_schedules`, lease, dedupe e tolerância; depois de disparar (ou com data passada) a linha da agenda sai. Retrocompatível: recorrências antigas seguem iguais.
- **Biblioteca:** template `atendimento-varios-gatilhos` (tag, formulário ou palavra-chave no WhatsApp → responde, marca e cria tarefa).
- **Hora das conversas:** `hora`/`ultima_hora` eram texto no fuso do servidor (UTC no Render: +3h). API passa a gerar no fuso da operação (`APP_TIMEZONE`, padrão America/Sao_Paulo, `common/hora.ts`) e a lista devolve `ultimaMensagemEm` (ISO da última mensagem); o web formata do ISO no fuso do navegador (`lib/hora-conversa.ts`, estilo WhatsApp: hora/Ontem/dia da semana/data). Textos antigos ficam só como último recurso.
- **Estado da IA na conversa:** selo sempre visível — "IA ativa · agente", "IA pausada" (agente inativo) ou "Humano · IA não responde" — com "Ativar IA"/"Devolver para a IA". O estado nasce com a conversa (agente padrão do canal); conversa criada antes de ligar o agente fica com humano até alguém ativar.
- **Verificação:** jest de automações 201+, E2E em QA isolado (template com 3 gatilhos instala, tag inicia o run, "uma vez" dispara exatamente uma vez na hora marcada; IA responde no simulador; assumir/devolver), capturas reais em Chrome headless (claro e escuro).

### ADR-0046 — NICO: agente único, streaming, memória em camadas, rotinas que rodam, pesquisa na web
- **Contexto:** a NICO tinha roteador em 4 agentes (cada um com parte das tools), resposta só no fim, memória manual de 30 fatos, rotinas que eram gravadas e nunca executadas, relatórios sem tela, guardrail que descartava a resposta inteira e proxy web que cortava tudo em 25 s.
- **Decisão:** (1) **agente único** com todas as tools quando o modelo é forte (Claude); modelo local segue roteado (`NICO_AGENTE_UNICO`). (2) **Streaming SSE** (`POST /nyro/chat/stream`) com texto, passos e plano ao vivo; em nicho regulado (saúde/jurídico/contábil) o texto só sai depois do guardrail, nunca antes. (3) **Cache de prompt** da Anthropic no bloco estável + tools; data e memória no bloco dinâmico. (4) **Memória:** fatos da conta + preferências por usuário (`pref.<identityId>.`), resumo de conversa longa (`resumo.<conversationId>`), anexos antigos encolhidos, **autoaprendizado** (fatos `origem=auto`, confiança < 1, nunca sobrescrevem o que o usuário ensinou) e aprendizado por aprovar/recusar (`decisao.<tool>`). Sem migração: usa `nyro_memory` (origem, confiança). (5) **Rotinas executam** (fila BullMQ `nico-rotinas`, tick 60 s, reserva atômica por `proximo_em`, tolerância de 6 h, ação sensível vira aprovação) e notificam (`notifications.tipo='nico'`). (6) **Pesquisa na web** via Firecrawl (`pesquisar_web`, `ler_pagina`), gated por `FIRECRAWL_API_KEY`; conteúdo da web entra como dado em `<web>`. (7) **Guardrail** age por linha, deixa passar citação "do que evitar" e devolve a resposta saneada em vez do texto fixo. (8) Rotas e telas de **relatórios** (.md/PDF) e **rotinas**; insights proativos por regra (`GET /nyro/insights`, sem LLM). (9) **Eval:** golden set de 30 conversas (`pnpm nico:eval`, tenant de teste obrigatório).
- **Consequências:** custo de bastidor (1 chamada barata por turno para memória; desligável). Google Ads/TikTok seguem sem tool (dependem de credencial OAuth). O proxy `/api/v1/nyro/chat/stream` é rota própria (o proxy genérico bufferiza).

### ADR-0045 — Acesso por módulo para colaboradores da subconta
- **Status:** Aceito (product owner, 2026-11-12: "convidar os colaboradores da empresa do cliente… configuro ao que ele vai ter acesso, dash, leads, pipelines, conversas e agenda… depois dou acesso pra ele à IA… o sistema vai estar aberto dentro da loja do cliente").
- **Decisão:** o papel (owner/admin/manager/member/viewer) continua dizendo o que a pessoa FAZ; os MÓDULOS dizem o que ela VÊ. Catálogo: dashboard, leads, pipeline, conversas, agenda, tarefas, ia (NICO + Agentes de IA + conhecimento), automacoes, analytics, financeiro. Guardado em `users.permissoes.modulos` (coluna que já existia, sem uso); ausente = sem restrição (comportamento anterior). Owner/admin nunca são restritos.
- **Convite:** `invites.permissoes` (db/065, aditiva) leva os módulos escolhidos e vira `users.permissoes` no aceite: o colaborador já entra restrito. Padrão da tela: papel Atendente com Dashboard, Leads, Pipeline, Conversas, Agenda e Tarefas; IA desligada, liberada depois por pessoa.
- **Onde bloqueia:** (1) API, no `PermissionsGuard`, por `modulosDaRota` (`auth/modulos.ts`); o `JwtAuthGuard` lê os módulos a cada request, então tirar acesso vale na hora. Leitura de cadastro compartilhado (contato, negócio, compromisso) é liberada para os módulos que a mostram na própria tela; escrever exige o módulo dono. (2) Tempo real: eventos `message.*`/`conversation.*` (levam texto do cliente) vão para a sala `tenant:{id}:conversas`, só para quem tem Conversas (avaliado na conexão). (3) Busca ⌘K não consulta o que a pessoa não vê. (4) Web: menu filtrado, `PortaoDeModulo` na rota, balão da NICO só com IA.
- **Correção junto:** escrever na Agenda (`compromissos`) caía no padrão `organization.manage` e o atendente não conseguia agendar; agora é `agenda.write` (member+). Páginas de agendamento seguem admin.
- **Limites conhecidos:** mudança de módulo vale no socket só na próxima conexão; o menu/rota do front atualiza no próximo `/auth/me` (recarregar). Equipe da agência que entra na subconta não é afetada (sem `permissoes`).

### ADR-0044 — Teste de automação nunca afeta a operação; modo simples com a NICO
- **Status:** Aceito (product owner, 2026-11-11: "teste real, com dados reais, imagens e dados, mas nunca afeta a operação do cliente, seja mensagem ou disparando alguma automação; qualquer teste sempre vai ser no número de teste").
- **Substitui** a regra anterior do `WorkflowsService.testar` ("as ações acontecem de verdade; simulação mente").
- **Decisão — sandbox de teste no motor:** o contexto da execução carrega `teste: true` (do `testar` e da coluna `workflow_runs.teste`). `ExecutorService.emTeste` decide nó a nó: mensagem ao contato (`acao.enviar_sms`) e aviso à equipe vão de verdade, com os dados reais do contato, **só para `AUTOMATION_TEST_PHONE`** (env, vale também em produção; vazia = não envia e diz o que falta), e nunca entram no Inbox do cliente. CRM (tag, oportunidade, etapa, tarefa, nota, contato, dono, não perturbe), e-mail, webhook, pedir avaliação, remover de fluxo e acionar outro fluxo são **simulados**, com o que *seriam* gravado no log do passo (a tag simulada vale no contexto, então a condição seguinte enxerga). Esperas são puladas, "esperar resposta" segue por "não respondeu", e o `RunsService` não encadeia nem espera janela num teste. **À prova de futuro:** ação `acao.*` sem tratamento em `emTeste` é simulada por padrão; só IA, variável e formatar rodam.
- **Decisão — modo simples:** `POST /automations/nico/montar` recebe a conversa e o modelo devolve um **plano** (gatilho + passos, sub-listas só em nós de saídas nomeadas), nunca o grafo. O servidor valida cada passo com o mesmo Zod do catálogo, recusa `stageId` inventado, usa só uma lista fechada de nós (sem ids desconhecidos), monta o grafo com layout e grava **rascunho**; com plano inválido, uma segunda tentativa com os erros. Falta informação essencial → a NICO pergunta em vez de inventar. Audit `actor_type='nyro'`. Publicar segue humano. `POST /automations/nico/workflows/:id/testar` roda o teste com o contato escolhido ou o mais recente com telefone.
- **Front:** editor com seletor Simples/Avançado (`?modo=simples`); logos reais por nó (`components/automations/marcas.tsx`: WhatsApp, Instagram, Meta, TikTok, Google, NICO, KHUB); a sidebar fica recolhida no quadrado do KHUB dentro do editor (o editor começa depois dela, não a cobre mais); lista de automações em linhas com a cadeia de logos (`tipos` em `GET /workflows`).

### ADR-0043 — Identidade Kroma no KHUB: LP do produto e CRM escuro por padrão
- **Status:** Aceito (product owner, 2026-11-10: "mesma id visual e mesma qualidade da LP da Kroma", "tire tudo do Orvyn Revenue OS"; escolhas: *nova LP do produto KHUB* e *escuro Kroma como padrão*).
- **Contexto:** o KHUB é a plataforma da KROMA (a LP da Kroma o apresenta assim). A LP pública do KHUB ainda era a do "Revenue OS", com outra linguagem visual, e logos do app traziam "by ORVYN ai".
- **Decisão:**
  1. **LP do KHUB em "/" com a identidade da Kroma** (correção do product owner, 2026-11-10: "a LP da Kroma é uma, a LP do KHUB é outra… volte a LP do KHUB como principal, mas já com a nova id"). A LP é a do próprio KHUB (conteúdo e seções de produto de sempre, sem marca da Kroma); muda só a identidade visual: tokens `--lp-*` na paleta Kroma (ink `#050505`, lima `#b6ff00` em ação e foco, novos `--lp-violet*` para inteligência), títulos 700–800 com tracking da Kroma, `.lp-serif` (Instrument Serif itálica) na palavra de destaque, `.lp-eyebrow` (ponto lima), botões em pílula com círculo de seta, cabeçalho ink ao rolar. Hero com o K de vidro violeta e lima sobre o campo de frequência (`components/landing/FrequencyField.tsx`). As 10 capturas de produto (`public/lp-revenue/product/*-dark.png`) foram refeitas no tema escuro, na conta de DEMONSTRAÇÃO Forma Casa (dados fictícios; Conversas, Campanhas e detalhe do lead no modo demo, com o selo "Dados de demonstração"), porque as antigas mostravam "ORVYN Revenue OS". Movimento segue em framer-motion (sem GSAP/Lenis na stack congelada).
  2. **CRM escuro Kroma por padrão:** `<html data-theme="dark">`; tokens escuros mapeados para a paleta Kroma (`--base-*` ink, `--brand` lima, novos `--violet`/`--violet-glow`/`--violet-soft`/`--violet-border`); botão de IA violeta; títulos e KPIs 700 com tracking −0,035em; utilitários `.t-accent` (serifa itálica) e `.eyebrow` (rótulo com ponto lima). O claro segue disponível nas preferências.
  3. **Fontes locais** em `public/fonts` (OFL): Manrope variável e Instrument Serif (itálica e regular), subconjunto `latin` (cobre o português). O build não baixa fonte.
  4. **Orvyn fora do que é visível:** logos `khub-logo*.png` sem a assinatura; e-mails de convite e de redefinição sem "Revenue OS"; `type` dos erros RFC 7807 vira `urn:khub:error:<código>` (não inventa domínio). **Mantido de propósito** (compatibilidade, ADR-0041): fallbacks `ORVYN_*`, metadado `orvyn_subscription`, papéis `orvyn_*` no DEV e o remetente padrão `no-reply@orvyn.app` quando `SMTP_FROM` não está definido (produção define `SMTP_FROM`).
- **Adendo 2026-11-10 (tema claro, pedido do product owner):** o claro existia nas preferências mas não tinha tokens (escolher "Claro" não mudava nada). Agora `:root[data-theme='light']` em `globals.css` define o tema: superfícies brancas; **o topo da sidebar (`.sidebar-brand`) continua escuro com a logo branca** (a logo não inverte); **tudo que é lima no escuro (ação, iluminação do ambient, barra do item ativo, `--khub-lime*`) vira o roxo da logo** — `#7B2EFF` para texto/ação (lê sobre branco, `.btn-primary` com texto branco) e lilás `#A66BFF` para luz. Atalho sol/lua na topbar e Configurações › Tema gravam `users.prefs.theme` (padrão: escuro). Cópia em `localStorage` (`khub-theme`) só para pintar sem piscar via script no `<head>`; login, cadastro e LP ficam sempre escuros.
- **Consequências:** telas que usavam o tema claro como referência passam a ser revisadas no escuro. A LP da Kroma (repositório próprio, `LP - KROMA`) e o deploy dela são independentes do KHUB e não fazem parte deste ADR.

### ADR-0038 — KHUB Agent Intelligence Platform (expansão do Agent Manager)
- **Status:** Aceito (diretiva do product owner, 2026-11-07). Estende o ADR-0030; não cria aplicação paralela.
- **Decisão:** módulo `apps/api/src/agents` passa a ter Intelligence Core (análise por structured outputs com fallback determinístico, regras SE/ENTÃO, conhecimento por agente com confiança/conflito, guardrail + naturalidade, fragmentação semântica), Action Engine com 19 ferramentas (aprovação humana configurável, log por execução), fila de entrega própria (`agent-delivery`, verdade no Postgres, ordem e idempotência por bloco), Follow-up Intelligence (8 estratégias, janela/fuso, parada), Memory Engine (curto/longo/operacional, retenção), Customer Intelligence Profile (fatos com origem/confiança/status), Learning & Evaluation (propostas que só tocam comportamento/regras, avaliação de regressão com juiz), versões publicadas com rollback, simulador e analytics. Configuração estendida em `agents.config` (JSONB validado por Zod).
- **Compatibilidade:** migração aditiva `db/034`; agente sem versão publicada continua usando a configuração viva; `config` vazio = padrões que reproduzem o comportamento anterior.
- **Detalhes:** `docs/AI_AGENT_ARCHITECTURE.md` · status: `docs/AI_AGENT_IMPLEMENTATION_STATUS.md`.

### ADR-0039 — Modo real é o produto: sem tela vazia fixa, sem botão morto, números corretos
- **Status:** Aceito (product owner: "frontend ta uma merda… com cara de amador", 2026-11-08/09).
- **Achado da auditoria (logado, com volume real no QA):** várias telas eram caprichadas só no modo demo e vazias no real. Conversas mostrava sempre "Nenhuma conversa ainda" (o inbox real estava em `/inbox`, fora do menu); Agenda real nunca listava compromissos; o card de receita do dashboard era um vazio fixo; Analytics ignorava o CRM; KPIs contavam negócios ganhos/perdidos como abertos e misturavam etapas de todos os funis; a lista de conversas trazia TODAS as mensagens de todas as conversas a cada evento; abrir conversa não zerava não lidas; 74 botões sem ação (os do modo real foram ligados ou removidos).
- **Decisão:** (1) regras do funil em `apps/api/src/crm/funil.ts` com testes: funil principal (o pedido ou o com mais abertos), só ABERTOS no quadro e nos KPIs, conversão = ganhos/fechados (ou etapa final declarada quando não há fechamentos), receita mensal real; `GET /crm/pipeline?pipelineId=` + seletor de funil. (2) Inbox real em `/conversas` (`components/inbox/InboxAtendimento.tsx`): lista leve, `GET /crm/conversations/:id/messages` (300 mais recentes), `POST /crm/conversations/:id/lida`, filtros, troca IA↔equipe, celular; `/inbox` redireciona. (3) Agenda real com criar/status/remover; Novo Lead, Nova oportunidade e card do Pipeline abrindo o negócio; Analytics com seção Comercial. (4) Controle sem backend não aparece no modo real (filtros de Analytics, "Nova conversa"); "Campanhas" aponta para Automações; "Esqueci a senha" explica o caminho. (5) Frase de efeito do cabeçalho deixa de ser exibida; escala do gráfico proporcional; `moedaCurta` com 1 casa abaixo de 10 mil.
- **Regra daqui em diante:** toda tela real termina em dado real, estado vazio verdadeiro ou erro com ação; nenhum controle visível sem ação.

### ADR-0037 — Papel de parede KHUB (branco, roxo e verde) e sem travessão na interface
- **Status:** Aceito (product owner, 2026-11-08). Emenda o ADR-0036 no fundo; vence a linha "prefira CSS puro" do brief por pedido explícito do dono do produto.
- **Papel de parede:** o oficial `khub-background.png` (branco dominante, vidro roxo e verde) em versão leve `public/khub-fundo.jpg` (190 KB) passa a ser o fundo do app (sob véu branco de 50 a 72%), do painel do login, do convite de agência, da transição de troca de operação e do topo da Biblioteca. Saem TODOS os fundos roxos: `Background-login.png` (login, convite, configurações da agência, transição), o vídeo de cristal roxo (`KhubBrandMotion`) do login, da Biblioteca e a opção `motionAccent` do cabeçalho de página. Textos sobre o fundo passam a escuros (`#171526` / `#6B6980`). O componente de vídeo continua só na landing page.
- **Sem travessão:** nenhum "—" em texto visível da interface autenticada, login, termos, privacidade e landing (152 trocas em 51 arquivos): aposto vira vírgula, separador vira " · ", valor vazio vira "-". Comentários de código não mudam.

### ADR-0036 — KHUB Premium: design system claro, vidro funcional, luz pontual
- **Status:** Aceito (brief "KHUB — Premium Product Redesign", 2026-11-07/08). **Revisa ADR-0033, 0034 e 0035** (o brief é a direção mais recente e explícita).
- **Paleta (tokens, mesmos nomes):** base `#F8F8FC`, superfícies `#FFF`/`#F4F3F9`, texto `#171526`, texto secundário `#6B6980` (o `#77758A` do brief escurecido um passo para AA 4.5:1), borda `rgba(91,75,130,.12)`; roxo `#792EFF`/`#963EFF`/`#B28AFF`/`#F0E8FF`; verde `#A7F044`/`#C7FF79`/`#F0F9E6` (`--lime-edge #8FD42A` para aparecer sobre branco).
- **Regra de cor:** roxo = inteligência (ação principal, foco, estado ativo); verde = crescimento (indicador lateral do item ativo, sinais de resultado). Nunca os dois no mesmo elemento; nada de borda limão ou brilho em toda superfície (0033 revogado nisso — aliases `--edge-lime*`/`--glow` mantidos, agora neutros, para não quebrar código).
- **Vidro:** só shell (sidebar/topbar), StatCards, popovers, modais — `rgba(255,255,255,.72)`, `blur 24px saturate 145%`, aro branco luminoso + contorno neutro. Conteúdo (tabelas, Kanban, cards de seção) quase sólido (`.9`, blur 16) — legibilidade antes de efeito. Sombras realistas `rgba(40,25,80,.04–.16)`.
- **Fundo:** CSS puro e estável (radiais roxo 9% a 5%/8%, verde 10% a 96%/90%, centro branco) — sai a imagem do 0035 (o brief proíbe imagem pesada de fundo) e a textura de pontos.
- **Tipografia:** Inter primeiro (já via `next/font`), títulos 30px/650, pesos 400–650 (`font-extrabold/black` → `semibold` na UI autenticada; logo preservada).
- **Shell:** navegação agrupada (Operação, Crescimento, Inteligência, Agência, Conta — `NavItem.grupo` + `agruparNav`), sidebar recolhível (76px, só ícones com `title` e `sr-only`; gaveta mobile nunca recolhe; preferência em `localStorage` como conveniência), logo KHUB / símbolo KHUB recolhida; sino de notificações com ação honesta (aviso de que a central ainda não existe — sem badge fictício).
- **Movimento:** entrada 300ms/6px escalonada até 200ms; hover de card 2px; contador de KPI uma vez; reflexo sutil do ponteiro só nos StatCards; modal com desfoque 6px. Removidos: borda giratória, ícone flutuando, fundo respirando, reflexo varrendo o botão, pulso do contador, traço decorativo sob o título, vídeo do cabeçalho do dashboard.
- **Consistência:** 9 telas fora da moldura padrão passaram a `max-w-[1680px] px-4 lg:px-8` com título `t-display`; Configurações sem faixa escura e com o mesmo estado ativo da sidebar; assinatura do rodapé fixa no pé; Kanban esmaece na borda; KPIs em 2 colunas no celular.
- **Verificação:** typecheck, lint (só avisos antigos), 33 testes, `next build` de produção; revisão visual LOGADA em 20 telas (desktop 1440 + celular 390) num ambiente de QA isolado (banco `orvyn_qa`, conta de teste), sem erro de console nem requisição falha.

### ADR-0035 — Plano de fundo oficial atrás do app (o vidro refrata a marca)
- **Status:** Aceito (product owner, 2026-11-07). Emenda o ADR-0033/0034 no fundo do app.
- **Problema:** o usuário viu o app "cru, nada muda" — o fundo era só degradê desfocado (90px) e os cards quase opacos (86%): o vidro não tinha o que refratar. A imagem oficial (`plano de fundo.png` = `public/khub-background.png`, vidro roxo + limão) não era usada.
- **Decisão:** `.ambient-bg` mostra a imagem (versão leve `public/app-fundo.jpg`, 148 KB, gerada da original sem alterá-la) com deriva lenta; véu de legibilidade em degradê (8% topo → 42% base) + facho roxo; escuro aplica `brightness(.38) saturate(1.35)` e véu mais denso. Cards ficam translúcidos (`--mat-thick` 74% claro / 72% escuro, desfoque 24px) para a imagem aparecer através do vidro. Textura de pontos reduzida (competia com a imagem). "Reduzir transparência" continua deixando as superfícies opacas.

### ADR-0034 — Camada de experiência: luz que reage, bordas vivas, coreografia
- **Status:** Aceito (product owner, 2026-11-07). Estende o ADR-0033 (luz roxa & aro limão).
- **Pedido:** "melhore todo o frontend… iluminação, bordas, animação… que não seja só um sistema e sim uma real experiência".
- **Decisão (sistema inteiro, nada por página):** holofote roxo que segue o ponteiro em `.card`/`.card-crystal` (`GlassLight` agora grava `--lg-x/--lg-y` também nos cards); borda viva (anel cônico limão→violeta girando) no hover dos KPIs e permanente no card de login; entrada em cascata dos cards em `#conteudo` (`animation-fill-mode: backwards`, para não brigar com o hover do framer-motion); contador nos KPIs (`ContaNumero`: anima só o número, termina no texto original, leitor de tela recebe o valor final); reflexo que atravessa o `.btn-primary`; topbar acende ao rolar; ícone do menu reage ao hover e contador de não lidas pulsa; linha de tabela marcada em limão; foco por teclado limão + halo roxo; skeleton com brilho roxo; ícone do estado vazio flutuando; traço roxo→limão sob o título de página; escurecimento de modal puxado ao violeta; fundo "respira".
- **Regras:** animação só com `transform`/`opacity`/propriedades registradas (`@property --spot`, `--ring-angle`) — sem layout thrash; progressivo (sem JS/`@property` fica estático e íntegro); "Reduzir movimento" desliga tudo (regra global + checagem no contador); nada de animação em loop em área de leitura, exceto o contador de não lidas (sinal de atenção) e o card de login.
- **Verificação:** 4 testes do contador (33 no front), typecheck, lint; prova visual claro/escuro e login real.

### ADR-0033 — Luz roxa & aro limão: identidade visual do produto
- **Status:** Aceito (product owner, 2026-11-06). **Emenda o ADR-0029**: substitui a regra 3 ("luz, não cor") — o material Liquid Glass, as camadas e a concentricidade continuam.
- **Pedido:** front "muito cru"; mais profissional e gráfico, com iluminação roxa e bordas verdes. Escolhas do usuário: **base clara** com acentos (escuro segue opcional no botão de tema) e **verde-limão KHUB**.
- **Decisão:** o roxo da marca vira LUZ (facho e halos no `ambient-bg`, textura de pontos `.ambient-grid`, sombras `--sh-*`/`--lg-shadow` tingidas de violeta, `--glow`/`--glow-lg`, luz vazando no canto dos `.card-crystal`, brilho no `.btn-primary` e no item ativo) e o limão vira ARO (`--edge-lime` em `.card`, `.card-crystal`, sidebar/topbar, sheets, cabeçalho de `.tbl`, foco de campo, thumb do `.segbar`, barra do item ativo, sublinhado roxo→limão da `.tab`).
- **Contraste:** o limão puro `#d9ff5a` some sobre branco (~1.1:1); no claro o aro usa `--lime-edge #a3d40f` (68%); no escuro o puro a 30%. Limão **nunca** é cor de texto nem de estado semântico (`--success` segue sendo o verde de "bom"). Reflexo limão desligado no escuro (vira verde-barro).
- **Gráficos:** mesma paleta validada (hue e regra de intensidade sequencial inalterados); só acabamento — degradê do mesmo hue, brilho na linha de receita, cantos arredondados, marcador com anel limão.
- **Prova visual:** página com o CSS compilado, claro e escuro, antes do merge.

### ADR-0032 — Stevo API de gestão como transporte de WhatsApp por subconta
- **Status:** Aceito e implementado (2026-11-06). Concretiza ADR-0031 (Stevo = só transporte).
- **Decisão:** cada subconta tem sua instância Stevo, vinculada em `integrations` (provider `stevo_api`, `external_business_id` = id da instância) e, na Stevo, `external_ref` = tenantId. Roteamento do webhook de conta por função `SECURITY DEFINER` (`db/032`), igual a 008/024. Envio por tenant via `POST /v1/instances/{id}/messages` com `Idempotency-Key`; sem vínculo, comportamento anterior (Evolution/Stevo legado).
- **Webhook de conta** (`POST /v1/webhooks/stevo-api`): HMAC-SHA256 de `timestamp.corpoCru` (mesma semântica do `verifyWebhook` do SDK oficial: 300 s, segredo atual+anterior, tempo constante); dedupe por `event_id` no outbox; `raw` da Stevo não é guardado (minimização); instância sem vínculo → 200 ignorado; `external_ref` divergente → descartado. Worker processa `message.received` (inbox, sem grupo/`from_me`), recibos `sent/delivered/read` (status só avança), `failed`, e `instance.*` (estado da integração).
- **Pareamento real** = `connected && logged_in` (`/connection`); `connected` sozinho só indica servidor.
- **Sem dependência nova:** contrato lido do `openapi.yaml` e dos tipos do pacote `stevo-sdk` (inspecionado, não instalado); HTTP via `fetch`, HMAC via `node:crypto`.
- **Operação** até existir o painel da agência: `apps/api/scripts/operar/stevo.mjs` (me, instancias, criar-cliente, vincular, webhook, webhooks) chamando os mesmos serviços (RLS, auditoria).

### ADR-0031 — O Revenue OS substitui o GoHighLevel (sem integração)
- **Status:** Aceito (product owner, 2026-11-06). Emenda o ADR-0015 (que já tratava o GHL só como benchmark de motor/UX) e encerra a decisão pendente 5 de `docs/revenue-audit/18`.
- **Decisão:** a KROMA desliga o GHL; o Revenue OS é a **fonte oficial e única** de agência, subaccounts, usuários/permissões, CRM (lead → atendimento → qualificação → oportunidade → negociação → proposta → venda → pós-venda → recompra), conversas, agentes, conhecimento, automações, follow-ups e indicadores. **Proibido:** integrar, sincronizar ou depender do GHL (OAuth, Agency Account, Locations, webhooks) ou trocá-lo por outro CRM externo.
- **Stevo = só transporte de comunicação:** instâncias, conexão/QR/status, envio, recebimento, webhooks, status de entrega, reconciliação. A inteligência (agentes, prompts, modelos, tools, memória, RAG, regras, transferência, follow-up, logs, avaliação) é do Revenue OS. Stevo AI, GHL/Agency, disparo em massa, grupos e StevoVoice **não** são usados — os escopos correspondentes devem sair da chave.
- **Auditoria de dependências (2026-11-06):** zero código funcional de GHL (sem OAuth, rotas, webhooks, env, pacotes, tabelas ou colunas, testes de integração, texto visível). Restam só 9 comentários de código citando o GHL como referência de UX e menções de benchmark em PRD/ADR-0015 — não são dependência. Nada a remover de forma destrutiva no código ou no banco.
- **Consequência real:** a dependência de GHL está nos **dados operacionais da KROMA** (clientes que hoje vivem lá). Migração = **exportação do GHL + importação no Revenue OS** (CSV com mapeamento, dedupe e origem `migracao_ghl`), nunca integração por API. Vira escopo da sprint de CRM (importação), antes de desligar o GHL.

### ADR-0029 — Liquid Glass: linguagem de material da Apple no `apps/web`
- **Status:** Aceito e implementado (2026-11-06). Emenda ADR-0016/0018/0018b. Só apresentação: nenhum contrato, schema ou fronteira de módulo mudou.
- **Contexto:** Pedido do usuário: "implemente todo o sistema glass da Apple e deixe com pegada profissional igual à Apple" (developer.apple.com/design). O histórico pesa: o cristal anterior foi despoluído no ADR-0016 por excesso de efeito. O Liquid Glass da HIG resolve isso por regra, não por gosto.
- **Decisão — três regras:** (1) **camadas**: vidro só na navegação/controle que flutua (sidebar, topbar, menus, sheets, ⌘K, botões); conteúdo (cards, tabelas, Kanban) usa material espesso quase sólido; nunca vidro sobre vidro (`.lg-well` = fill dentro do vidro). (2) **concentricidade**: raio interno = externo − padding (`--r-2xl` 28 → itens 16); controles são cápsulas. (3) **luz, não cor**: o vidro tem forma por aro de luz direcional (box-shadow inset), brilho especular que segue o ponteiro (`GlassLight`, um listener passivo + rAF) e sombra; tint de marca só em ação primária e seleção.
- **Tokens/classes:** `--fill-1..4`, `--lg-*` (regular/clear/dense/popover/control), `--mat-thick`, system colors acessíveis (`--success #248a3d`, `--danger #d70015`…), `--ease-spring`, fonte `-apple-system`/SF Pro com Inter de fallback. Classes novas: `.lg`, `.lg-clear/-dense/-tinted`, `.lg-well`, `.lg-popover`, `.lg-menu-item`, `.lg-sheet`, `.lg-sheet-side`, `.lg-backdrop`, `.lg-interactive`, `.search-field`. Nomes antigos (`.glass`, `.glass-floating`, `.card`, `.card-crystal`, `.frost`, `.btn*`) re-vestidos, sem reescrever telas.
- **Detalhes técnicos que pesaram:** (a) elemento com `backdrop-filter` vira *backdrop root* e seus filhos não desfocam a página → o vidro do shell mora num `::before` (só em superfícies que não rolam; `.card`/`.glass` seguem diretos). (b) ancestral com `opacity` animada ou `filter` também vira backdrop root → `.lg-backdrop` anima cor, e `pageVariants` limpa `filter`/`transform` no `transitionEnd` (BUG-015). (c) regras de foco foram para `@layer base` e perderam o `border-radius` forçado (deformava cápsulas). (d) `.input[type=search]` via `:where()` para não vencer `pl-*` das telas.
- **Acessibilidade:** `prefers-reduced-transparency` (opaco, sem blur), `prefers-contrast: more` (borda sólida, labels mais escuros), `prefers-reduced-motion` (já existente), fallback `@supports not (backdrop-filter)`.
- **Fora do escopo:** refração real por SVG displacement (só Chromium e caro em áreas grandes); LP de marketing (`lp-*`, sistema editorial próprio); componentes legados não usados (`AppSidebar`, `DynamicIsland`, `TopRight`, `NyroDock`).
- **Reversão:** tokens + primitivos centralizados em `globals.css`; reverter `globals.css`, `tailwind.config.ts`, `lib/motion.ts` e os 17 componentes/telas tocados volta ao estado anterior.

### ADR-0028 — Binding de variáveis no install de template + Onboarding por blueprint (P5/P2)
- **Binding (P5):** templates declaram `variables: [{chave,label,tipo,obrigatorio,default}]`; o config dos nós usa `{{var.chave}}`. `marketplace.instalar(tenant, id, valores?)` substitui (profundo, imutável) `{{var.X}}` pelos valores efetivos (`defaults` do template + o que o usuário informou) antes de criar/publicar. UI: ao instalar, se há variáveis, abre **modal de binding** (pré-preenchido com defaults); senão instala direto. Seed: template "boas-vindas" ganhou `saudacao` + `tag_lead`. **Verificado:** instalar com `{saudacao,tag_lead}` custom → grafo publicado com o texto/tag substituídos (e `{{contato.nome}}` runtime preservado). Campos numéricos (ex.: `duracao`) ficam fora do binding (quebrariam o Zod).
- **Onboarding (P2):** página `/onboarding` (blueprints por nicho: funil+etapas+automações via `BlueprintService.aplicar`, sem API) com **sugestão pelo nicho** e CTA "Deixe a Nyro montar" (`/nyro?q=…`, usa Anthropic quando configurado). Empty-state do dashboard aponta para lá ("Montar meu KHUB").
- **BUG-003 (inbox) — corrigido/verificado:** o composer já usa `<form onSubmit>` + input (Enter envia) e `pr-20` afasta o botão do FAB da Nyro. Sem z-index quebrado.

### ADR-0027 — Analytics dedicado (custo de IA por tenant + automações) + circuit breaker nos demais externos
- **Status:** Implementado. `AnalyticsModule` (`/v1/analytics/*`, só leitura, sempre sob RLS): `ai-usage` (custo USD, tokens, execuções, erros, por agente/modelo/dia — agrega `ai_usage_events`) e `automacoes` (execuções, taxa de sucesso, falhas, na DLQ — agrega `workflow_runs`/`workflow_dlq`). UI `/analytics` ("Análises" no sidebar): custo de IA com série por dia + breakdown, e desempenho das automações, com seletor de período (7/30/90d).
- **Circuit breaker estendido:** além da Anthropic (ADR-0024), agora também **Voyage** (embeddings) e **Meta Graph** — só 5xx/rede abrem o circuito. Fecha o item "circuit breaker no Voyage/Meta" do P4.
- **DLQ ads-sync/ingestion — decisão:** não criei DLQ redundante. Ambos já **persistem a falha no próprio registro** (ingestion → `rag_documents.status='failed' + erro`; ads-sync → `ad_sync_runs.status='failed' + erro` e `integrations.health='down'`), que é dead-letter em nível de registro, reprocessável. A DLQ dedicada faz sentido só para automações (runs efêmeros), onde já existe.
- **Verificado:** `tsc` API+Web OK · `jest` **229/229** · isolamento OK · smoke HTTP: `ai-usage`/`automacoes` → 200 com agregações reais.

### ADR-0026 — Agenda: agendamentos + horários livres, com Google Calendar gated (P3)
- **Status:** Implementado. `db/021_agenda.sql` (tabela `agenda_compromissos`, `CHECK(fim>inicio)`, RLS `tenant_rw`, isolamento no script). Modelo Prisma `AgendaCompromisso`. `AgendaModule` (`/v1/agenda/*`: compromissos CRUD, status, horários livres, sincronizar). UI `/agenda` (substitui "em breve"): criar com **sugestão de horários livres**, confirmar/concluir/cancelar, sincronizar.
- **Booking local e real:** prevenção de **choque de horário** (rejeita 409 se sobrepõe compromisso ativo — `inicio<fim AND fim>inicio`). `sugerirHorarios(data, duração, das, até)` gera slots livres do dia removendo os ocupados — sem API externa.
- **Google Calendar gated:** novo provider `google_calendar` no `ConfigService` (usa `GOOGLE_CLIENT_ID/SECRET`). `sincronizarCalendar` faz `config.require('google_calendar')` → 501 se faltar credencial; com credencial mas sem o OAuth concluído → 400 claro (o `events.insert` é o plugue final da API).
- **Verificado:** `tsc` API+Web OK · `jest` **229/229** · isolamento OK · smoke HTTP: 9 horários livres → agendar 201 → **choque 409** → slot some (9→8) → sync gated.

### ADR-0025 — Financeiro: cobranças do tenant + link de pagamento Stripe via REST (P6)
- **Status:** Implementado. `db/020_financeiro.sql` (tabela `financeiro_cobrancas`, valores em **centavos**, RLS `tenant_rw`, isolamento no `scripts/test-isolation-api-keys.mjs`). Modelo Prisma `FinanceiroCobranca`. Módulo `FinanceiroModule` (`/v1/financeiro/*`: cobranças CRUD, resumo/KPIs, status, link-pagamento). UI `/financeiro` (substitui o "em breve"): KPIs (recebido/a receber/vencido), criar, marcar paga/cancelada, link de pagamento.
- **Gestão local e real; pagamento gated:** gerenciar cobrança não precisa de credencial. O **link de pagamento** chama a **Stripe via REST direto** (`fetch` para `api.stripe.com/v1/checkout/sessions`, form-encoded, Bearer) — **sem SDK**, então "só falta a chave": sem `STRIPE_SECRET_KEY` → 501 `config_required`; com a chave, cria a Checkout Session e devolve a `url`. Envolvido em `CircuitBreaker` (Stripe). "vencida" é status **derivado** (enviada/rascunho com vencimento no passado).
- **Bug corrigido no caminho (pego pelo smoke real):** a auth por API key setava `identityId = "apikey:<uuid>"`, que quebrava o cast UUID em `created_by`/audit de qualquer write. Agora usa o **UUID da própria chave** (válido e rastreável) — conserta writes via chave em todos os módulos.
- **Verificado:** `tsc` API+Web OK · `jest` **229/229** · isolamento OK · smoke HTTP: criar 201, marcar paga, resumo correto, link Stripe → **501 config_required (STRIPE_SECRET_KEY)**.

### ADR-0024 — Blindagem de produção (P4) + deploy kit, sem novas dependências
- **Status:** Implementado (P4 da Trilha "só faltar APIs"). Tudo com libs já presentes (ioredis/bullmq) — nada de pacote novo (evita rede/instalação frágil).
- **Rate limit por tenant/IP:** `common/rate-limit.guard.ts` (APP_GUARD **depois** do JwtAuthGuard → usa `req.user.tenantId`; público → por IP), janela fixa em Redis (`common/redis.service.ts`, **fail-open** se Redis cair). Excede → 429 `application/problem+json` + `Retry-After`. `@SkipRateLimit()` para webhooks/health. **Verificado:** 120 req passam, 121+ → 429.
- **Security headers:** `common/security-headers.ts` (equivalente enxuto ao helmet: nosniff, X-Frame DENY, Referrer, Permissions-Policy, HSTS em prod). **CORS allowlist:** `CORS_ORIGINS` (CSV) ou default WEB_URL em prod / aberto em dev.
- **Observabilidade:** correlation-id por request via `AsyncLocalStorage` (`common/request-context.ts` + `correlation.middleware.ts`); logger JSON estruturado em prod (`common/json-logger.ts`); `ErrorReporter` (`common/error-reporter.service.ts`) captura 5xx com cid — **seam pronto p/ Sentry** (só falta `SENTRY_DSN` + pacote).
- **Circuit breaker:** `common/circuit-breaker.ts` (fechado→aberto→meio-aberto; fail-fast). Aplicado à Anthropic (só 5xx/rede abrem). **2 testes.**
- **Health:** `/v1/health` agora checa **db + redis** (`ok`/`degraded`/`down`). Boot do Redis já era resiliente (adapter degrada p/ memória).
- **Deploy kit:** `apps/api/Dockerfile` + `apps/web/Dockerfile` (Next `output:standalone`) + `.dockerignore`; **CI** `.github/workflows/ci.yml` (lint·typecheck·jest·build + **gate de isolamento RLS** com Postgres real: aplica migrações via psql, roda `db/002` + isolamento api_keys/tags); runner de migração **rastreado** (`schema_migrations`, idempotente) em `scripts/apply-sql.mjs`.
- **Verificado:** `tsc` API+Web OK · `jest` **229/229** · API sobe · health `{db:true,redis:true}` · headers+cid presentes · rate-limit 429 comprovado.

### ADR-0023 — Configurações avançadas: Tags do CRM + Private Integrations (API keys reais)
- **Status:** Implementado. Migrações `db/018_tags.sql` (tabela `crm_tags`) e `db/019_api_keys.sql` (tabela `api_keys` + função de auth). Modelos Prisma `CrmTag` e `ApiKey`. Rotas em `SettingsModule` (`AdvancedSettingsController`): `/v1/settings/tags` (CRUD) e `/v1/settings/api-keys` (list/criar/revogar). UI: abas **Tags** e **Private integrations** em Configurações → grupo Avançado.
- **Decisão sensível (auth por API key):** um sistema externo autentica na API REST com `X-API-Key: orv_live_…` (ou `Authorization: Bearer orv_live_…`). O tenant **vem do banco, nunca do header** (invariante 3). Guardamos só o `sha256` da chave; a chave em claro só existe na resposta da criação.
- **Problema de RLS resolvido:** a autenticação precisa descobrir o tenant a partir do hash **antes** de haver contexto de tenant — impossível sob RLS com `khub_app`. Solução: **uma** função `auth_lookup_api_key(hash)` `SECURITY DEFINER`, dona `khub_service` (BYPASSRLS), que devolve **só** `(tenant_id, id)` da chave ativa e carimba `last_used_at`. É o único caminho cross-tenant; o CRUD normal (list/criar/revogar) passa pela policy `tenant_rw`. O `JwtAuthGuard` faz o lookup e seta `req.user = { role:'api', tenantId }`.
- **Verificado:** teste de isolamento (`scripts/test-isolation-api-keys.mjs`) — A não vê chaves/tags de B, `WITH CHECK` bloqueia gravar no escopo de B, a função acha o tenant certo pelo hash e nada para hash inválido. Smoke HTTP: chave válida → 200, inválida/sem auth → 401. `jest` 227/227.

### ADR-0022 — Blueprints por nicho: Camada de Conhecimento + provisionamento nativo (F2)
- **Status:** Implementado (P2 da Trilha "só faltar APIs"). Baseado no design de "playbook por nicho" trazido pelo usuário, **adaptado ao KHUB nativo** (não GHL: sem snapshot/subconta; provisiona no próprio CRM).
- **Camada de Conhecimento:** `apps/api/src/blueprints/playbooks.ts` — playbooks tipados por nicho (fato/regra, versionado, nunca dado de cliente). 3 nichos MVP: `saude.odontologia` (tier 3), `juridico.advocacia` (tier 3, OAB 205/2021), `contabil.escritorio` (tier 2). Cada um com funil/etapas, qualificação, objeções (2 ângulos + retirada), **guardrails de compliance** (CFM/OAB/CFC como restrição), e **gate de completude** (`dadosObrigatorios`).
- **Provisionamento nativo:** `BlueprintService.aplicar(tenant, key)` cria o funil (via `CrmService.createPipeline`) + instala automações (via `MarketplaceService`), idempotente por `tenant.templateId`. `GET/POST /v1/blueprints`. Reusa o motor da Nyro configuradora — zero duplicação.
- **Nyro:** tool `aplicar_blueprint` (sensível) na Arquiteta — a IA descobre o nicho e monta o CRM inteiro. `nicho` do signup (antes ignorado) agora resolve o playbook (`playbookPorNicho`).
- **Verificado:** `BlueprintService` (5 testes) + `tool-executor` estendido; **227 testes verdes**; typecheck; API no ar. Cérebro: `Blueprints/README.md`.
- **Não implementado de propósito (é GHL, não KHUB):** snapshot+delta, matriz API/snapshot/manual, injeção via custom value. No KHUB o provisionamento é nativo.

### ADR-0021 — Workspace de automações: tags + filtros + builder em tela cheia (ilha)
- **Status:** Implementado. Pedido do usuário: tags/filtros no workspace e o builder abrindo como popup tela cheia com navbar estilo ilha dinâmica.
- **Tags:** `db/017` adiciona `workflows.tags TEXT[]` (aditivo, GIN index; RLS herdada da 010). `renomear` aceita `tags`; `listar`/`obter` devolvem. DTO com `@IsArray`.
- **Workspace (lista):** barra de filtros — busca (nome/descrição/tag), chips de status (todos/ativo/pausado/rascunho) e chips de tag (derivados dos workflows). Cards mostram as tags (clique filtra).
- **Builder tela cheia:** o editor virou `fixed inset-0 z-[70]` cobrindo a sidebar/ilha do app, com **navbar flutuante `.glass .crystal-edge`** (estilo ilha): fechar · nome editável · status · autosave · **editor de tags inline** (adiciona no Enter/blur, remove no ×) · ações (Adicionar, Execuções, Config, Pausar/Ativar, Publicar). Fecha voltando à lista.
- **Verificado:** typecheck API+Web, `db/017` aplicada, **214 testes** verdes, API+web no ar.

### ADR-0020 — Automation Marketplace: fundação (schema + instalar reusando o motor)
- **Status:** Sprint 1 implementado. Aprovado: **expandir motor → depois marketplace**; propriedade **global (operador) + do tenant**.
- **Schema (`db/016`):** `automation_templates` — `tenant_id NULL` = global/oficial (publicado só por `khub_service`, mesma exceção das bases do RAG) + `tenant_id = X` = privado do tenant. `workflow` é o grafo do editor. **RLS de 2 políticas:** `tpl_read` (globais publicados + próprios) e `tpl_write` FOR ALL (só os próprios). `FORCE` — `khub_service` (BYPASSRLS) publica os globais.
- **Backend:** `MarketplaceModule` → `MarketplaceService` (`listar`/`buscar`/`categorias`/`obter`/`instalar`) + controller (`GET /v1/marketplace/templates|categorias|:id`, `POST .../:id/instalar`). **Instalar reusa o `WorkflowsService`** (criar → salvar grafo → publicar) — **zero duplicação do motor**; o `publicar` valida o grafo.
- **Seed:** 6 templates globais **reais e publicáveis** (`scripts/seed-marketplace.mjs`, via superuser): boas-vindas, follow-up c/ resposta, A/B, reativação de perdido, qualificação por IA (gated Anthropic), drip. Usam só nós sem UUID de tenant — `mover_etapa`/`criar_oportunidade` (precisam de `stageId`) ficam para o binding de variáveis (Sprint 2).
- **Verificado:** **214 testes** (+3), typecheck. `db/016` aplicada. **Prova real:** os 6 grafos passam pelo `validar` (0 problemas = publicáveis, não fake) e a **RLS isola** (A não vê o privado de B; ambos veem os 6 globais).
- **Dívida:** contador `installs` não incrementa em template global (RLS bloqueia o app; precisa de função `SECURITY DEFINER` — Sprint 2). Templates com `stageId`/`tag` específicos do tenant precisam de binding de variáveis na instalação (Sprint 2). UI do marketplace: Sprint 2.

### ADR-0019 — Camada de IA compartilhada (`AiModule`) + nós de IA/drip no motor
- **Status:** Aceito e implementado. Aprovado pelo usuário (expandir o motor antes do marketplace).
- **Contexto:** O motor de automações precisava de **nós de IA** (score/sentimento/resumo/resposta) e o `AnthropicProvider` só existia dentro da Nyro. Fazer o motor importar o interno da Nyro cruzaria fronteira de módulo; duplicar o provider é proibido.
- **Decisão:** `AnthropicProvider` movido `nyro/` → **`ai/`**; novo `AiModule` **`@Global`** provê `AnthropicProvider` + `AiService` (tarefa única: classificar/pontuar/resumir/responder/extrair). `ai` é a camada baixa; Nyro e automações **consomem** (sem ciclo, sem duplicação). Nyro deixou de prover o provider (vem do global); só o import path mudou.
- **Nós novos no catálogo (22→26):** `controle.split` (A/B determinístico, FNV-1a), `acao.definir_variavel` (variáveis no `Contexto`, `{{variaveis.x}}`), `acao.ia` (gated Anthropic; resultado vira variável), `controle.drip` (lote por janela; UPSERT atômico em **`workflow_drip_counters`** — `db/015`, RLS+FORCE — reagenda na próxima janela sem perder contato).
- **Verificado:** **206 testes verdes** (+8), typecheck API+Web, `db/015` **aplicada no Postgres real** (tabela existe), API rebuildada e no ar. `acao.ia` roda gated (mock nos testes; real depende de crédito na Anthropic).
- **Dívida anotada:** o contador do drip incrementa por execução — um retry do run pode contar 2× (over-count pequeno, aceitável num rate-limiter); revisitar se virar problema.

### ADR-0018b — Camada de material & movimento (liquid chrome · frost · fluido)
- Emenda o ADR-0018/0016. Só apresentação. **Botões:** borda em todos, primário vira **metal líquido** (gradiente + gloss + aresta), **brilho que varre** no hover (`.btn::after`), easing elástico. **Utilidades:** `.frost` (vidro fosco forte), `.liquid-chrome` (metálico com brilho girando), `.fluid` (elevação no hover). Guarda `prefers-reduced-motion` desliga tudo. Cascateia por todos os botões via os primitivos.

### ADR-0018 — Rebrand visual v3: design system light-premium (Apple/Linear), roxo #7B2EFF
- **Status:** Fundação implementada. Rebrand **só de apresentação** (nenhuma lógica/rota/contrato tocado).
- **Contexto:** Pedido do usuário (spec detalhada + 10 mockups) para o KHUB parecer "SO empresarial premium", não "mais um CRM". Tokens novos: bg `#F8F6F2`, surface `#FFFFFF`, texto `#111`, muted `#6B7280`, primária `#7B2EFF`, aux `#A66BFF`, raio 24, grid 8pt, glow `rgba(123,46,255,.18)`, blur 30, transição 180ms.
- **Alavanca:** o app é dirigido por tokens (`var(--bg)`, `.card`, `.btn`, `.glass`, `bg-brand`, `--radius`). Reescrever **tokens + primitivos + tipografia** re-veste todas as telas de uma vez, coerente e reversível.
- **Decisão / o que mudou:** `globals.css` `:root` (nova paleta, tokens `--radius/--blur/--dur/--glow`), `.card` (raio 24, sombra suave + glow), `.btn`/`.btn-ghost` (vidro premium, glow, 180ms), `.input` (mais respiro, focus glow), `.glass` (blur 30), `.studio-bg` (luz ambiente quente off-white). **Light virou o padrão** (removido o auto-dark por `prefers-color-scheme`; dark é opt-in). Fonte **Nunito → Inter** (precisão Apple/Linear), pesos de heading reduzidos. `tailwind.config` (brand ramp #7B2EFF, raios, sombras). Accent padrão e avatares alinhados ao novo roxo.
- **Verificado:** typecheck Web verde, app servindo. Só 2 hex antigos hardcoded no projeto inteiro (themeColor + paleta de avatar) — corrigidos; o resto herda dos tokens.
- **Pendente (não é a fundação):** refino tela-a-tela (Dashboard, Pipeline, Inbox etc.), motion (framer-like) e as ilustrações de cristal/partículas por tela ficam como próximos passos — a fundação garante a base coerente sobre a qual eles entram.

### ADR-0017 — Login social (Google + GitHub) via OAuth2 authorization code
- **Status:** Aceito e implementado. Substitui o stub 501 do `oauthCallback`. **Gated (ADR-0008):** sem `GOOGLE_CLIENT_ID/SECRET` ou `GITHUB_ID/SECRET`, o `GET /oauth/:provider/url` responde 501 `config_required`.
- **Fluxo:** front `GET /api/auth/oauth/:provider` gera `state` (anti-CSRF) num cookie httpOnly e redireciona (307) para o provedor → provedor volta em `/api/auth/oauth/:provider/callback` → a rota Next valida `state` vs cookie, chama `POST /v1/auth/oauth/callback {provider,code}` → a API troca code→token→perfil, exige e-mail **verificado**, e emite sessão. Cookies httpOnly setados pela rota Next (mesmo padrão do login).
- **Conta:** `AuthService.loginWithOAuth` — identidade nasce **sem senha** (`passwordHash: null`, e-mail já verificado); e-mail existente apenas loga no tenant padrão (account-linking por e-mail verificado); novo provisiona tenant (funil default). Reusa `issue()`.
- **Arquivos:** `auth/oauth.providers.ts` (endpoints + troca de código, sem segredo), `auth/oauth.service.ts` (config + gating), `loginWithOAuth` no `auth.service`, endpoints no `auth.controller`, rotas Next `oauth/[provider]/{route,callback}`, `SocialAuth` passou a navegar. `redirect_uri` = `${WEB_URL}/api/auth/oauth/:provider/callback` (tem que casar com o console do provedor).
- **Verificado:** typecheck API+Web verde, build da API OK; endpoints geram as URLs corretas; a rota Next redireciona 307 com o cookie de state. Falta só o clique de consentimento real (interativo). **Pendência menor:** `/login?erro=` ainda não é exibido na tela (falha volta silenciosa) — melhorar depois.

### ADR-0016 — Identidade visual v2: fundo estúdio infinito + despoluição + personalização por cliente
- **Status:** Aceito e implementado. Substitui o experimento do fundo em vídeo (revertido) e recalibra o "cristal" (que estava poluindo a leitura).
- **Contexto:** Feedback do usuário: "o sistema tá muito poluído, torne profissional; tire o vídeo e ponha um branco frio 3D infinito que se adapta à personalização; permita trocar a logo e personalizar pelas configurações". O vídeo foi removido (custo de banda + só rodava em navegador real por causa do codec H.264) e o cristal estava com sombras roxas em tudo, feixe diagonal branco e refrações fortes.
- **Decisão:**
  1. **Fundo = ciclorama de estúdio** (`.studio-bg`, CSS puro, `fixed -z-10`): branco frio com luz suave de cima e piso derretendo no horizonte (~66% da altura). Escolhido pelo usuário entre 3 direções (estúdio / grade em perspectiva / planos flutuantes). **Adapta-se:** o respiro nas quinas usa `var(--brand-bright)`/`var(--lilac)` (muda com a cor de destaque) e tem variante clara/escura. Zero movimento — o "premium" vem da luz, não de efeito.
  2. **Despoluição do cristal:** removido o feixe branco diagonal do `html`; cards ficaram planos com **sombra neutra** (nada de roxo em toda sombra); `.glass` com blur/saturate menores; aresta refratada e halo da logo bem mais discretos; `.depth-hover` sem o tilt 3D (era gimmick). A identidade cristal continua, calma.
  3. **Personalização por cliente** (`users.prefs`, sem schema novo): cor de destaque + tema + **logo trocável** + **plano de fundo próprio** (imagem do cliente cobre o estúdio, com scrim de leitura). Fonte única = `PersonalizationProvider` (context): carrega as prefs uma vez, aplica no documento e é lido tanto pela ilha (logo no canto) quanto pela tela de Configurações — trocar a logo reflete na hora. O seletor de "fundo preset" saiu (conflitava com o estúdio fixo e com o pedido "branco frio").
     - **Sem limite de tamanho pro usuário:** `otimizarImagem()` redimensiona e recomprime no cliente (canvas → WEBP; logo 512px, fundo 2560px; SVG passa direto). Qualquer arquivo entra sem ser rejeitado, e o data URL guardado em `prefs` fica pequeno — evita estourar o JSON de `users.prefs`. **Nota de dívida:** data URL em `prefs` é solução de MVP; branding pesado/por-tenant pede storage (R2/S3, Sprint H) + coluna própria.
- **Consequências:** `apps/web` — novo `components/app/PersonalizationProvider.tsx` (substitui o `Personalization.tsx`), `.studio-bg`/`.studio-preview` no `globals.css`, `DynamicIsland` lê a logo do provider, aba Personalização refeita com upload de logo + prévia ao vivo. `VideoBackground.tsx` e o `.mp4` removidos. Logo é **por-usuário** (consistente com accent/tema); branding por-tenant fica como evolução futura (exigiria coluna própria). Typecheck Web verde; `studio-bg` no HTML servido.

### ADR-0015 — Trilha W: paridade de motor com o GHL, escopada ao que o produto tem (Sprint W1+)
- **Status:** Aceito. W1 implementado (nó `acao.enviar_email`). W2–W5 no backlog ([[Tasks]] §Trilha W).
- **Contexto:** O usuário pediu "criar o sistema de workflow igual ao do GHL, mas com a identidade da KHUB", trazendo um benchmark completo do motor do GHL (modelo Gatilho→Condição→Ação, settings de execução, inventário de ~14 categorias de gatilho e ~14 de ação, camada de API/SDK, migração de assinatura de webhook Ed25519).
- **Decisão — o que "igual ao GHL" significa aqui:** igualar a **profundidade do motor e da UX**, NÃO clonar o menu. Gatilho/ação de módulo que o KHUB não tem (Payments, Courses, Ecommerce, Affiliate, Appointments até a Fase 1) **fica de fora** — mesma regra do ADR-0013 ("menu que não faz nada é pior que menu ausente"). A camada de dev do GHL (API V2, SDK `@gohighlevel/api-client`, assinatura `x-ghl-signature`) **não se aplica**: o KHUB é concorrente, não cliente do GHL; só entra se um dia integrarmos *com* o GHL.
- **Escopo por sprint (uma por sessão):** **W1** — `acao.enviar_email` (canal oficial SMTP, gated). **W2** — `controle.split` (A/B determinístico por hash do contato) + `controle.drip` (liberação em lotes). **W3** — gatilhos que não exigem módulo novo: `Scheduler` (tempo, sem contato), `Form Submitted`, `Custom Date/Birthday Reminder`, `Opportunity Status` (ganho/perdido). **W4** — `acao.dnd` (liga/desliga) + `acao.atribuir_usuario`: exigem **schema novo no `Contact`** (`dnd`, `owner_id`) → decisão estrutural, PARA e pede aprovação. **W5** — settings restantes (Sender Details, Mark as Read) + **verificação de assinatura no `gatilho.webhook` de entrada** (lacuna de segurança nossa, independente do esquema do GHL).
- **Consequências:** o `catalogo.ts` continua sendo a fonte única (a paleta e a validação derivam dele; a UI da paleta é automática, o painel de config por-nó é bespoke em `PainelNo.tsx`). Cada nó novo exige: entrada no catálogo + schema Zod + método no `ExecutorService` + bloco no `PainelNo` + teste. W1 fechou com 4 testes no executor (interpolação, gating SMTP, falha real → retry, contato sem e-mail).

### ADR-0014 — Nyro IA: orquestrador multi-agente, tools tipadas, guardrails em 2 camadas (Sprint F)
- **Status:** Aceito e implementado. Fecha a **⚠️ LACUNA** do PRD §5.1 (conjunto de tools + schemas). Tudo **gated** em `ANTHROPIC_API_KEY` (ADR-0008): sem a chave, todo o módulo responde 501 `config_required` — nunca resposta simulada.
- **Orquestração:** roteador (**Haiku**, barato — classificação de uma palavra) escolhe 1 de 4 sub-agentes (Arquiteta/Configuração, Atendente/Conversas, Estrategista/Growth, Consultora/Consultoria); o agente roda em **Sonnet** com function-calling. Cada agente enxerga **só as tools do papel dele** — menos tool, menos alucinação. Teto de 5 idas ao modelo por turno (loop de tool = conta infinita).
- **"Nyro é usuário, não deus" (invariante do CLAUDE.md):** as 14 tools NUNCA escrevem no banco. Cada uma vira chamada de serviço do CRM/automações, com a mesma validação, RLS e auditoria (`actor:'nyro'`). Tool fora do catálogo (`tools.ts`) não existe: o executor recusa nome alucinado; schema Zod recusa argumento inválido.
- **Human-in-the-loop:** tool `sensivel` (enviar mensagem, mover etapa, ligar/desligar automação) **não executa** — cria uma `nyro_actions` pendente e o modelo é instruído a dizer "aguardando confirmação". Só o `POST /v1/nyro/acoes/:id {aprovar}` do humano dispara a ação de fato. Expira em 24h.
- **Guardrails — DUAS camadas (invariante de compliance):** (1) instrução CFM/OAB/contábil entra no system prompt; (2) `validarResposta` checa a resposta **antes** de chegar ao usuário e a substitui por uma segura se bater numa regra. A camada 2 existe porque prompt não é garantia — modelo sob pressão atropela instrução, e em saúde/jurídico isso é risco de processo. Hit registrado em `nyro_guardrail_hits`. Regras conservadoras de propósito: falso positivo custa uma resposta reescrita, falso negativo custa um processo.
- **Memória em 3 níveis (PRD §5):** (1) conversa = `nyro_messages` (janela de 20); (2) conta = `nyro_memory` (fatos que a tool `lembrar` grava e entram no prompt); (3) nicho = RAG via tool `buscar_conhecimento` (grounding: sem chunk, declara lacuna — nunca conhecimento paramétrico em preço/prazo/protocolo).
- **Custo por tenant:** cada ida ao modelo grava `ai_usage_events` (tokens + USD por modelo). É o que o Sprint C liga a crédito de IA por plano. Registro best-effort — falhar aqui não derruba a resposta.
- **Consequências:** `db/013_nyro.sql` (5 tabelas + a `nyro_guardrail_hits` do R0), RLS em todas, isolamento no `db/002` (bloco 14). Front: o `NyroDock` deixou de ser protótipo — chat real com passos ao vivo (agente que assumiu, tool que rodou) e cartão de aprovação para as ações sensíveis; sem a chave, mostra "Configurar Claude" + o que a Nyro faria. **⚠️ Não testado com a API real** (sem `ANTHROPIC_API_KEY`): o caminho está implementado e o gating verificado; a qualidade das respostas depende da chave.
- **Regressão corrigida no caminho ([[Bugs|BUG-013]]):** o cristal (`.glass`) definia `position: relative` fora de `@layer components`, vencendo `fixed`/`absolute` do Tailwind — o chat da Nyro e o menu do topo iam para fora da tela. Movido para a layer, onde utility sempre ganha.

### ADR-0013 — Catálogo cresce para 21 nós + configurações de fluxo (Sprint E.2)
- **Status:** Aceito e implementado. **Emenda o ADR-0012** (que congelou 15 nós) — o usuário trouxe a referência completa do GHL (categorias de triggers/actions, waits com reply/timeout, chaining, webhooks, workflow settings).
- **O que ENTROU (+6 nós, todos com base real no produto):** `gatilho.negocio_criado` · `gatilho.webhook` (URL de entrada por fluxo) · `controle.esperar_resposta` (ramos fixos **Respondeu** / **Não respondeu**) · `controle.encerrar` · `acao.criar_nota` · `acao.chamar_workflow` (encadeamento).
- **O que FICOU DE FORA, e por quê:** o GHL lista Appointments, Payments, Courses, Affiliate, IVR, Communities, Certificates, Ecommerce, Google Ads, Eliza e Custom Objects. No KHUB **não existe backend para nenhum deles** hoje (`/agenda` é stub, Stripe é Sprint C, Google Ads é Sprint B). Criar essas categorias seria menu que não faz nada — proibido pelo contrato ("sem placeholder/mock silencioso"). Entram quando o módulo existir; o catálogo é a fonte única e cada nó novo exige atualizar [[PRD]] §7.1 junto.
- **Configurações de fluxo (migration 011)** — o que separa automação de demo de automação que não queima a lista:
  - **Reentrada** (`uma_vez` padrão · `apos_terminar` · `sempre`): o erro mais caro é o mesmo contato recebendo a mesma sequência 3×. Só `sempre` dispensa a checagem; teste manual ignora a regra (senão não dá para testar 2×).
  - **Parar no reply**: contato respondeu → virou conversa humana, a automação sai da frente.
  - **Janela de envio** (dias + horas + **timezone do tenant**): fora da janela a mensagem **espera**, não é descartada. Só segura `acao.enviar_sms` — mover etapa ou criar tarefa às 3h não incomoda ninguém.
- **Esperar resposta (como funciona):** o nó roda 2×. 1ª marca `aguardandoResposta` no estado e reagenda **o próprio nó** para o prazo (`mesmoNo`); 2ª decide o ramo. Se o contato responde antes, `TriggersService` chama `RunsService.avisarResposta`, que marca `respondeu` e acorda o nó **na hora** — o job do timeout que já estava na fila é ignorado depois pela guarda `run.noAtual !== noId`. O `jobId` ganhou sufixo (`reply`) porque mesmo nó + delays diferentes seriam deduplicados pelo BullMQ e a resposta se perderia.
- **Webhook de entrada:** `POST /v1/hooks/:chave` (público). A chave é a credencial (24 bytes, regenerável), roteada por `resolve_workflow_by_webhook_key` (SECURITY DEFINER, mesmo padrão de 008/009). Responde **202 mesmo para chave inválida** — 404 viraria oráculo para descobrir chaves por tentativa.
- **UX (o pedido explícito do usuário):** painel "Adicionar" com **busca focada** e sinônimos (`whats` acha "Enviar SMS"), agrupado por categoria como no GHL; nó nasce configurado e **já conectado** ao anterior; canvas vazio ensina o começo em vez de ficar em branco; zoom/fit/minimap do React Flow.

### ADR-0012 — Motor de automações: 15 nós, um job por nó, barramento de eventos (Sprint E)
- **Status:** Aceito e implementado (fluxo real executando ponta a ponta). **Catálogo emendado pelo ADR-0013** (15 → 21 nós).
- **Contexto:** [[PRD]] §7.1 estava marcado como **⚠️ LACUNA** ("não fecha os 15 nós essenciais; definir em F4 e registrar ADR"). O usuário trouxe as telas do GHL como referência de UX.
- **Decisão 1 — catálogo congelado (15 nós):** 4 gatilhos, 3 de controle, 8 de ações, definidos em `catalogo.ts` com **Zod por tipo**. É a fonte única: a API valida a publicação contra ele e o canvas monta a paleta a partir dele — nó fora do catálogo não publica. O nó de envio chama-se **"Enviar SMS"** por decisão do usuário: a entrega sai pelo WhatsApp via STEVO, que é **API não oficial** (sem template, sem mídia, sem garantia de sessão); chamar de "WhatsApp" prometeria o que o canal oficial dá e este não dá.
- **Decisão 2 — um job = um nó:** o worker executa **um** nó e enfileira o próximo. O estado vive no banco (`workflow_runs.estado`), não na memória: uma espera de 7 dias vira `delay` na fila + `status:'esperando'`, e sobrevive a deploy/restart/queda. Retry exponencial é do BullMQ; esgotado, o nó cai no **DLQ** (`workflow_dlq`) com o run marcado `falhou` e botão de reprocessar. `aoFalhar:'seguir'` por nó é o fallback do PRD §7.2.
- **Decisão 3 — barramento de eventos (`events`), não chamada direta:** `automations` precisa do `crm` para agir (mandar mensagem, criar negócio), então o `crm` **não pode** importar `automations` — seria ciclo. O CRM publica em `DomainEventsService`, que fan-outa para (a) socket e (b) fila `automation-triggers`; o worker das automações consome. Ninguém chama ninguém; o CRM não sabe que automações existem.
- **Decisão 4 — a automação é um usuário, não um deus:** toda ação passa pelos serviços do CRM (`CrmService`, `MessagesService`, `TasksService`) — mesmas regras, mesma auditoria, mesma RLS. Nenhum nó escreve direto no banco (invariante do CLAUDE.md).
- **Versionamento:** rascunho é editável, **versão publicada é imutável**; o run guarda a `version_id` que executou — editar o fluxo no meio de uma espera de 7 dias não muda a lógica de quem já está correndo. Rollback = apontar `versao_ativa_id` para uma versão anterior.
- **Guardas:** loop de `ir_para` para em **200 passos** (vira DLQ); webhook bloqueia rede interna/metadata (**SSRF**); `gatilho.mensagem_recebida` só dispara para mensagem **do contato** (senão o fluxo responderia à própria resposta, em loop).
- **Consequências:** `db/010_automations.sql` (5 tabelas, RLS + isolamento no `002`); canvas em **React Flow** com drag-and-drop, painel por nó e validação antes de publicar; timeline nó-a-nó ao vivo pelo socket (`automation.run`). Dois bugs reais achados no caminho — ver [[Bugs|BUG-010]] e [[Bugs|BUG-011]].

### ADR-0011 — Tempo real: Socket.IO + ticket curto + sala por tenant (Sprint D2)
- **Status:** Aceito e implementado (isolamento provado com socket real).
- **Contexto:** [[APIs]] §6 estava marcado como **⚠️ LACUNA** ("Socket.IO vs WS nativo, formato de mensagens e auth do socket não definidos"). A sprint exige inbox/Kanban ao vivo **e reconexão**, e o inbox vivia de polling de 3s.
- **Decisão 1 — Socket.IO** (não `ws` nativo): reconexão com backoff, heartbeat e **salas** são requisitos desta sprint e vêm prontos; no `ws` seriam três implementações caseiras. Custo aceito: protocolo próprio (não é WS puro) e um cliente a mais no bundle. Reversível: o front só conhece `useRealtime()`, o back só conhece `RealtimeService`.
- **Decisão 2 — ticket, não cookie nem access token:** o access token é **httpOnly** (o JS não o alcança — e isso é proposital). Então `POST /v1/auth/ws-ticket` devolve um JWT `typ:'ws'` de **60s** só para o handshake. O `JwtAuthGuard` recusa `typ:'ws'` no REST: mesmo vazando (handshake/URL são superfície mais exposta), o ticket não abre a API e morre em segundos. Cookie cross-origin foi descartado: funciona em `localhost` (cookie ignora porta) e **quebraria em produção** com `app.` vs `api.` — o tipo de bug que só aparece no deploy.
- **Decisão 3 — reconexão busca ticket novo:** `auth` é função, chamada a cada tentativa. Com ticket estático, o socket reconectaria com credencial expirada e seria recusado para sempre — falha silenciosa clássica.
- **Isolamento (o que sustenta tudo):** `tenantId` vem **do ticket assinado**, nunca do payload do cliente; o socket entra só em `tenant:<id>` e não há evento para pedir sala. Todo envio é `to(sala)`. Provado: dois sockets (tenant real + tenant forjado), evento de A → **A recebe, B não recebe nada**.
- **Consequências:** contrato tipado em `@khub/types` (`RealtimeEvents`) compartilhado front↔back — `@khub/web` passou a depender de `@khub/types`. Publicação **best-effort e pós-commit**: socket é enfeite sobre o banco, e uma emissão falha não pode derrubar operação já commitada (nem gerar card fantasma — operação que falha não publica). `RedisIoAdapter` para múltiplas instâncias, degradando para memória sem Redis. Front mantém **polling de 5s como fallback** quando desconectado. Canal `automation.run` existe; os emissores chegam no Sprint E.

### ADR-0010 — Ingestão de lead externo: quem tem credencial busca, quem sabe criar contato cria (Sprint D1)
- **Status:** Aceito e implementado.
- **Contexto:** o lead do Meta Lead Ads chega por webhook **público, sem tenant**, e vira contato no CRM. Duas competências colidem: só `integrations` tem a credencial/Graph da Meta; só o `crm` sabe criar contato. Botar tudo num lado quebraria a fronteira de módulo (`crm` importando cripto/Graph, ou `integrations` escrevendo em `contacts`).
- **Decisão:** `LeadsService` (no **crm**) expõe `upsertFromLead(tenantId, LeadExterno)` — provider-agnóstico, serve TikTok/Google depois. `MetaLeadsService` (em **integrations**) resolve tenant, deduplica, busca no Graph e **entrega** o lead. A dependência é `integrations → crm` (superfície pública exportada pelo `CrmModule`); o crm não conhece integrations, então não há ciclo.
- **Roteamento:** `meta_pages(page_id UNIQUE → tenant)` + `resolve_tenant_by_meta_page` (SECURITY DEFINER, owner `khub_service`) — o mesmo padrão do STEVO (008): só o `tenant_id` atravessa, a linha continua invisível para a app sem contexto. As páginas são gravadas no OAuth (`connector.listPages`).
- **Idempotência em duas camadas:** `webhook_events(provider,event_id)` barra a reentrega da Meta; e o `upsertFromLead` deduplica por e-mail/telefone (dígitos), **enriquecendo** o contato existente em vez de duplicar. Assinatura `X-Hub-Signature-256` verificada sobre o **corpo cru** (`rawBody: true` no `main.ts`) — JSON re-serializado não bate com o HMAC.
- **Consequências:** sem credencial da Meta o evento fica gravado com `processed_at NULL` — reprocessável quando a chave chegar, e **nunca** um contato inventado (ADR-0008). Ack antes de processar (a Meta reentrega se passar de 20s).

### ADR-0009 — Aceite de convite: token de uso único troca por sessão (Sprint 0)
- **Status:** Aceito e implementado (verificado end-to-end).
- **Contexto:** o convite já era criado e auditado, mas **não existia rota de aceite** — o link levava a um signup normal, que criaria um **tenant novo** em vez de entrar no tenant que convidou. Convite é anterior à sessão: quem aceita ainda não tem JWT.
- **Decisão:** `POST /v1/auth/invites/accept` **público** — o token do link **é** a credencial. Fluxo: sha256 do token → `invites.token_hash` → valida `accepted_at IS NULL` + `expires_at` → identidade **nova** (exige senha ≥8) **ou existente** (reaproveita, permitindo a mesma pessoa em 2 tenants) → `membership.upsert` no **tenant do convite** com a **role do convite** → perfil em `users` dentro de `withTenant` → audit `invite.accept` → `accepted_at = now()` (**uso único**) → emite access+refresh. O front nunca vê o tenant: ele vem do token, no servidor.
- **Alternativas descartadas:** (a) aceitar só com login prévio — quebra o convite de quem ainda não tem conta; (b) tenant no corpo do request — o browser passaria a escolher tenant, violando o invariante 1.
- **Consequências:** o e-mail do convite manda para `/signup?invite=`; o `SignupForm` nesse modo esconde empresa/nicho/e-mail (vêm do token) e pede só nome+senha. Envio do e-mail é **gated** (ADR-0008): sem `SMTP_URL` o convite existe e o link volta na resposta para envio manual. Verificado: aceite → `member` no tenant certo com os dados certos; reuso do token → **400**; auditado.

### ADR-0008 — Gating por credencial: `ConfigService` + `config_required` (Sprint 0)
- **Status:** Aceito e implementado (canário verde).
- **Contexto:** o contrato do [[Brief-Finalizacao]] (§2) exige que **só falte plugar a credencial, nunca escrever código**. Antes, 17 arquivos liam `process.env` solto e cada um degradava do seu jeito (400 aqui, string mágica ali, `stevo_off` acolá).
- **Decisão:** um **`ConfigService` global** é o único leitor de env (`REQUIRED: Record<Provider, string[]>` é a fonte da verdade, espelhada em `docs/ENV.md`). API: `isConfigured` · `missingVars` · `require` (lança) · `warnDegraded` · `snapshot`. **Variável vazia = ausente** (`""`/`"   "` não configuram nada). Três formas de degradar, escolhidas pelo que já teve efeito:
  1. **501 `config_required`** quando a operação é *só* a chamada externa (ex.: `meta/auth-url`).
  2. **200 + estado gated** quando a parte local já valeu (ex.: envio de mensagem: **grava** e devolve `status:'config_required' + missing[]` — a mensagem não pode sumir porque falta credencial; o mesmo vale para o convite, que existe e devolve o link).
  3. **Fallback funcional** quando existe caminho degradado honesto (sem `VOYAGE_API_KEY` → `rag_search_lexical`/BM25, migration 007, com `warn`).
- **Desvio consciente do brief:** o brief pedia body `{status:"config_required"}`, mas o invariante 3 exige **RFC 7807**, onde `status` é o **código HTTP numérico**. Manter as duas coisas era impossível: o marcador foi para **`code:"config_required"`**, com `status:501`, `provider` e `missing[]` ao lado. O front lê `code`.
- **Consequências:** `ConfigModule` é `@Global` e entra primeiro no `AppModule`; `problem-details.filter` repassa o payload do gating; `ApiError` no front preserva o corpo e o componente `ConfigRequired` mostra "Configurar {provider}" com as vars exatas — **nunca "algo deu errado"**. Canário (`config.service.spec.ts` + boot real com `.env` sem terceiros): **0 erros**, login/CRM/inbox operam, externas respondem 501 com `missing[]`. Nota operacional: o **Prisma carrega o `.env` no `process.env`**, então um canário de shell só é honesto com o `.env` limpo.

### ADR-0007 — Conectores de anúncios plugáveis + cripto de credenciais (Sprint A)
- **Status:** Aceito e implementado (Meta; TikTok/Google no Sprint B).
- **Contexto:** conectar contas de anúncios é **multi-tenant via OAuth** (token do cliente), com múltiplos providers que compartilham o mesmo ciclo (auth → sync → insights → health).
- **Decisão:** contrato único `AdsConnector` (`buildAuthUrl/exchangeCode/listAdAccounts/syncCampaigns/syncCreatives/syncInsights/healthCheck`); providers isolados (`MetaAdsConnector` sobre um `GraphClient` injetável — mockável em teste). Registro `ADS_CONNECTORS` (record provider→connector). Sync assíncrono via **BullMQ** (fila `ads-sync`), idempotente, com `ad_sync_runs`. Periódico: `AdsSyncScheduler` (só no worker) agenda `sync-todos` a cada 6h via `upsertJobScheduler` — o processor varre as integrações de ads conectadas e sincroniza uma a uma; falha de uma não derruba as outras. `CryptoService` **AES-256-GCM** (`INTEGRATIONS_ENCRYPTION_KEY`, 32 bytes) cifra as credenciais por tenant em repouso. OAuth **stateless** com `state` assinado por **HMAC-SHA256** (`JWT_SECRET`) carregando o tenant (callback é público; o browser volta via `WEB_URL/api/integrations/meta/callback` → Nest). Degradação limpa: sem `META_APP_ID`/cripto → `auth-url` 400 explicativo; sem conexão → tela "Conecte sua conta".
- **Consequências:** `db/005_integrations_schema.sql` (7 tabelas, RLS + isolamento), env opcionais (só `JWT_SECRET` fatal), 32 testes verdes (incl. cripto + mapping do conector). Insights hoje são **nível campanha** (criativo "melhor performando" aproxima por ROAS da campanha ligada; insight nível-ad refina no Sprint B). Webhook Meta faz verify + ack; ingestão lead→contato depende do mapeamento page↔tenant (Sprint D).

### ADR-0006 — Auth pré-tenant: identidade global + memberships (FASE 1)
- **Status:** Aceito e implementado (verificado end-to-end).
- **Contexto:** login acontece **antes** de saber o tenant; RLS exige tenant no contexto. Um usuário pode pertencer a vários tenants.
- **Decisão:** separar **identidade** de **tenant**. `identities` (global, credenciais, **sem RLS**), `memberships` (identidade↔tenant N:N), `refresh_tokens`/`invites` (infra, sem RLS). Tabelas de **negócio/tenant** (incl. `audit_logs`, `webhook_events`) permanecem com RLS + caso no teste de isolamento. Justificativa do invariante 1: infra de auth não carrega dado de negócio; consultas sempre filtram por email/identity/token.
- **Fluxo:** senha com **argon2id**; **JWT de acesso 15min** `{sub, tenant_id, role, email}` + **refresh rotativo** (hash em `refresh_tokens`, revogável). Guard global `JwtAuthGuard` injeta `tenant_id` do JWT no `withTenant()`. O front mantém a sessão em **cookies httpOnly** geridos por rotas `/api/auth/*` do Next (proxy → Nest); `x-tenant-id` sai do caminho de request (só server-to-server via Bearer). **OAuth Google/GitHub plugável** (NextAuth) — sem credenciais, falha explícita (`501`), nunca mock silencioso.
- **Consequências:** `db/004_auth_tenants.sql`; módulos `auth`/`tenants`; `tenants` ganha INSERT para `khub_app` (signup) — marcado para endurecer com RLS depois. Verificado: 2 tenants isolados por JWT, rotação/revogação de refresh, 401 sem token.

### ADR-0005 — `apps/web`: cérebro Obsidian como backend do MVP
- **Status:** Aceito (esta sessão) — direcionado pelo product owner ("crie o front end em next, e o back end com o cérebro do obsidian atuando como back do sistema").
- **Contexto:** Pedido explícito de um front Next.js cujo backend é o próprio cérebro Obsidian. O produto "de verdade" (F-phases) usa NestJS + Postgres + RLS (stack congelada) — isto não substitui aquilo.
- **Decisão:** `apps/web` é um app Next.js 14 (App Router) onde `lib/cerebro.ts` lê o vault markdown do filesystem e expõe via Route Handlers (`/api/cerebro`, `/api/cerebro/[...slug]`, `/api/health`). Server Components consomem a mesma lib. É um **MVP/camada de conhecimento aditiva e reversível** — dogfooding do RAG (PRD §15.2). Marca a partir dos assets do projeto (`logo.png`, `#7B2FBE`).
- **Consequências:** Sem banco nesta camada — não confundir com o backend NestJS das F-phases (que segue valendo; `db/` do RAG intacto). Guard anti path-traversal em `lib/cerebro.ts:safeJoin`. Quando o NestJS existir, o cérebro-como-backend pode virar uma fonte do módulo `rag` (ingestão do próprio vault) sem retrabalho. **Verificado em runtime** (typecheck+build+endpoints na porta 3221). Porta 3000 ocupada por outro projeto local ("SmartFood") — rodar o KHUB em outra porta.
- **Stack fixada aqui (parcial do ADR-0002):** Next 14.2.35 (patch de segurança), React 18.3.1, Tailwind 3.4, react-markdown 9 + remark-gfm 4, TypeScript 5.5 strict. Node 20.20.2 (nvm).

### ADR-0004 — Antecipar a fundação de dados do RAG (R0) antes do resto de F0
- **Status:** Aceito (esta sessão) — direcionado pelo product owner ("inicie o desenvolvimento do RAG").
- **Contexto:** O roadmap põe a Nyro/RAG em F3. O product owner forneceu um pacote de RAG completo (spec, schema, retrieval, tasks R0-R4) e mandou começar. O pacote exige, como gate inegociável, **R0 = schema + RLS + teste de vazamento antes de qualquer IA**. Porém não há monorepo nem tabela `tenants` (F0-08/09 não feitos).
- **Opções:** (1) recusar e concluir F0 primeiro; (2) começar o RAG por cima do nada, com stubs; (3) entregar só a fundação de dados R0 (SQL + roles + teste), que não depende de toolchain nem de chaves externas, e criar uma `tenants` mínima como ponte.
- **Decisão:** Opção 3. Entregue: `db/000_foundation.sql` (tenants mínima + roles `khub_app` NOBYPASSRLS / `khub_service` BYPASSRLS), `db/001_rag_schema.sql` (fornecido, verbatim), `db/001a_rls_harden.sql` (FORCE RLS + RLS de `nyro_guardrail_hits` + grants), `db/002_isolation_test.sql` (teste de vazamento bloqueante). RAG code TS (R1+) e Prisma (R0.3) ficam para quando o monorepo existir.
- **Consequências:** A `tenants` mínima **será estendida/substituída** pelo schema completo em F0-09 (a migração deve ser compatível — mesma PK `uuid`). RLS do RAG usa a GUC `app.current_tenant_id` (o resto do produto usará a mesma convenção; alinhar ADR-0003 para `app.current_tenant_id`, não `app.tenant_id`). Sequência de F0 fica: fundação RAG (feita) → monorepo/infra (F0-07/08) → Prisma+auth+tenants (F0-09/11/12) → wire dos serviços RAG (R1). **Não executado nesta máquina** (sem Postgres) — ver Verificação no report e `db/README.md`.
- **Relacionado:** ADRs do subsistema em [[RAG/RAG]] §2 (ADR-01..08).

### ADR-0003 — Estratégia de RLS e injeção de contexto de tenant *(PENDENTE — Bloco 3 de F0)*
- **Status:** Proposto.
- **Contexto:** Isolamento por RLS exige `SET LOCAL app.tenant_id` por transação e um role de banco não-superusuário sujeito às policies. Prisma não abre transação por request nativamente para `SET LOCAL`.
- **Opções a avaliar:** (a) middleware Prisma + `$transaction` com `SET LOCAL`; (b) client Postgres dedicado por request; (c) `app.tenant_id` via `set_config`. Escolher e documentar com teste de isolamento.
- **Decisão:** — (a registrar no Bloco 3).

---

## 9. Observabilidade
- Sentry (erros front + back), OpenTelemetry (traces), logs estruturados JSON com `correlation-id` e `tenant_id` mascarado quando necessário.
- Timeline visual por execução de automação (nó a nó) — ver [[PRD]] §7.2.

> ⚠️ LACUNA: destino de logs/traces (Grafana Cloud? Loki? Datadog?) não definido no PRD. Adiar para quando observabilidade for realmente ligada; registrar ADR.

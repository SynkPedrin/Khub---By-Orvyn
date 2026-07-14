# Arquitetura — Orvyn

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
- `logo.png` — 1058×1058, PNG RGBA. Símbolo: trevo de quatro folhas em ametista (quatro corações de diamante roxo) + wordmark "ORVYN".
- `Identidade visual.png` — 1340×1320, símbolo sobre fundo creme claro com wordmark "ORVYN" abaixo.

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

### ADR-0005 — `apps/web`: cérebro Obsidian como backend do MVP
- **Status:** Aceito (esta sessão) — direcionado pelo product owner ("crie o front end em next, e o back end com o cérebro do obsidian atuando como back do sistema").
- **Contexto:** Pedido explícito de um front Next.js cujo backend é o próprio cérebro Obsidian. O produto "de verdade" (F-phases) usa NestJS + Postgres + RLS (stack congelada) — isto não substitui aquilo.
- **Decisão:** `apps/web` é um app Next.js 14 (App Router) onde `lib/cerebro.ts` lê o vault markdown do filesystem e expõe via Route Handlers (`/api/cerebro`, `/api/cerebro/[...slug]`, `/api/health`). Server Components consomem a mesma lib. É um **MVP/camada de conhecimento aditiva e reversível** — dogfooding do RAG (PRD §15.2). Marca a partir dos assets do projeto (`logo.png`, `#7B2FBE`).
- **Consequências:** Sem banco nesta camada — não confundir com o backend NestJS das F-phases (que segue valendo; `db/` do RAG intacto). Guard anti path-traversal em `lib/cerebro.ts:safeJoin`. Quando o NestJS existir, o cérebro-como-backend pode virar uma fonte do módulo `rag` (ingestão do próprio vault) sem retrabalho. **Verificado em runtime** (typecheck+build+endpoints na porta 3221). Porta 3000 ocupada por outro projeto local ("SmartFood") — rodar o Orvyn em outra porta.
- **Stack fixada aqui (parcial do ADR-0002):** Next 14.2.35 (patch de segurança), React 18.3.1, Tailwind 3.4, react-markdown 9 + remark-gfm 4, TypeScript 5.5 strict. Node 20.20.2 (nvm).

### ADR-0004 — Antecipar a fundação de dados do RAG (R0) antes do resto de F0
- **Status:** Aceito (esta sessão) — direcionado pelo product owner ("inicie o desenvolvimento do RAG").
- **Contexto:** O roadmap põe a Nyro/RAG em F3. O product owner forneceu um pacote de RAG completo (spec, schema, retrieval, tasks R0-R4) e mandou começar. O pacote exige, como gate inegociável, **R0 = schema + RLS + teste de vazamento antes de qualquer IA**. Porém não há monorepo nem tabela `tenants` (F0-08/09 não feitos).
- **Opções:** (1) recusar e concluir F0 primeiro; (2) começar o RAG por cima do nada, com stubs; (3) entregar só a fundação de dados R0 (SQL + roles + teste), que não depende de toolchain nem de chaves externas, e criar uma `tenants` mínima como ponte.
- **Decisão:** Opção 3. Entregue: `db/000_foundation.sql` (tenants mínima + roles `orvyn_app` NOBYPASSRLS / `orvyn_service` BYPASSRLS), `db/001_rag_schema.sql` (fornecido, verbatim), `db/001a_rls_harden.sql` (FORCE RLS + RLS de `nyro_guardrail_hits` + grants), `db/002_isolation_test.sql` (teste de vazamento bloqueante). RAG code TS (R1+) e Prisma (R0.3) ficam para quando o monorepo existir.
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

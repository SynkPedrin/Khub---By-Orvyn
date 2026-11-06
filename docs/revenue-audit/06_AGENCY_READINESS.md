# 06 — Agency Mode: Prontidão (auditoria somente leitura)

Data: 2026-10-14. Escopo: `apps/api/src/agency`, `db/026_agency.sql`, `db/027_account_settings.sql`, `apps/web/components/agency`, `apps/web/app/(app)/agency`. Nenhum código foi alterado. Nenhum teste foi executado: tudo abaixo vem de leitura estática. Existência de código não foi tratada como funcionalidade; onde a prova depende de execução está marcado.

## 1. Modelo de dados

| Entidade | Tabela | Observação |
|---|---|---|
| Agency | `agencies` (026:21) | `owner_identity_id`, `slug` único, `is_demo`, `settings jsonb` (027) |
| Membros | `agency_members` (026:30) | roles `owner/admin/member/viewer`; `UNIQUE(agency_id, identity_id)` |
| Cliente/subconta | `agency_client_accounts` (026:40) | apontador para `tenants.id`; status `active/paused/archived` |
| Acesso granular | `agency_member_client_access` (026:56) | ausência de linha = vê TODOS os clientes |
| Convites | `agency_invites` (027:8) | token com hash sha256, 7 dias, `client_ids uuid[]` |
| Tenant ativo | sem tabela | vive no JWT (`tenant_id`) e em `refresh_tokens.tenant_id` |

Todas as tabelas são globais, sem RLS e sem `tenant_id`. A autorização depende só do serviço (`AgencyService.membroDe/clientesVisiveis`, `agency.service.ts:30,54`). Uma identidade só pertence a uma agência (`findFirst({identityId})`, `agency.service.ts:31`; checado nos convites em `agency-admin.service.ts:44,71`). Não existe constraint no banco que impeça duas agências para a mesma identidade.

## 2. Contexto de tenant: como troca

- Mecanismo: `POST /v1/agency/clients/:id/activate` (`agency.controller.ts:54`). O serviço faz upsert de `Membership` e `User` no tenant do cliente e emite novo par access/refresh com `tenant_id` do cliente (`agency.service.ts:119-157`).
- A rota Next `apps/web/app/api/agency/clients/[id]/activate/route.ts:14-31` troca os cookies httpOnly (`setSession`). Não há header de tenant nem cookie separado. O tenant vem sempre do JWT (`jwt-auth.guard.ts:55-65`), e o guard revalida membership e `tenant.status` em cada request (2 queries por request).
- O front faz `window.location.href = destino` (reload completo, `AgencyProvider.tsx:110-111`), com overlay de 650 ms e `inert` no conteúdo. Isso zera estado React do tenant anterior. Troca sem logout: sim, no código.
- Refresh preserva o tenant (`token.service.ts:62-72`, `auth.service.ts:108-109`).
- Dados e integrações trocam juntos porque toda leitura passa por `withTenant(tenantId)` com RLS e integrações são linhas por tenant. Prova de isolamento por RLS não foi executada nesta auditoria (há `db/002_isolation_test.sql` e `apps/api/scripts/test-isolation-api-keys.mjs`, não rodados).

Fluxo ponta a ponta (leitura do código):

| Passo | Estado | Evidência |
|---|---|---|
| Login do dono redireciona para `/agency` | OK | `LoginForm.tsx:42` |
| Agency Dashboard | PARCIAL (só contagens por cliente) | `agency/page.tsx` |
| Criar cliente | OK, só nome e nicho | `agency/clients/page.tsx:70-120`, `agency.service.ts:97-110` |
| Configurar cliente | NÃO HÁ tela; só "Entrar na operação" | `agency/clients/[id]/page.tsx` |
| Entrar na subconta | OK | `ClientCard.tsx:47`, `Sidebar.tsx:79`, `Topbar.tsx:183` |
| Trocar de cliente sem logout | OK para owner/admin; QUEBRA para member/viewer (ISSUE-A1) | ver abaixo |
| Voltar à agência | Link `/agency` no menu; owner/admin OK | `Sidebar.tsx:73` |
| Criar a própria agência | NÃO EXISTE endpoint nem UI; só `seed-content-demo.mjs:247` | ISSUE-A6 |

## 3. Notas (0 a 5)

| Dimensão | Nota | Evidência resumida |
|---|---|---|
| Client provisioning | 3 | `TenantsService.provision` cria tenant, owner, funil padrão de 5 etapas, atividade e audit (`tenants.service.ts:25-50`). Não é transacional (tenant e membership criados fora do `withTenant`; falha no meio deixa tenant órfão sem vínculo com a agência). Não há blueprint na criação, nem edição, pausa, arquivamento ou exclusão de cliente (nenhum endpoint). Nome do usuário fixo `'Responsável'` (`agency.service.ts:103`). |
| Tenant isolation | 3 | Bom: RLS por tenant, métrica por tenant sem query cruzada, ID de cliente de outra agência não resolve (teste em `agency.service.spec.ts:110`). Falhas: pausar/arquivar não revoga acesso (ISSUE-A2), remover membro não revoga memberships (ISSUE-A3), ownership permanente do criador em todos os tenants. |
| Integrations | 1 | Nenhuma visão agregada. `GET /integrations` e `/integrations/meta/diagnostics` existem só por tenant ativo (`integrations.controller.ts:16,27`). Status/health/`lastSyncAt` existem na tabela mas a agência não os lê. |
| Automation deployment | 2 | Só `BlueprintService.aplicar` e `MarketplaceService.instalar` dentro do tenant ativo (`blueprint.service.ts:41-75`). Sem implantação em lote, sem template próprio da agência, sem cópia entre tenants (pipeline, tags, campos customizados, automações). Blueprints são 3 playbooks fixos em código (`playbooks.ts`). |
| Operational overview | 2 | `/agency` mostra clientes, total de leads, negócios (rótulo incorreto, ISSUE-A5), clientes ativos. Sem alertas, sem saúde, sem automações com erro, sem integrações desconectadas. Carga N+1 (ISSUE-A7). |
| Support diagnostics | 1 | `OperationsService.snapshot` (workers, fila, outbox) existe por tenant com `organization.manage` e não tem UI nem visão agência (`operations.controller.ts:7`). Auditoria de agência grava só `agency.client.create/activate` no tenant do cliente. Não há log de "quem entrou no cliente" visível ao dono do cliente. |
| Permissions | 2 | Papéis existem, mas o guard HTTP mapeia `agency` para `organization.manage` em POST (`permissions.guard.ts:22`), o que quebra member/viewer (ISSUE-A1). Acesso granular sem linha = acesso total (default aberto). Sem edição de papel, sem remoção de membro. |
| Onboarding | 2 | `/onboarding` aplica blueprint, mas não está linkado em nenhum lugar (grep) e a criação de cliente não leva a ele. Passos manuais: criar cliente, entrar, ir a `/onboarding` digitando a URL, conectar WhatsApp (link quebrado, ver 07 ISSUE-B1), conectar Meta, ativar automações. Sem checklist nem progresso. |
| Billing readiness | 0 | `tenants.plano` default `'starter'` (`schema.prisma:47`), sem enforcement, sem limites, sem faturamento da agência. Stripe só gera links de cobrança do cliente final (`financeiro.service.ts:106`), não é cobrança SaaS. Cartão "Plano Pro" é texto fixo (`Sidebar.tsx:133`) e "Fazer upgrade" aponta para aba inexistente. |
| Scalability | 2 | `listarClientes` faz `crm.overview` por cliente, sem paginação, e cada `overview` carrega todos os deals e a lista de stages do tenant (`crm.service.ts:97-102`, sem `take`). `ativarCliente` e guard fazem várias queries. Reconcile do worker itera todos os tenants a cada 5 s (`operations.service.ts:26-52`). Sem cache. |

Média: 1,8. Veredito: Agency Mode é um seletor de subcontas funcional para o dono. Não é ainda uma plataforma de operação de agência.

## 4. Problemas

### ISSUE-A1 — Membro e visualizador da agência não conseguem trocar de cliente
- SEVERITY: Alta (bloqueia o fluxo para todo convidado que não é owner/admin; a validação por execução não foi feita)
- ROOT CAUSE: `permissionFor('agency', 'clients/:id/activate', 'POST')` cai no ramo final e exige `organization.manage` (`permissions.guard.ts:22`). Em cada tenant de cliente, `ativarCliente` cria o membership como `member`/`viewer` (`agency.service.ts:128`), e esses papéis não têm `organization.manage` (`permissions.guard.ts:25-31`). A rota `/agency/invites/accept` é `@Public`, então só o aceite funciona.
- FILES: `apps/api/src/auth/permissions.guard.ts:22,25-33`; `apps/api/src/agency/agency.controller.ts:54`; `apps/api/src/agency/agency-admin.service.ts:74-77`
- IMPACT: convidado `member` cai no primeiro cliente do convite (`agency-admin.service.ts:82`) e recebe 403 ao tentar outro. O front mostra "Não foi possível entrar nesta subconta" (`AgencyProvider.tsx:115`). O restante do mesmo controller (`GET`) funciona (leitura exige `contacts.read`).
- RECOMMENDED FIX: tratar o controller `agency` como caso próprio em `permissionFor` (autorização feita no serviço por `agency_members`), liberando `activate` e `GET` para qualquer membro da agência. Manter `POST clients` restrito a owner/admin no serviço (já está, `agency.service.ts:100`).
- ACCEPTANCE CRITERIA: teste de integração com membro `member` convidado para 2 clientes alterna A para B para A com 200; viewer também alterna; membro fora da lista de acesso recebe 403/404 para o terceiro cliente.

### ISSUE-A2 — Pausar ou arquivar cliente não corta o acesso existente
- SEVERITY: Alta
- ROOT CAUSE: o guard valida apenas `tenant.status === 'active'` (`jwt-auth.guard.ts:63-64`). `agency_client_accounts.status` só é checado em `ativarCliente` (`agency.service.ts:125`). Além disso, não existe endpoint para mudar esse status (nenhum PATCH/DELETE no controller).
- FILES: `apps/api/src/auth/jwt-auth.guard.ts:60-64`; `apps/api/src/agency/agency.service.ts:119-125`; `apps/api/src/agency/agency.controller.ts`
- IMPACT: (a) não há como pausar nem arquivar cliente pela API/UI; (b) se alguém alterar o status direto no banco, quem já está dentro continua operando até o refresh (30 dias, `token.service.ts:54`) e depois ainda renova.
- RECOMMENDED FIX: endpoints `PATCH /agency/clients/:id` (nome, status) e propagar o status para `tenants.status` ou checar `agency_client_accounts` no guard para tokens de agência. Revogar refresh tokens do tenant ao pausar.
- ACCEPTANCE CRITERIA: após pausar o cliente, request autenticada de membro da agência nesse tenant retorna 401/403 em até 1 request; `activate` retorna 403; reativar restaura.

### ISSUE-A3 — Sem offboarding: remover membro ou convite não revoga memberships nos tenants
- SEVERITY: Alta
- ROOT CAUSE: `AgencyMember` não tem endpoint de remoção nem de troca de papel. Memberships criados por `ativarCliente` e por `accept` (`agency.service.ts:130-134`, `agency-admin.service.ts:77`) vivem em `memberships`/`users` do tenant e nada os remove. O dono da agência é também `owner` do tenant de cada cliente que criou (`tenants.service.ts:33`).
- FILES: `apps/api/src/agency/agency.controller.ts`; `apps/api/src/agency/agency-admin.controller.ts`; `apps/api/src/agency/agency.service.ts:130`
- IMPACT: ex-funcionário da agência mantém acesso ao CRM dos clientes depois de sair. `agency_member_client_access` restringe apenas a listagem e o `activate`, não o acesso por membership já existente (um token antigo continua válido para o tenant).
- RECOMMENDED FIX: `DELETE /agency/members/:id` que remove `memberships`/`users` ativos nos tenants da agência e revoga refresh tokens (`revokeAllForIdentity`). Fazer o mesmo ao reduzir o acesso granular.
- ACCEPTANCE CRITERIA: após remover o membro, request com o access token antigo falha por "vínculo revogado" e `refresh` falha; `memberships` da identidade para tenants da agência é 0 linhas.

### ISSUE-A4 — Criação de cliente sem transação, sem blueprint, com dados genéricos
- SEVERITY: Média
- ROOT CAUSE: `tenants.provision` cria `tenant` e `membership` fora de `withTenant` e depois `agencyClientAccount.create` em outra chamada (`agency.service.ts:103-107`). Falha entre as etapas deixa tenant válido e invisível. Usuário criado com nome `'Responsável'` e e-mail da própria agência. Não recebe `nicho` de blueprint; `Tenant.templateId` não é preenchido.
- FILES: `apps/api/src/tenants/tenants.service.ts:25-50`; `apps/api/src/agency/agency.service.ts:97-110`; `apps/web/app/(app)/agency/clients/page.tsx:70-120`
- IMPACT: tenants órfãos cobrando custo de reconcile (`operations.service.ts:29` itera todos os ativos); onboarding 100% manual.
- RECOMMENDED FIX: executar provision + vínculo em uma transação ou compensar em erro; aceitar `blueprint` opcional no DTO e aplicar via `BlueprintService.aplicar`.
- ACCEPTANCE CRITERIA: falha forçada em `agencyClientAccount.create` não deixa tenant ativo sem vínculo; DTO com `blueprint` cria funil e automações no cliente.

### ISSUE-A5 — Métricas da agência rotuladas de forma enganosa e dependentes de heurística
- SEVERITY: Média
- ROOT CAUSE: `kpis.negocios = deals.length` (todos os negócios, ganhos e perdidos) alimenta "Negócios abertos (total)" (`agency/page.tsx:38`). `receitaFechada` = soma dos deals na "última etapa" ordenada por `ordem` entre TODAS as etapas de TODOS os pipelines do tenant (`crm.service.ts:106-107`); com mais de um funil (blueprint adiciona funil novo) a "última" é arbitrária. `ClientCard` mostra isso como "receita registrada".
- FILES: `apps/api/src/crm/crm.service.ts:95-127`; `apps/api/src/agency/agency.service.ts:75-81`; `apps/web/app/(app)/agency/page.tsx:38-39`; `apps/web/components/agency/ClientCard.tsx:33`
- IMPACT: dono da agência lê "negócios abertos" e "receita" que não são isso. Classificação: ESTIMATED/DERIVED com rótulo de REAL.
- RECOMMENDED FIX: marcar estágio ganho/perdido explicitamente por etapa (flag) e calcular abertos, ganhos e perdidos por pipeline; renomear rótulos até lá.
- ACCEPTANCE CRITERIA: cliente com 3 deals (1 ganho, 1 perdido, 1 aberto) mostra aberto = 1; com 2 funis a receita ganha não depende de ordem global.

### ISSUE-A6 — Não existe criação de agência nem visão de saúde/alertas
- SEVERITY: Média (produto) / Alta (se o objetivo é vender o modo agência)
- ROOT CAUSE: `Agency` só é criada por script de seed demo (`apps/api/scripts/seed-content-demo.mjs:247`); sem endpoint, sem tela de signup agência, sem papel de plataforma. Nenhuma API agrega integrações desconectadas, automações com erro, fila de falhas ou worker offline por cliente.
- FILES: `apps/api/src/agency/*` (ausência); `apps/api/src/integrations/integrations.service.ts:152`; `apps/api/src/operations/operations.service.ts:79`
- IMPACT: onboarding de agência exige operação manual no banco; "achar problemas" na carteira é abrir cliente por cliente.
- RECOMMENDED FIX: `POST /agency` (self-service ou convite admin), e `GET /agency/health` com por cliente: integrações com `status != connected`/`health`, `lastSyncAt` antigo, falhas e DLQ de automações (usando o status correto, ver ISSUE-B7 em 07), mensagens com `deliveryStatus` incerto.
- ACCEPTANCE CRITERIA: dono cria agência sem script; `/agency` lista clientes com semáforo e motivo; cliente com Meta desconectada aparece com alerta.

### ISSUE-A7 — Escalabilidade da visão consolidada
- SEVERITY: Média
- ROOT CAUSE: `listarClientes` executa `Promise.all(crm.overview)` sem limite de concorrência; `overview` faz `deal.findMany({include:{contact:true}})` sem `take` e conta tudo (`crm.service.ts:97-102`). `/agency/overview` chama de novo `listarClientes`, e o `AgencyProvider` também chama `listarClientes` no boot de qualquer página (`AgencyProvider.tsx:43`), para toda identidade com agência.
- FILES: `apps/api/src/agency/agency.service.ts:66-83,160-167`; `apps/api/src/crm/crm.service.ts:95-127`; `apps/web/components/agency/AgencyProvider.tsx:38-51`
- IMPACT: com dezenas de clientes e milhares de deals, cada page load de qualquer rota do app dispara N consultas pesadas, ocupando o pool do Prisma.
- RECOMMENDED FIX: separar lista leve (id, nome, status) das métricas; métricas por `COUNT/SUM` agregados e cacheados (Redis, TTL curto); limite de concorrência.
- ACCEPTANCE CRITERIA: `/agency/clients` retorna a lista em <300 ms com 100 clientes; métricas carregam sob demanda.

### ISSUE-A8 — Atalhos do detalhe do cliente ignoram o destino
- SEVERITY: Baixa
- ROOT CAUSE: os 7 botões de "Atalhos" chamam `entrarNoCliente(cliente.id)` sem usar `a.href` (`clients/[id]/page.tsx:86-88`); o destino é `ROTAS_SEGURAS.has(pathname) ? pathname : '/dashboard'` (`AgencyProvider.tsx:110`), e `/agency/clients/:id` não está no conjunto.
- FILES: `apps/web/app/(app)/agency/clients/[id]/page.tsx:80-95`; `apps/web/components/agency/AgencyProvider.tsx:91-118`
- IMPACT: "Leads", "Pipeline", "Conversas" etc. levam todos ao `/dashboard`. A página promete "Abrem no contexto real deste cliente".
- RECOMMENDED FIX: `entrarNoCliente(id, destino)` com whitelist.
- ACCEPTANCE CRITERIA: clicar em "Pipeline" aterrissa em `/pipeline` do cliente.

### ISSUE-A9 — Convite de agência: tela de aceite e UX com falhas de estado
- SEVERITY: Baixa
- ROOT CAUSE: `AgencyInvites` mostra `acceptUrl` e depende do Resend; mensagem "Convite enviado pelo Resend" fixa (`AgencyInvites.tsx:13`) enquanto o mailer é genérico (`SMTP_URL` em `config.service.ts:22`). Convite sempre cria acesso a clientes selecionados mesmo para `admin`, que o texto diz ter acesso total (`agency-admin.service.ts:73`, ok no código, mas `clientesVisiveis` ignora a lista para admin). Aceite devolve sessão no `clients[0]`.
- FILES: `apps/web/components/agency/AgencyInvites.tsx:13-15`; `apps/api/src/agency/agency-admin.service.ts:34-87`
- IMPACT: texto de suporte enganoso; admin convidado recebe memberships só nos clientes listados e só ganha acesso aos novos clientes via `activate` (que cria membership sob demanda; ok).
- RECOMMENDED FIX: mensagem genérica de provedor de e-mail; testar o aceite de ponta a ponta.
- ACCEPTANCE CRITERIA: teste e2e de convite para `viewer` e `admin` passa; texto reflete o provedor configurado.

## 5. Templates de agência e cópia entre tenants

Não existe. O que há:
- `BlueprintService.aplicar` (3 playbooks fixos: odontologia, advocacia, contabilidade) cria funil e instala automações do marketplace por busca textual (`blueprint.service.ts:47-59`). Idempotência por `tenant.templateId`; depois de aplicado, outro blueprint cria outro funil sem remover o anterior.
- `MarketplaceService.instalar` cria workflow a partir de `AutomationTemplate` global ou do tenant. Não existe "salvar automação do cliente A como template da agência" nem "copiar para B".
- Tags, campos customizados, etapas e templates de mensagem não têm export/import.
- Cópia segura entre tenants exigiria leitura sob RLS do origem e escrita sob RLS do destino em passos distintos, sem IDs cruzados. Não há nenhuma implementação para auditar.

Recomendação: introduzir `agency_templates` (jsonb versionado: pipeline, etapas, tags, automações sem credenciais e sem IDs de contato) e um aplicador que valide o schema e remapeie IDs. Aceite: aplicar o mesmo template a 2 clientes cria estruturas independentes e idempotentes, e nenhuma linha referencia IDs do tenant de origem.

## 6. O que foi verificado e está correto

- Cliente de outra agência não é visível, nem ativável, mesmo com o ID (`agency.service.spec.ts:110`, leitura do código em `agency.service.ts:85-90,122-124`).
- `ativarCliente` não faz impersonation; exige membro da agência e cliente `active`; idempotente em membership/user.
- Convite: token de 32 bytes só em hash, expiração 7 dias, claim atômico com `updateMany`, trava `FOR UPDATE` na agência, limite de role para `admin` só pelo owner.
- Auditoria de criar/ativar gravada no tenant do cliente (`agency.service.ts:169-174`), com `SkipAudit` para não duplicar no tenant errado.
- Reload completo ao trocar, com `inert` e `prefers-reduced-motion` respeitado.

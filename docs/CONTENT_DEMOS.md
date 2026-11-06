# Content Operations Lab — 3 operações demonstrativas

Três tenants **reais** no banco (`tenants.is_demo = true`, `dataset_version = 'content-v1'`), criados para gravação de conteúdo e demonstração comercial. Nenhum dado pessoal real, nenhuma mensagem externa enviada, nenhuma conta de anúncio real tocada.

## Como rodar

```bash
cd apps/api
node scripts/seed-content-demo-run.mjs   # idempotente — roda de novo e pula quem já existe
node scripts/seed-content-demo-clean.mjs # remove só os tenants is_demo=true deste dataset
```

Requer `ADMIN_DATABASE_URL` (padrão: `postgresql://postgres:postgres@localhost:5432/orvyn`) — os scripts conectam como superuser pra criar tenant do zero (RLS não filtra; todo INSERT seta `tenantId` explicitamente).

**Importante para ver os dados reais no navegador**: `apps/web/.env.local` precisa ter `NEXT_PUBLIC_ORVYN_DEMO=0`. Com `=1`, o app inteiro mostra o dataset de vitrine estático (`lib/demo/dataset`) em vez de consultar qualquer tenant real — inclusive os 3 tenants desta seed.

## Login de cada operação

| Operação | E-mail | Senha |
|---|---|---|
| Clínica Vitta Prime | `demo.clinic@conteudo.orvyn.app` | `ContentDemo2026!` |
| Helios Energia | `demo.solar@conteudo.orvyn.app` | `ContentDemo2026!` |
| Forma Casa Planejados | `demo.planned_furniture@conteudo.orvyn.app` | `ContentDemo2026!` |

Senha configurável via `CONTENT_DEMO_SENHA` antes de rodar a seed. Não existe organization switcher no produto hoje (auditado — `TenantsService.membershipsOf()` existe no backend, nada no front o consome) — trocar de operação é logout/login com a credencial de cada uma.

## O que existe de verdade em cada uma

Cada operação tem: 1 campanha Meta Ads (`provider: meta_demo`, nunca toca a API real da Meta), 3 criativos com métricas diárias de 30 dias (nível `creative` — fonte da verdade — e `campaign`, agregado), leads/contatos atribuídos por criativo real (`contacts.ad_campaign_id`/`ad_creative_id`, migration 025), negócios no pipeline, e automações reais publicadas no engine (BullMQ, mesmo `Workflow`/`WorkflowVersion` de produção).

### 1 — Clínica Vitta Prime (estética/harmonização)
- Campanha "Vitta | Harmonização Facial | Setembro" — 3 criativos, funil lead→agendamento→comparecimento→venda.
- 93 contatos, 9 vendas fechadas, **R$ 30.900** em receita fechada (soma exata dos `ad_insights` de cada criativo).
- 5 leads com conversa rica (WhatsApp real no banco, nunca enviada externamente): Ana Ferreira, Carolina Mendes, Juliana Rocha, Mariana Costa, Fernanda Lima.
- 4 automações: Lead Meta → Atendimento · Sem resposta → Follow-up 2h · Avaliação amanhã · No-show recovery.

### 2 — Helios Energia (solar empresarial)
- Campanha "Helios | Solar Empresarial | Setembro" — funil lead→qualificado→proposta→venda.
- Pipeline com nomenclatura própria: Entrada/Qualificação/Reunião/Proposta/Negociação/Fechamento.
- 93 contatos (89 do funil da campanha + 4 negócios nomeados curados), 5 vendas, **R$ 302.000** (R$ 244.000 do funil da campanha + R$ 58.000 do negócio nomeado Rafael Nunes/LogTech, que já nasce `CLOSED_WON`).
- Negócios nomeados: Marcos Vieira (NovaSul, R$82k, Proposta), Carla Mendes (Horizonte, R$64k, Negociação), Rafael Nunes (LogTech, R$58k, Fechamento/ganho), Bruno Martins (AgroVale, R$96k, Negociação — com tarefa real "Revisar proposta parada", 5 dias sem atividade).
- 4 automações: Lead Solar Qualification · Proposal Follow-up (48h + 72h) · Hot Opportunity · Stalled Proposal.

### 3 — Forma Casa Planejados (móveis sob medida)
- Campanha "Forma Casa | Projetos Sob Medida" — funil lead→qualificado→visita→proposta→venda (5 etapas, o mais longo dos três).
- 110 contatos (106 do funil + 4 nomeados), 5 vendas, **R$ 126.000** (R$ 95.000 do funil + R$ 31.000 do nomeado Fernando Costa, `CLOSED_WON`).
- Negócios nomeados: Camila Rocha (R$28,5k, Proposta), Lucas Almeida (R$47k, Negociação), Beatriz Martins (R$16,5k, Negociação), Fernando Costa (R$31k, Fechado/Ganho).
- 5 automações: Novo orçamento · Projeto enviado · Orçamento parado · Visita agendada.

## Roteiros de gravação

**Vídeo 1 — Clínica.** Hook: *"Não é sobre gerar mais leads. É sobre saber quais anúncios realmente viraram pacientes."* Abrir Campanhas → mostrar os 3 criativos ordenados por performance (Naturalidade sem exagero vence em CPL **e** receita, com os dois selos mostrando qual métrica cada um venceu — nunca "melhor criativo" sozinho). Abrir um lead com conversa. Abrir Automações. Fechar no Dashboard.

**Vídeo 2 — Solar.** Hook: *"Esse anúncio trouxe leads. Mas aqui começa a parte que quase ninguém acompanha."* Campanha → criativo vencedor → Pipeline (Marcos, Carla, Rafael, Bruno). Abrir Bruno Martins: *"O sistema identificou uma proposta relevante parada há 5 dias"* → mostrar a tarefa real criada + a automação "Stalled Proposal".

**Vídeo 3 — Móveis planejados.** Hook: *"Uma loja pode gerar dezenas de orçamentos e mesmo assim perder venda no follow-up."* Campanha Instagram → criativo → lead → projeto/proposta → oportunidade parada → automação → fechamento (Fernando Costa).

## Achados reais desta auditoria (corrigidos, não contornados)

1. **`AdsService.creatives()` misturava métricas de todos os criativos de uma campanha** (`apps/api/src/integrations/ads.service.ts`) — o JOIN usava `ad_insights.level='campaign'` em vez de `'creative'`, então todo criativo de uma campanha mostrava o mesmo número agregado. Corrigido; testado com os 9 criativos reais das 3 operações, cada um com números genuinamente diferentes.
2. **"Melhor criativo" era um booleano ambíguo** (`melhor: boolean`, baseado só em ROAS) — trocado por `melhorCpl`/`maiorReceita`, cada um dizendo explicitamente por qual métrica venceu (pedido explícito do brief: nunca "melhor" sem dizer o critério).
3. **`/leads`, `/pipeline` e `/analytics` nunca tinham caminho de dado real** — o padrão `{modoDemo() ? <ComDados/> : <Vazio/>}` sempre caía no vazio fora do modo demo, mesmo com dados reais no banco. Os clients (`lib/crm.ts`, `lib/analytics.ts`) e os endpoints reais já existiam, prontos, só nunca eram chamados. As três telas agora têm componente `*Real` com loading/erro/vazio honestos.
4. **Drift real entre Postgres e Prisma**: `tenants.is_demo` (migration 023) e onze colunas de `contacts` (`score`, `owner_id`, `origem`, etc., também da 023) existiam no banco desde julho mas nunca tinham entrado no `schema.prisma` — corrigido junto com a migration 025.
5. **`outbox_events` não tem `ON DELETE CASCADE`** a partir de `tenants` — o trigger real de domínio (migration 022) grava eventos genuínos a cada contact/deal/message inserido (confirmado: 93+22+10 eventos reais gerados pela seed da Clínica), então o cleanup precisa apagá-los antes do tenant. Script de limpeza corrigido e testado (zero órfãos confirmado via query).
6. **`AdsService.overview()` contava o mesmo dinheiro duas vezes** — a soma de `ad_insights` não filtrava por `level`, então cada real investido aparecia uma vez como linha `'creative'` e de novo como linha `'campaign'` (que já é o agregado das criativas). Achado ao comparar o KPI "Investido" (R$4.300) com a linha da tabela de campanhas (R$2.150) na tela real da Helios — a mesma conta, dois números. Corrigido com `WHERE level='campaign'`; `campaigns()` já filtrava certo, só `overview()` tinha o bug.

## O que ficou de fora (documentado, não fingido)

- **Sem organization switcher**: login separado por operação (ver tabela acima).
- **Analytics (`/analytics`) não mostra a cadeia campanha→criativo→receita** — hoje esse endpoint só cobre uso de IA e performance de automação (achado de uma auditoria anterior desta mesma sessão). A história de atribuição completa é contada via `/marketing/ads`, que já é honesta e real. Estender `/analytics` para atribuição de campanha é trabalho novo de backend, fora do escopo desta seed.
- **Pipeline real (`PipelineReal`) é mais enxuto que o board de demonstração**: sem empresa/tags/próxima ação por card, porque `Deal` real não tem esses campos hoje. Drag-and-drop persiste de verdade (`crm.moveDeal`), com rollback se a chamada falhar.
- **Thumbnails dos criativos são SVGs gerados pela própria seed** (`apps/web/public/demo-creatives/*.svg`) — cor da marca + nome + hook + selo "DEMO", nunca um screenshot de anúncio real nem logo de terceiro.

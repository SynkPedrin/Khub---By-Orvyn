# 07 — Produto, UX e Dashboard: demo vs real (auditoria somente leitura)

Data: 2026-10-14. Escopo: `apps/web` (app Next 14), `apps/api/src/crm/crm.service.ts` e `analytics` para rastrear a origem dos números. Nenhum código alterado, nenhum navegador aberto: tudo vem de leitura estática. Responsividade, contraste e foco foram avaliados pelo código, não visualmente.

Legenda de origem: REAL_DATABASE (lido do banco, rótulo fiel), DERIVED (calculado de dados reais com regra própria; o rótulo pode ser impreciso), ESTIMATED (heurística ou tabela fixa), DEMO (vem de `lib/demo/dataset.ts`), MOCK/SIMULATED (fabricado em runtime), HARDCODED (texto ou número fixo no JSX).

## 1. Separação demo vs real

- `modoDemo()` (`lib/demo/flag.ts:17-23`) retorna `false` sempre que `NODE_ENV === 'production'` e só liga com `NEXT_PUBLIC_ORVYN_DEMO=1`. O dataset (`lib/demo/dataset.ts`, 976 linhas, "R$ 284.500, 432 leads, 92%") é importado diretamente por 8 páginas, apesar do comentário em `dataset.ts:21` dizer que só `lib/revenue/source.ts` o acessa. Em build de produção o bundler ainda inclui o dataset no bundle cliente dessas páginas (peso morto, não vazamento de dado ao usuário).
- `lib/revenue/source.ts` (`useFonte`) não é usado por nenhuma página (grep em `app` e `components` sem ocorrência). O mecanismo documentado como "único lugar" é código morto; cada página decide por `modoDemo()` isoladamente.
- Dados "demo" também existem no banco real: o seed `seed-content-demo.mjs` cria tenants com `isDemo=true` e `ClientCard` exibe selo DEMO (`ClientCard.tsx:25`). Isso é separação por dado, correta.
- Resultado prático: em produção, 6 das 10 telas do menu principal só mostram estado vazio (seção 3). A separação é honesta, porém deixa o produto aparentar incompleto.

## 2. Origem de cada métrica

### Dashboard (`app/(app)/dashboard/page.tsx`), modo real

| Métrica / bloco | Origem | Evidência |
|---|---|---|
| Contatos | REAL_DATABASE | `tx.contact.count()` — `crm.service.ts:100,116` |
| "Negócios Abertos" | DERIVED com rótulo impreciso | `deals.length` conta TODOS os deals, inclusive ganhos e perdidos — `crm.service.ts:99,117` |
| "Valor em Pipeline" | DERIVED impreciso | soma de todos os deals, inclusive ganhos — `crm.service.ts:105` |
| "Taxa de Conversão" | ESTIMATED | total na última etapa (por `ordem`, entre as etapas de todos os funis) ÷ total de deals — `crm.service.ts:106,120`; legenda "última etapa do funil / total" é honesta, o nome não |
| Funil por etapa | REAL_DATABASE | `stage` + `deal` agrupados — mistura etapas de todos os pipelines numa lista (`crm.service.ts:98,109`) |
| Atividade recente | REAL_DATABASE | tabela `activity`, 6 últimas; `tone` ignorado, ícone sempre "info" (`dashboard/page.tsx:183-185`) |
| Tarefas de hoje | REAL_DATABASE | `crm.tasks('hoje')` |
| Crescimento de Receita | Estado vazio honesto | sem série histórica (`dashboard/page.tsx:158-164`); não há agregação diária no backend |
| Insights da IA ORVYN (selo "Beta") | Estado vazio honesto | nenhum dado, apenas link |
| Frase de cabeçalho "Mais conversas. Mais oportunidades. Mais receita." | HARDCODED (copy de marca) | `dashboard/page.tsx:54`; repetida com variações em 7 páginas |
| Cartão "Plano Pro" na sidebar | HARDCODED | `Sidebar.tsx:133`; plano real do tenant é `starter` (`schema.prisma:47`) |

### Dashboard, modo demo (somente desenvolvimento)
Todos DEMO: Leads do Dia 247, Taxa de Resposta, Follow-ups Pendentes, Receita Gerada, `RECEITA_30D`, `FUNIL_RESUMO`, `VALOR_PIPELINE`, `ATIVIDADE_RECENTE`, `PROXIMAS_TAREFAS`, `INSIGHTS_DASHBOARD` (`dashboard/page.tsx:15-23,261-379`). Seletor 7D/30D/3M/12M é decorativo (`SeletorPeriodo`, sem estado, `:428-438`).

### Outras telas

| Tela | Modo real | Origem |
|---|---|---|
| Leads (`leads/page.tsx`) | lista de `crm.contacts()` com cursor | REAL_DATABASE; sem score, canal ou status (não existem no modelo real). Botão "Novo Lead" sem `onClick` (`:42`) |
| Pipeline (`pipeline/page.tsx`) | `PipelineReal`: Valor em Pipeline, Oportunidades, Ticket Médio, Etapas | DERIVED (inclui ganhos; `:146-151`). Botão "Nova oportunidade" sem `onClick`; link `?aba=pipeline` quebrado (`:737`) |
| Analytics (`analytics/page.tsx`) | Custo de IA 30d, Execuções de IA, Taxa de sucesso das automações, Fila de falhas (DLQ) | Custo: ESTIMATED (tokens × tabela de preço fixa, `anthropic.provider.ts:24-27`); Execuções: REAL; Taxa de sucesso: DERIVED e **incorreta** (ISSUE-B7); DLQ: REAL. Botões "Últimos 30 dias" e "Todos os Canais" sem ação (`:53,58`) |
| Campanhas | só estado vazio | sem fonte; botão "Nova campanha" sem ação (`campanhas/page.tsx:456`) |
| Agenda | só estado vazio | o backend `agenda` e `lib/agenda.ts` existem, mas a página não os usa; "Nova reunião" sem ação (`agenda/page.tsx:538`) |
| Conversas (`/conversas`) | só estado vazio | a inbox real está em `/inbox`, fora do menu; botão "Nova conversa" sem ação (`conversas/page.tsx:40`) |
| IA (`/ia`) | só "O Copiloto precisa de uma credencial" | a página nunca consulta o backend; `EstadoProvedor` exibe "IA não configurada" fixo fora do demo (`ia/page.tsx:100-113`); a Nyro real está em `/nyro`, fora do menu |
| Perfil do lead (`/leads/[id]`) | sempre "Lead não encontrado" | `leads/[id]/page.tsx:49-67`; o detalhe real está em `/contatos/[id]` |
| Anúncios (`/marketing/ads`) | Meta real + `AdsSimulador` | SIMULATED em produção: gasto = orçamento×30, cliques = gasto×2,4, leads = 8% dos cliques, ROAS com ticket fixo R$ 480, guardado em `localStorage` (`AdsSimulador.tsx:19-26`). Há aviso "Modo simulação" em 11px (`:61`) |
| Agência (`/agency`) | contatos, negócios, clientes ativos por cliente | ver 06 ISSUE-A5 |

## 3. Navegação e arquitetura da informação

Menu principal (`components/shell/nav.ts:20-31`): Dashboard, Leads, Pipeline, Conversas, Automações, Campanhas, Agenda, Analytics, IA, Configurações.

- `SECONDARY_NAV` (Empresas, Tarefas, Conhecimento, Anúncios, Financeiro) está definido e nunca renderizado: `Sidebar.tsx` só usa `PRIMARY_NAV` e `AGENCY_NAV`. Essas rotas só aparecem em atalhos e na paleta de comandos.
- Rotas implementadas sem nenhum link no menu: `/inbox`, `/nyro`, `/contatos`, `/marketing`, `/onboarding`, `/empresas`, `/tarefas`, `/financeiro`, `/conhecimento`.
- Entradas do menu que levam a telas vazias em produção: Conversas, Campanhas, Agenda, IA (4 de 10). As telas funcionais equivalentes (Inbox, Nyro) estão escondidas.
- `components/app/AppSidebar.tsx`, `DynamicIsland.tsx`, `TopRight.tsx`, `TopCenterLogo.tsx`, `NyroDock.tsx`, `ComingSoon.tsx` pertencem ao shell antigo e não são importados pelo layout atual (verificado por grep). Código morto que também mostra um segundo "Inbox" e "Falar com a Nyro".
- Badge de conversas não lidas: `Sidebar` aceita `badges`, mas `app/(app)/layout.tsx:51` não o passa; o badge nunca aparece.

Teste dos 60 segundos para um dono de agência (leitura do código):

| Pergunta | Resposta no produto | Veredito |
|---|---|---|
| Onde cadastro cliente? | `Agência > Clientes > Novo cliente` (`clients/page.tsx:28`) | Encontra em ~3 cliques, se souber que o item "Agência" existe no topo do menu |
| Onde conecto o WhatsApp? | Configurações > Integrações > card WhatsApp (QR); o atalho do empty state de Conversas aponta para `?aba=whatsapp`, que não existe | Link quebrado; o caminho real exige adivinhar a aba |
| Onde vejo leads? | Leads | OK, só lista básica |
| Onde configuro o pipeline? | Pipeline é só leitura; "Configurar etapas" leva a `?aba=pipeline` inexistente; blueprint em `/onboarding` sem link | Não resolvido |
| Onde ativo automações? | Automações | OK |
| Onde acho problemas? | Não existe visão (06 ISSUE-A6) | Não resolvido |

Conclusão: um dono de agência não entende o produto em 60 segundos; ele só se orienta nas telas de Agência e Automações.

## 4. Tokens, tipografia e responsividade

- Tokens: `globals.css:20-155` define cor, raio, sombra, z-index, espaçamento e movimento em variáveis, e `tailwind.config.ts` as expõe (comentário "nenhum valor de cor literal em componente"). A regra não é cumprida: 103 hex literais em `app` e `components` (fora de marketing), por exemplo `agency/configuracoes/page.tsx:11` (`bg-[#281043]`, gradiente), `agenda/page.tsx:314` (`#6c2bff`), `layout.tsx:69` (`#11111b`).
- Tipografia: Inter via `next/font`, escala compacta B2B (11 a 34 px). 184 ocorrências de `text-[9|10|11px]` com valor literal acima da escala, em texto informativo (por exemplo selo DEMO e pills 10px). Abaixo do mínimo recomendado de 12px para texto de leitura.
- Dois sistemas visuais convivem: o novo (`card`, `btn`, `PageShell`, `KpiCard`) e o legado (`Card`/`Badge`/`Button` de `components/ui`, classes `glass`, `rounded-3xl`, `font-extrabold` em Nyro, Onboarding, Anúncios, Configurações). A direção "sem glassmorphism" do próprio `globals.css` é contradita por essas telas.
- Dark mode: tokens `[data-theme='dark']` existem (`globals.css:157`), mas as telas com hex literal não os herdam.
- Responsividade: shell tem drawer para `<lg` e grids `sm/xl` por página; `Sidebar` com campo de busca de subcontas aparece duplicado em drawer e desktop com ids distintos (ok). Tabelas usam `overflow-x-auto`. Não verificado em dispositivo.

## 5. Estados e acessibilidade

- Loading/empty/error: `components/revenue/States.tsx` (EmptyState, ErrorState com retry, SkeletonRows, ConfigRequiredState) com `role="alert"`, `aria-busy`, `sr-only`. Dashboard real e Analytics cobrem os três estados. `AgencyClientsPage` tem skeleton e vazio, mas erro de listagem silencioso (o provider guarda `erro` e a página não o exibe). `AgencySettings` usa texto "Carregando configurações…" simples.
- Foco e movimento: `:focus-visible` com anel (`globals.css:322`), `skip-link` no layout (`layout.tsx:44`), `prefers-reduced-motion` tratado (`:380,1514,1549`).
- Modais: apenas 3 `role="dialog"` no projeto e 4 menções a `Escape`. `NovoClienteModal` (`agency/clients/page.tsx:95`) tem `aria-modal` sem trap de foco, sem Esc, sem `aria-labelledby`, e fecha só por botão.
- 72 `<button>` sem `onClick`, `type="submit"` ou `disabled` (detecção por script; inclui itens com handlers por spread, então o número é limite superior). Os visíveis em produção estão na tabela da seção 2.
- Idioma `pt-BR` correto no `<html>`; `LocaleProvider` com 3 idiomas, mas só parte dos textos usa `t()` (`Sidebar.tsx` traduz rótulo de menu; telas não).

## 6. Sinais de protótipo

- Nenhum `lorem` ou `TODO` visível ao usuário. `TODO(meta-capabilities)` em `IntegrationsMarketplace.tsx:51` (comentário).
- Alvo de link falso: `<a href="https://" onClick={preventDefault}>Como ativar o modo demo</a>` (`dashboard/page.tsx:458-466`), em produção, onde o modo demo não pode ligar.
- `<a href="#">Esqueci a senha</a>` (`LoginForm.tsx:81`); `middleware.ts:12` libera `/esqueci-senha` e `/redefinir-senha`, que não existem em `app/` (404).
- Texto de desenvolvedor em UI: "Defina NEXT_PUBLIC_ORVYN_DEMO=1" (tooltip), "ligue o modo de demonstração" no vazio do Dashboard, "Configure uma chave em Configurações › IA" (aba inexistente), "a arquitetura de canais já está pronta para eles" (`conversas/page.tsx:574`), nomes de variável de ambiente exibidos ao operador em `ConfigRequiredState`.
- Seletores decorativos: período (Dashboard demo), "Últimos 30 dias", "Todos os Canais", filtros "Todos os owners/valores" no Pipeline demo.
- Features expostas sem estar prontas: Campanhas, Agenda, Conversas, IA, Perfil do lead, Anúncios com simulador (ver seção 2).

## 7. Problemas

### ISSUE-B1 — Links `?aba=` não casam com a página de Configurações (`?tab=`)
- SEVERITY: Alta
- ROOT CAUSE: `configuracoes/page.tsx:42` lê `tab` e só conhece `perfil, personalizacao, empresa, equipe, integracoes, tags, chaves, auditoria`. Nove links usam `aba=` e três valores inexistentes (`whatsapp`, `ia`, `plano`, `pipeline`).
- FILES: `apps/web/app/(app)/configuracoes/page.tsx:17,42`; `conversas/page.tsx:576`; `pipeline/page.tsx:737`; `leads/page.tsx:446`; `ia/page.tsx:442`; `agenda/page.tsx:542`; `components/shell/Topbar.tsx:232,235`; `components/shell/Sidebar.tsx:138`; `components/revenue/States.tsx:124`
- IMPACT: todo CTA "Conectar WhatsApp", "Configurar IA", "Fazer upgrade", "Conectar calendário", "Configurar etapas" abre a aba Perfil. O menu do usuário "Equipe" e "Plano" idem.
- RECOMMENDED FIX: padronizar o parâmetro (`tab`) e mapear `aba` legado; criar abas reais ou remover os CTAs.
- ACCEPTANCE CRITERIA: teste que percorre todos os `href="/configuracoes?..."` e confirma que a aba renderizada corresponde; nenhum link aponta para aba inexistente.

### ISSUE-B2 — Quatro itens do menu principal levam a telas vazias em produção, enquanto as telas funcionais ficam ocultas
- SEVERITY: Alta
- ROOT CAUSE: páginas ligadas por `{demo ? <X/> : <Vazio/>}` sem caminho real (Conversas, Campanhas, Agenda, IA, Lead/[id]), e a navegação não expõe `/inbox`, `/nyro`, `/contatos`, `/empresas`, `/tarefas`, `/financeiro`.
- FILES: `apps/web/app/(app)/conversas/page.tsx:48`; `campanhas/page.tsx:40`; `agenda/page.tsx:38`; `ia/page.tsx:72`; `leads/[id]/page.tsx:49`; `components/shell/nav.ts:20-47`; `components/shell/Sidebar.tsx`
- IMPACT: um cliente real clica em Conversas e vê "Nenhuma conversa ainda" mesmo com WhatsApp conectado e conversas no banco. O produto parece sem funcionalidade.
- RECOMMENDED FIX: apontar Conversas para a inbox real, IA para a Nyro, Agenda para `lib/agenda.ts`, Lead/[id] para o perfil de contato; esconder do menu o que não tiver backend (Campanhas) com selo "em breve" consistente; renderizar `SECONDARY_NAV` ou remover.
- ACCEPTANCE CRITERIA: com um tenant real que tem conversa, evento de agenda e contato, cada item do menu mostra esses dados; nenhum item do menu termina sempre em estado vazio.

### ISSUE-B3 — Botões primários sem ação em estados que o usuário real encontra
- SEVERITY: Média
- ROOT CAUSE: `<button className="btn btn-primary">` sem `onClick`: "Novo Lead" (`leads/page.tsx:42`, também `:444`), "Nova conversa" (`conversas/page.tsx:40`), "Nova campanha" (`campanhas/page.tsx:456`), "Nova reunião" (`agenda/page.tsx:538`), "Nova oportunidade" (`pipeline/page.tsx:733`), filtros de Analytics (`analytics/page.tsx:53,58`).
- FILES: os citados
- IMPACT: o CTA principal do estado vazio não faz nada; cadastrar o primeiro lead, que o Dashboard recomenda, não tem caminho.
- RECOMMENDED FIX: implementar ou remover; para leads, abrir formulário que chama `crm.createContact`.
- ACCEPTANCE CRITERIA: teste de UI percorre botões `btn-primary` das páginas e falha se algum não tem handler ou `href`.

### ISSUE-B4 — Métricas com nome diferente do cálculo (Negócios Abertos, Valor em Pipeline, Taxa de Conversão, "receita")
- SEVERITY: Alta (decisões financeiras sobre números rotulados erroneamente)
- ROOT CAUSE: `CrmService.overview` não distingue aberto, ganho e perdido; última etapa por `ordem` global (ver 06 ISSUE-A5). Mesma fonte alimenta Dashboard, Pipeline real, Agência e a tool `resumo_do_funil` da Nyro (`tool-executor.service.ts:95-96`).
- FILES: `apps/api/src/crm/crm.service.ts:95-127`; `apps/web/app/(app)/dashboard/page.tsx:127-135`; `apps/web/app/(app)/pipeline/page.tsx:146-151`
- IMPACT: o Dashboard mostra "Negócios Abertos" incluindo ganhos; a IA repete o número ao usuário como fato.
- RECOMMENDED FIX: marcar etapa como `ganho`/`perdido`/`aberto` no schema, recalcular, e renomear até a correção.
- ACCEPTANCE CRITERIA: teste com 3 deals em estados diferentes valida cada KPI; Nyro retorna os mesmos valores.

### ISSUE-B5 — Simulador de anúncios fabrica métricas em produção
- SEVERITY: Média
- ROOT CAUSE: `AdsSimulador` renderiza sempre em `/marketing/ads` (`marketing/ads/page.tsx:82`), com fórmulas fixas e `localStorage`.
- FILES: `apps/web/components/app/AdsSimulador.tsx:19-26,61`; `apps/web/app/(app)/marketing/ads/page.tsx:82`
- IMPACT: gasto, leads e ROAS inventados convivem na mesma página com KPIs reais da Meta; aviso pequeno. Viola "sem mock silencioso" do CLAUDE.md.
- RECOMMENDED FIX: restringir ao `modoDemo()` ou remover.
- ACCEPTANCE CRITERIA: em build de produção a página não renderiza o simulador.

### ISSUE-B6 — Rotas e links de autenticação inexistentes
- SEVERITY: Média
- ROOT CAUSE: `/esqueci-senha` e `/redefinir-senha` estão na lista pública do middleware mas não há páginas; o link "Esqueci a senha" é `href="#"`.
- FILES: `apps/web/middleware.ts:12`; `apps/web/components/app/LoginForm.tsx:81`
- IMPACT: usuário sem acesso não tem recuperação de senha pela UI. (Não verifiquei se há endpoint de reset na API.)
- RECOMMENDED FIX: implementar fluxo ou remover o link.
- ACCEPTANCE CRITERIA: link leva a uma tela funcional que dispara e-mail de reset.

### ISSUE-B7 — Taxa de sucesso das automações sempre otimista
- SEVERITY: Alta
- ROOT CAUSE: `AnalyticsService.automacoes` conta falhas como status `falha` ou `erro`, mas o executor grava `falhou` (`runs.service.ts:232`; `operations.service.ts:43`; `workflows.service.ts:54` usa `falhou`). Como consequência `falhas` é sempre 0 e `taxaSucesso` é 100% quando há concluídas. Do mesmo modo, `aiUsage.erros` conta `erro IS NOT NULL`, mas `registrarUso` nunca grava `erro` (`nyro.service.ts:363-374`).
- FILES: `apps/api/src/analytics/analytics.service.ts:46`; `apps/api/src/automations/runs.service.ts:232`; `apps/api/src/nyro/nyro.service.ts:363-374`
- IMPACT: o único indicador de saúde de automação do produto mostra verde enquanto automações falham. Pior que não mostrar.
- RECOMMENDED FIX: usar `falhou` (centralizar os enums de status) e registrar o erro de IA em `ai_usage_events.erro`.
- ACCEPTANCE CRITERIA: teste cria runs `falhou` e confirma `falhas > 0` e `taxaSucesso < 100`.

### ISSUE-B8 — Código morto e sistemas visuais duplicados
- SEVERITY: Baixa
- ROOT CAUSE: `lib/revenue/source.ts` (`useFonte`), `SECONDARY_NAV`, `AppSidebar`, `DynamicIsland`, `TopRight`, `TopCenterLogo`, `NyroDock`, `ComingSoon` e o dataset demo importado direto.
- FILES: `apps/web/lib/revenue/source.ts`; `apps/web/components/app/*` listados; `apps/web/lib/demo/dataset.ts`
- IMPACT: manutenção, bundle e risco de regressão visual; documentação promete uma fronteira demo que não existe.
- RECOMMENDED FIX: remover o que não é importado; importar o dataset por import dinâmico só quando `modoDemo()`.
- ACCEPTANCE CRITERIA: `next build` de produção não inclui `dataset.ts`; lint de imports não usados passa.

### ISSUE-B9 — Acessibilidade de modais e tamanhos mínimos
- SEVERITY: Média
- ROOT CAUSE: modais próprios sem trap de foco, Esc ou rótulo; texto de 9 a 11 px em 184 pontos.
- FILES: `apps/web/app/(app)/agency/clients/page.tsx:95`; `apps/web/components/shell/Topbar.tsx` (menus); ocorrências de `text-[10px]`/`text-[11px]` em `app` e `components`
- IMPACT: uso por teclado e leitor de tela comprometido no fluxo principal de criação de cliente.
- RECOMMENDED FIX: componente único de diálogo (focus trap, Esc, `aria-labelledby`); mínimo 12px para texto informativo.
- ACCEPTANCE CRITERIA: teste de teclado abre, navega e fecha o diálogo; auditoria axe sem violações críticas nas telas principais.

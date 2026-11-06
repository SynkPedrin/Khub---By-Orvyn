# 15 — Evidência de Navegador (baseline visual e funcional)

> Sprint 0. Chrome headless (Playwright) contra o front de QA (`next start`, porta 3220) + API de QA (porta 4010) + Postgres/Redis de QA. Roteiro: `apps/api/scripts/qa/browser.mjs`. Dados brutos: `evidence/browser-report.json`. Screenshots: `evidence/screenshots/{1440,768,390}/`.
> **Não é redesign.** É o estado real de hoje.

## 1. Resultado
| Item | Resultado |
|---|---|
| Checks de navegador | **10/10 PASS** (rodada final) |
| Páginas visitadas | 55 (1440: 35 · 768 e 390: 20) |
| Status HTTP != 200 | 0 |
| Erros de console / `pageerror` | 0 |
| Requests com falha (4xx/5xx, exceto assets estáticos) | 0 |
| Overflow horizontal acidental (1440/1280/1024/768/390) | 0 |
| Maior tempo de carregamento (`networkidle`) | 1364 ms |
| Troca de cliente A1→A2 pelo switcher | 31 ms até o tenant novo estar ativo (isolado: ~560 ms, 4/4) |
| Jornada do usuário novo (cadastro → criar contato) | 44 s |

"Renderizou" não é "funcionou": as seções 3 a 6 testam ação, não só pintura.

## 2. Páginas em 1440 px (contexto: cliente A1, dados reais de QA)
| Rota | H1 | HTTP | Erros console | Req. falhos | ms | Sinais de texto | Screenshot |
|---|---|---|---|---|---|---|---|
| `/agency` | Agência Agencia A mv8dfbyd | 200 | 0 | 0 | 1142 | — | `screenshots/1440/agency.png` |
| `/agency/clients` | Clientes | 200 | 0 | 0 | 1107 | — | `screenshots/1440/agency_clients.png` |
| `/agency/equipe` | Equipe | 200 | 0 | 0 | 1146 | Nenhum | `screenshots/1440/agency_equipe.png` |
| `/agency/configuracoes` | Configurações da agência | 200 | 0 | 0 | 1222 | — | `screenshots/1440/agency_configuracoes.png` |
| `/dashboard` | Boa tarde, Responsável. | 200 | 0 | 0 | 1185 | — | `screenshots/1440/dashboard.png` |
| `/leads` | Leads | 200 | 0 | 0 | 1171 | — | `screenshots/1440/leads.png` |
| `/pipeline` | Pipeline de Vendas | 200 | 0 | 0 | 1155 | Nenhum | `screenshots/1440/pipeline.png` |
| `/conversas` | Conversas | 200 | 0 | 0 | 1128 | Nenhum | `screenshots/1440/conversas.png` |
| `/inbox` | Inbox | 200 | 0 | 0 | 1155 | — | `screenshots/1440/inbox.png` |
| `/contatos` | Contatos | 200 | 0 | 0 | 1364 | — | `screenshots/1440/contatos.png` |
| `/automacoes` | Automações | 200 | 0 | 0 | 1146 | — | `screenshots/1440/automacoes.png` |
| `/campanhas` | Campanhas | 200 | 0 | 0 | 1123 | Nenhum | `screenshots/1440/campanhas.png` |
| `/agenda` | Agenda | 200 | 0 | 0 | 1144 | demo | `screenshots/1440/agenda.png` |
| `/analytics` | Analytics e Relatórios | 200 | 0 | 0 | 1172 | — | `screenshots/1440/analytics.png` |
| `/ia` | — | 200 | 0 | 0 | 1166 | IA não configurada | `screenshots/1440/ia.png` |
| `/nyro` | — | 200 | 0 | 0 | 1173 | — | `screenshots/1440/nyro.png` |
| `/configuracoes` | Configurações | 200 | 0 | 0 | 1179 | — | `screenshots/1440/configuracoes.png` |
| `/marketing` | Biblioteca | 200 | 0 | 0 | 1266 | Nenhum | `screenshots/1440/marketing.png` |
| `/marketing/ads` | Anúncios · cross-plataforma | 200 | 0 | 0 | 1148 | Nenhum | `screenshots/1440/marketing_ads.png` |
| `/empresas` | Empresas | 200 | 0 | 0 | 1359 | Nenhum | `screenshots/1440/empresas.png` |
| `/tarefas` | Tarefas | 200 | 0 | 0 | 1140 | — | `screenshots/1440/tarefas.png` |
| `/financeiro` | Financeiro | 200 | 0 | 0 | 1163 | Nenhum | `screenshots/1440/financeiro.png` |
| `/conhecimento` | Base de conhecimento | 200 | 0 | 0 | 1196 | — | `screenshots/1440/conhecimento.png` |
| `/onboarding` | Vamos montar seu Orvyn | 200 | 0 | 0 | 1149 | — | `screenshots/1440/onboarding.png` |
| `/leads/d8977ff8-43b6-4c17-abf5-1addfa04928d` | — | 200 | 0 | 0 | 1135 | não encontrado | `screenshots/1440/leads_d8977ff8_43b6_4c17_abf5_1addfa04928d.png` |
| `/contatos/d8977ff8-43b6-4c17-abf5-1addfa04928d` | Lead inbound mv8dfbyd | 200 | 0 | 0 | 1183 | Nenhum | `screenshots/1440/contatos_d8977ff8_43b6_4c17_abf5_1addfa04928d.png` |
| `/leads` | Leads | 200 | 0 | 0 | 1170 | Nenhum | `screenshots/1440/leads.png` |

Sinais de texto = palavras que denunciam estado vazio, demo ou ausência (`demo`, `não encontrado`, `IA não configurada`, `Nenhum`). `Sem ` foi omitido por ser ruído.

## 3. Botões: clicar e ver se algo acontece
Clique real; "RESPONDE" = mudou URL, abriu diálogo, alterou o DOM ou disparou request.
| Rota | Botão | Resultado | Detalhe |
|---|---|---|---|
| `/leads` | Novo Lead | SEM_EFEITO | url:= dialogs:0→0 reqs:0 |
| `/pipeline` | Nova oportunidade | NAO_ENCONTRADO |  |
| `/campanhas` | Nova campanha | SEM_EFEITO | url:= dialogs:0→0 reqs:0 |
| `/agenda` | Nova reunião | SEM_EFEITO | url:= dialogs:0→0 reqs:0 |
| `/agenda` | Novo | NAO_ENCONTRADO |  |
| `/automacoes` | Nova automação | RESPONDE | url:= dialogs:0→0 reqs:0 |
| `/contatos` | Novo | RESPONDE | url:= dialogs:0→0 reqs:0 |
| `/configuracoes` | Conectar WhatsApp | NAO_ENCONTRADO |  |
| `/dashboard` | Novo | NAO_ENCONTRADO |  |
| `/conversas` | Nova | SEM_EFEITO | url:= dialogs:0→0 reqs:0 |

- **SEM_EFEITO (confirmado em navegador):** "Novo Lead" em `/leads`, "Nova campanha", "Nova reunião", "Nova" em `/conversas`. São os CTAs principais de quatro módulos.
- **NAO_ENCONTRADO:** o rótulo não existe naquela tela com dados (ex.: "Nova oportunidade" só aparece no estado vazio do pipeline). Não é falha por si só, mas o Kanban com dados **não tem como criar oportunidade pela UI**.
- Dos 10 botões testados, **4 não fazem nada** e 2 funcionam. O número de 72 botões sem `onClick` da auditoria estática não foi reverificado botão a botão.

## 4. Fluxos exercitados na UI
| Fluxo | Resultado | Evidência |
|---|---|---|
| Login pela UI | PASS | aterrissa em `/agency` para dono de agência |
| Entrar no cliente pela UI ("Entrar na operação") | PASS | `/auth/me` mostra o tenant do cliente |
| Kanban: arrastar o card para outra etapa | PASS | persiste e continua lá após reload (confirmado por `GET /crm/pipeline`) |
| Inbox: conversa vinda do webhook de teste | PASS | `screenshots/1440/inbox_tempo_real.png` |
| Inbox: mensagem nova **sem recarregar** | PASS | aparece em até 14 s (mecanismo socket × polling **não determinado**) |
| Trocar A1→A2 pelo switcher, sem logout | PASS | leads de A1 não aparecem em A2 |
| Usuário novo: cadastro e criar contato pela UI | PASS | 44 s |

### Jornada do usuário novo (cenário 8)
| Passo | Resultado |
|---|---|
| abrir /signup | text:Seu nome; email:voce@empresa.com; text:Sua empresa; password:Mínimo 8 caracteres; password:Repita a senha; checkbox: |
| cadastro concluído | /dashboard |
| botão de criar lead na UI | sim |
| criar contato pela UI em /contatos | sim |

Impedimentos de UX nessa jornada: o cadastro exige confirmar senha e aceitar os termos (esperado); depois do cadastro o usuário cai em `/dashboard` com estado vazio e o texto "Como ativar o modo demo" (ver 7); **não há assistente guiado** apontando conectar WhatsApp, criar funil ou ativar automação (a rota `/onboarding` existe mas não é oferecida no fluxo).

## 5. Responsivo
### 768 px (tablet)
| Rota | HTTP | Overflow-x | Erros | ms | Screenshot |
|---|---|---|---|---|---|
| `/agency` | 200 | não | 0 | 1113 | `screenshots/768/agency.png` |
| `/agency/clients` | 200 | não | 0 | 1107 | `screenshots/768/agency_clients.png` |
| `/dashboard` | 200 | não | 0 | 1113 | `screenshots/768/dashboard.png` |
| `/leads` | 200 | não | 0 | 1112 | `screenshots/768/leads.png` |
| `/pipeline` | 200 | não | 0 | 1099 | `screenshots/768/pipeline.png` |
| `/inbox` | 200 | não | 0 | 1111 | `screenshots/768/inbox.png` |
| `/automacoes` | 200 | não | 0 | 1131 | `screenshots/768/automacoes.png` |
| `/configuracoes` | 200 | não | 0 | 1147 | `screenshots/768/configuracoes.png` |

### 390 px (mobile)
| Rota | HTTP | Overflow-x | Erros | ms | Screenshot |
|---|---|---|---|---|---|
| `/agency` | 200 | não | 0 | 1114 | `screenshots/390/agency.png` |
| `/agency/clients` | 200 | não | 0 | 1118 | `screenshots/390/agency_clients.png` |
| `/dashboard` | 200 | não | 0 | 1132 | `screenshots/390/dashboard.png` |
| `/leads` | 200 | não | 0 | 1102 | `screenshots/390/leads.png` |
| `/pipeline` | 200 | não | 0 | 1116 | `screenshots/390/pipeline.png` |
| `/inbox` | 200 | não | 0 | 1097 | `screenshots/390/inbox.png` |
| `/automacoes` | 200 | não | 0 | 1123 | `screenshots/390/automacoes.png` |
| `/configuracoes` | 200 | não | 0 | 1112 | `screenshots/390/configuracoes.png` |

1280 px e 1024 px foram verificados em `/dashboard` e `/pipeline` (0 overflow). O Kanban tem rolagem horizontal **intencional** (no 1440 a 5ª coluna fica fora da tela).

## 6. Usuário novo (contexto vazio), 1440 px
| Rota | H1 | HTTP | Erros console | Req. falhos | ms | Sinais | Screenshot |
|---|---|---|---|---|---|---|---|
| `/dashboard` | Boa tarde, Usuário. | 200 | 0 | 0 | 1118 | demo | `screenshots/1440/novo_dashboard.png` |
| `/leads` | Leads | 200 | 0 | 0 | 1105 | Nenhum | `screenshots/1440/novo_leads.png` |
| `/pipeline` | Pipeline de Vendas | 200 | 0 | 0 | 1119 | — | `screenshots/1440/novo_pipeline.png` |
| `/conversas` | Conversas | 200 | 0 | 0 | 1113 | Nenhum | `screenshots/1440/novo_conversas.png` |
| `/inbox` | Inbox | 200 | 0 | 0 | 1115 | — | `screenshots/1440/novo_inbox.png` |
| `/automacoes` | Automações | 200 | 0 | 0 | 1133 | Nenhum | `screenshots/1440/novo_automacoes.png` |
| `/configuracoes` | Configurações | 200 | 0 | 0 | 1133 | — | `screenshots/1440/novo_configuracoes.png` |
| `/onboarding` | Vamos montar seu Orvyn | 200 | 0 | 0 | 1159 | — | `screenshots/1440/novo_onboarding.png` |

## 7. Problemas visuais e de produto observados (por inspeção das telas)
**O que está bom:** identidade ametista/off-white consistente em toda a aplicação, hierarquia tipográfica clara, espaçamento regular, estados vazios com orientação e CTA, mobile com menu hambúrguer e sem quebra de layout, cadastro/login bem acabados.

**O que faz parecer protótipo (todos observados em screenshot):**
| # | Observação | Onde | Sev. | Classe |
|---|---|---|---|---|
| V1 | CTAs principais sem ação ("Novo Lead", "Nova campanha", "Nova reunião") | `/leads`, `/campanhas`, `/agenda` | P1 | UX_DEFECT / PRODUCT_GAP |
| V2 | Texto de desenvolvimento exposto ao cliente: "Como ativar o modo demo" | dashboard vazio (390 e 1440) | P2 | UX_DEFECT |
| V3 | Card "Plano Pro · Seu crescimento sem limites · Fazer upgrade" fixo em toda tela, mesmo no plano `starter` | sidebar | P2 | CODE_DEFECT (hardcoded) |
| V4 | Dono saudado como "Responsável" ao entrar no cliente (o nome real se perde no provisionamento) | topbar e dashboard | P3 | CODE_DEFECT |
| V5 | Header do Inbox: "WhatsApp (STEVO) · Instagram · E-mail" promete canais que não existem | `/inbox` | P2 | UX_DEFECT |
| V6 | Inbox a 390 px não colapsa para painel único: lista + faixa cinza do chat | `/inbox` mobile | P2 | UX_DEFECT |
| V7 | Card do Kanban só mostra título, contato e valor: sem tempo parado, última interação, próxima ação, responsável; sem filtros nem busca | `/pipeline` | P1 | PRODUCT_GAP |
| V8 | Menu: "Conversas", "Campanhas", "Agenda" e "IA" abrem telas vazias/limitadas enquanto o Inbox real (`/inbox`) e o chat Nyro (`/nyro`) ficam fora do menu | sidebar | P1 | UX_DEFECT |
| V9 | `/ia`: "IA não configurada" (honesto, é bloqueio externo), mas o chat real está em `/nyro` | `/ia` | P2 | UX_DEFECT |
| V10 | Dashboard: "Taxa de Conversão 0%" com legenda técnica ("última etapa do funil / total de negócios") e "Negócios Abertos" contando todos os negócios | dashboard | P2 | CODE_DEFECT |
| V11 | KPIs do Kanban empilhados no mobile empurram o quadro para fora da primeira tela | `/pipeline` 390 | P3 | UX_DEFECT |

Nenhuma comparação BEFORE/AFTER foi feita porque **nenhuma alteração visual foi realizada nesta sprint** (escopo: baseline).

## 8. Limites desta evidência
- Chrome headless em macOS; sem Safari/Firefox.
- Dados sintéticos de QA (1 oportunidade, 4 contatos): não mostram densidade, paginação nem desempenho com volume real.
- Acessibilidade (foco, teclado, leitor de tela) **não** foi testada.
- A cobertura de "botões sem ação" é por amostra de 10 CTAs.

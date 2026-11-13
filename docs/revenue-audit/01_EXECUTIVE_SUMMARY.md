# 01 — Resumo Executivo

> Auditoria do KHUB Revenue OS. Data: 2026-10-14. Método: leitura estática do código por 5 auditorias paralelas + gates de baseline rodados de fato.
> **Atualização (Sprint 0):** o runtime foi validado depois desta auditoria. Notas, achados e correções novos estão em `13` a `17`; o scorecard atualizado está no fim de `17`. O texto abaixo é o retrato da auditoria estática original.
> **Limite da evidência original:** Postgres e Redis do KHUB não estavam no ar. Nenhum fluxo foi validado em runtime nem no navegador. Todo achado abaixo é "lido no código", não "observado rodando", salvo os gates de baseline. Nenhum domínio recebe `PRODUCTION_VERIFIED`.

## Status final

**`NOT_AGENCY_READY`**

Justificativa: dos 19 itens da definição de AGENCY_READY (prompt, seção 19), nenhum está verificado de ponta a ponta, e há defeitos de código que impedem diretamente o cenário "agência com 10 clientes" (importação Meta para o tenant errado, token Meta sem renovação, acesso de agência nunca revogado, Inbox sem tempo real provável, CTAs sem ação).

O código é um produto real, não um protótipo: auth com refresh rotativo, RLS no Postgres, motor de automações persistido com DLQ, RAG, Nyro com tools tipadas e aprovação humana. O problema não é falta de base; é a distância entre "existe" e "uma agência opera sozinha".

## Baseline medido (evidência real)

| Gate | Resultado | Evidência |
|---|---|---|
| Typecheck API | PASS | `evidence/typecheck-api.txt` |
| Testes API (jest) | PASS 293/293, 34 suítes (todos com mocks) | `evidence/jest-api.txt` |
| Typecheck web | FAIL → PASS após correção (1 erro) | `evidence/typecheck-web.txt` |
| Lint web | 1 erro → 0 erros após correção (3 warnings restantes) | executado |
| Build web / API | NÃO EXECUTADO | — |
| Testes do web | NÃO EXISTEM | — |
| E2E / isolamento RLS / smoke no navegador | BLOCKED (sem Postgres/Redis) | — |

## Correções executadas nesta rodada

| # | Defeito | Arquivo | Estado |
|---|---|---|---|
| 1 | Aba Tags quebrava com `ReferenceError: scopes` (botão lia variável de outro componente) | `apps/web/app/(app)/configuracoes/page.tsx` | Corrigido, tsc OK |
| 2 | Erro de lint `rules-of-hooks` (alias `useLabel` de `t`) | idem | Corrigido, lint 0 erros |
| 3 | Webhook público "Webhook recebido" sempre respondia 400 (proxy não repassava `Idempotency-Key`) | `apps/web/app/api/hooks/[chave]/route.ts` | Corrigido, tsc OK. **Sem teste de regressão nem validação em runtime.** |

## Respostas obrigatórias (seção 29)

**A. Estado real.** Base técnica sólida e testada em unidade. Funciona por leitura: CRM core, motor de automações (delay persistido), RLS, Nyro (lógica). Não provado em runtime.

**B. Integrações.** 14 encontradas. 0 verificadas de ponta a ponta. 8 parciais. 6 só UI/stub. 5 não implementadas. 5 com defeito de código. Detalhe em `03`.

**C. Automações.** 7 gatilhos reais (contato criado, tag adicionada, negócio criado, etapa mudou, status do negócio, mensagem recebida, webhook). 14 ações; só SMS idempotente. Faltam agendamento, formulário, lead de campanha, inatividade. Detalhe em `04`.

**D. Kanban.** Não está pronto para operação comercial: não há rotas REST para criar/editar/excluir funil e etapa; a UI real não cria oportunidade nem marca ganho/perda; card sem tempo parado/próxima ação; ordem na coluna não persiste. O drag-and-drop persiste e reverte em erro. Detalhe em `05`.

**E. Agency Mode.** Troca de cliente sem logout funciona para owner/admin. Não opera 10 clientes com confiança: sem visão de saúde, sem alertas, sem revogação de acesso, sem criação de agência fora de seed, member/viewer bloqueados. Média 1,8/5. Detalhe em `06`.

**F. UX.** 4 de 10 itens do menu mostram só estado vazio; 72 botões sem `onClick`; links `?aba=` quebrados; recuperar senha inexistente. Detalhe em `07`.

**G. Maturidade visual.** Dois sistemas visuais convivem (103 hex literais, 184 usos de texto 9-11px), `AdsSimulador` fabrica métricas, CTAs mortos. Isso, mais que o estilo, é o que lê como protótipo. Não foi feita inspeção visual por screenshot, portanto nenhum juízo estético é afirmado.

**H. Segurança.** Há bloqueios para comercialização: SEC-01 (P0) acesso de agência nunca revogado; webhooks com segredo global; sem RLS nas tabelas de agência; SSRF contornável; sem reset de senha. Detalhe em `09`.

**I. Prontidão comercial.** Não vender para agências agora. Possível piloto controlado, acompanhado, com 1 a 2 clientes e sem Meta Ads.

**J. Roadmap.** Em `11`.

**K. Correções executadas.** As 3 acima.

**L. Status.** `NOT_AGENCY_READY` (não `CODE_READY_WITH_EXTERNAL_BLOCKERS`, porque os impedimentos principais são defeitos de código, não só credenciais).

## Checklist AGENCY_READY (seção 19)

| Item | Estado |
|---|---|
| Criar organização cliente | Código existe; não verificado em runtime |
| Entrar na subconta | owner/admin sim por leitura; member/viewer NÃO |
| Conectar canal operacional real | NÃO verificado (Evolution perde mensagens em `connecting`; Meta sem renovação) |
| Receber leads reais | NÃO verificado |
| Leads no dashboard | Parcial (Contatos/Funil/Tarefas REAL_DATABASE) |
| Criar e movimentar oportunidades | Mover sim; criar pela UI NÃO |
| Kanban persistente | Parcial (ordem na coluna não persiste) |
| Configurar e executar automação | Código sim; não verificado |
| Histórico de execução | Sim por leitura |
| Receber mensagem real e ver conversa | NÃO verificado; tempo real provavelmente quebrado (I-1) |
| Executar e cancelar follow-up | Cancelamento só por resposta, parcial |
| Trocar entre clientes | owner/admin |
| Isolamento de dados | RLS forte nas tabelas de negócio; tabelas de agência sem RLS e sem teste A×B |
| Diagnosticar falhas | NÃO (sem health por cliente) |
| Operar sem dev | NÃO |
| Sem dados fictícios como reais | NÃO (`AdsSimulador`, "Plano Pro" fixo) |
| Métricas consistentes | NÃO (analytics de automação conta status errado; "Negócios abertos" conta todos) |

## Scorecard de maturidade (0 a 5)

| Dimensão | Nota | Evidência | Bloqueio | Próxima ação |
|---|---|---|---|---|
| Arquitetura | 3,5 | Monólito modular, RLS, outbox, BullMQ; 293 testes | Reconciler global 5s, sem registro de migrations | ARQ-06/10 |
| Integrações | 1,5 | 0 verificadas; Meta/Evolution com defeitos | Token Meta, multi-cliente | Sprint 2 |
| Automações | 3 | Delay persistido, DLQ, versão imutável | Faltam gatilhos, idempotência, cancelamento de follow-up | Sprint 3 |
| Kanban | 2 | DnD persiste | Sem CRUD de funil, sem criar oportunidade na UI | Sprint 5 |
| Leads | 2 | Criação manual, perfil 360 | Sem CSV, sem dedupe manual, origem perdida | Sprint 6 |
| Conversas | 2 | Inbound/outbound com dedupe | Sem realtime provável, sem não-lidas/busca | Sprint 6 |
| Agency Mode | 1,8 | Média das 10 notas em `06` | Revogação, saúde, billing | Sprint 1 |
| IA | 2,5 | Tools tipadas, HITL, RBAC por rota | Sem validação real (chave), aprovação não atômica | Sprint após chave |
| Dashboard | 2 | 3 métricas reais | Métricas imprecisas, hardcoded | Sprint 7 |
| Analytics | 1,5 | Custo de IA real | Taxa de sucesso errada | B7 |
| Segurança | 2,5 | RLS FORCE, AES-GCM, HMAC Meta | SEC-01..06 | Sprint 10 (parte P0 antes) |
| Performance | 2 | Índices existem | Listagens sem limite, N+1 | ARQ-04 |
| UX | 1,5 | Telas reais fora do menu | 72 botões mortos, menu enganoso | Sprint 9 |
| Visual | 2 | Identidade existe | 2 sistemas visuais; sem screenshot | Sprint 8 |
| Onboarding | 1,5 | Nyro configura funil/templates | Sem fluxo guiado | Sprint 1 |
| Prontidão comercial | 1,5 | Base boa | Tudo acima | Roadmap |

Notas são julgamento sobre leitura estática e devem ser reavaliadas após validação em runtime.

## Pergunta final

> Se eu fosse dono de uma agência com 10 clientes e pagasse mensalmente, eu operaria com confiança no estado atual?

**NÃO.** Evidências: (1) conectar o Meta num cliente importa as contas dos 10 e a primeira conexão captura as páginas de todos; (2) o token Meta expira em cerca de 1h sem renovação e a UI continua "Conectado"; (3) não há como ver qual cliente está com integração caída; (4) acesso revogado de ex-membro da agência continua válido; (5) boa parte dos botões principais não faz nada.

### Cinco melhorias que mais aumentam a capacidade de vender em 30 dias

1. **Integração Meta confiável por cliente:** token de longa duração + renovação, tela de seleção de conta/página por tenant, correção de `UNIQUE(page_id)`. Sem isso o argumento "agência de tráfego" não existe.
2. **Painel de saúde da agência:** por cliente, integração conectada, última mensagem, automações com erro, oportunidades sem atendimento; mais revogação de acesso (SEC-01) e troca para member/viewer.
3. **Operação diária sem dev:** ligar o que já existe (Inbox em `/inbox`, `/nyro`, agenda) ao menu, remover os 72 botões mortos e as telas vazias, criar oportunidade e funil pela UI, recuperar senha.
4. **Inbox em tempo real e Evolution sem perda:** ponte worker→socket (redis-emitter), promover instância a `connected` por `connection.update`, não-lidas, busca.
5. **Confiabilidade do motor de automação:** corrigir ramo de condição, tag com contexto velho, cancelar follow-up em mudança de estágio/reunião, idempotência das ações, métricas corretas.

Ordem sugerida: 1 e 2 primeiro (bloqueiam a venda), 3 em paralelo, 4 e 5 em seguida.

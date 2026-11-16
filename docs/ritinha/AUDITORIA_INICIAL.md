# AUDITORIA INICIAL — Operação Ritinha (Studio da Beleza Rita)

> Fase Zero da Operação RITINHA. Modo somente leitura. Data: **2026-11-16** (America/Sao_Paulo).
> Evidências coletadas de: repositório local (`KHUB-OS`, branch `hardening/fase-0` → `feat/ritinha-avec-go-live`), API de produção (`https://khub-os.vercel.app/api` → `khub-api-ucey.onrender.com`), banco Neon de produção (consultas SQL read-only), API do Render.
> Nenhum dado foi alterado. Nenhum segredo foi impresso ou copiado.

## 0. Resumo executivo

A Ritinha **existe, está ativa, publicada (v2) e responde de verdade em produção** (latência 2,4–7,1 s nas execuções de 16/11), mas **está fora da linha de frente**: nenhuma conversa nova de cliente chega até ela. Ela não é agente padrão e o único fluxo com o nó "Ativar IA" está em rascunho. O atendimento real continua 100% humano — o que explica diretamente os 3 problemas relatados pela Rita (demora, dependência das secretárias, cliente indo ao salão para marcar).

A integração com o Avec **não é uma integração viva**: é um pipeline de extração (scraping autenticado) + importação em lote, executado pela última vez em 14/11. Não existe consulta de disponibilidade, criação, remarcação ou cancelamento via integração — e não há evidência de que o Avec ofereça API pública para isso. Os 20.890 compromissos importados estão **sem profissional, sem serviço e sem valor** (correção `corrigir-agenda.mjs` validada no QA mas **bloqueada aguardando autorização**).

Há **trabalho paralelo em andamento hoje** (sessão ChatGPT via MCP): um rascunho de nova versão da Ritinha (6.880 chars) aguarda aprovação humana (`fd6230fb-…`), um envio de mensagem de teste aguarda aprovação (`e93023b1-…`), e um deploy foi ao ar hoje 13:22 UTC (`3ca7fde`, "correções da auditoria de produção"). **Nada aqui foi duplicado ou sobrescrito.**

---

## 1. Identificadores verificados

| Item | Master prompt | Verificado | Fonte |
|---|---|---|---|
| Agente Ritinha | `29c232e5-…-911e9ce37e26` | ✅ existe, `ativo`, `padrao=false` | GET /v1/agents |
| Tenant Studio | — | `1cc7e839-f72c-414b-9d3f-a8b4131008c8` | scripts/operar + Neon |
| Serviço Render | `srv-dbqvdr67bikc73c0air0` | ✅ `khub-api`, plano **free**, 1 instância, Virginia | API Render |
| Deploy live | — | `dep-dbtg6vek1f9s73cgkd5g` · commit `3ca7fde` · **2026-11-16 13:22 UTC** | API Render |
| Repo deploy | `SynkPedrin/Khub---By-Orvyn` (main) | ✅ main = `3ca7fde` (histórico curado, ≠ repo local `SynkPedrin/orvyn-os`) | ls-remote |
| Aprovação publicar agente | `fd6230fb-…` | ✅ **pendente**, expira 17/11 13:09 UTC | Neon `nyro_actions` |
| Aprovação envio teste | `e93023b1-…` | ✅ **pendente**, expira 17/11 13:09 UTC | Neon `nyro_actions` |
| Número autorizado | `5518991652039` | ✅ conversa de teste existe ("Pedro (teste E2E)", `f3cb3b3f-…`), hoje em atendimento **humano** | Neon |

⚠️ **Domínio `api.kromads.com.br` não resolve DNS** — o CNAME nunca foi criado. A API responde apenas por `khub-api-ucey.onrender.com` (e pelo proxy `khub-os.vercel.app`). O webhook da Stevo aponta para a URL do Render. DEPLOY.md §DNS continua pendente desde 12/11.

---

## 2. Componentes existentes e funcionais (verificado em produção)

| Componente | Evidência | Arquivo/local |
|---|---|---|
| API + worker em produção | `GET /v1/ready` → `{status:ready, database:true, redis:true}` em 0,24 s | Render `khub-api` |
| Migrações 000–072 aplicadas | ledger `schema_migrations` completo, sem lacunas (070b, 071, 072 inclusas) | Neon |
| WhatsApp (Stevo API) conectado | integration `stevo_api` connected/ok, lastSync 16/11 01:58 UTC; mensagens de clientes reais entrando hoje | API + Neon |
| Meta (Ads) conectada | `meta` connected/ok | API /v1/integrations |
| Fluxo "Novo Lead 🚀" (v1) ativo e disparando | 22 runs concluídos; último **hoje 10:43 UTC** (boas-vindas reais a "Vera", "Fabiane", "Garcia") | Neon `workflow_runs`/`messages` |
| Motor de automações | espera/resposta/timeout funcionando (runs concluem; cancelamento por resposta gravado com motivo) | `automations/` |
| Ritinha v2 publicada respondendo | runs 16/11: `respondido` (2,4–2,5 s), `transferido` com `adicionar_tag` + `transferir_para_humano` (7,1 s) | Neon `agent_runs` |
| Entrega fragmentada | 8 deliveries `enviado` em 30d, última 16/11 01:02 | Neon `agent_delivery_queue` |
| Handoff com distribuição | conversa de teste transferida e atribuída a um membro (`assignee_id`) | `atendimento.service.ts:138` |
| Guarda anti-invenção de disponibilidade | `semDisponibilidadeInventada` no validador pós-resposta (BUG-045, 15 testes) | `agents/engines/response-validator.ts` |
| Outbox idempotente (BUG-041) | `INSERT … ON CONFLICT DO NOTHING` em 6 pontos de entrada; 28.914 eventos processados, 0 pendentes | `common/outbox.ts` + Neon |
| Constraint do prompt | `agents_instrucoes_chk` ≤ 8.000 chars presente no Neon | `db/030_agents.sql:53` |

---

## 3. Implementado, mas NÃO conectado (o cerne do problema operacional)

| # | Achado | Evidência | Prioridade |
|---|---|---|---|
| 3.1 | **Ritinha fora da linha de frente.** `padrao=false`; `estadoInicial()` só entrega conversa nova à IA se houver agente **padrão** ativo no canal. Único fluxo com `acao.ativar_ia` (v14) está em rascunho. | `atendimento.service.ts:44-54`; workflows em produção; apenas **4 conversas** em atendimento `ia` — todas de teste (Beatriz/Fernanda/Mariana/Juliana, 11/11). **Zero clientes reais atendidos pela IA.** | 🔴 P0 |
| 3.2 | **Tag "serviço escolhido" não notifica ninguém.** A v2 publicada manda a Ritinha aplicar a tag + transferir; o fluxo que escuta essa tag ("Notificação Interna 🔔 (importado do GHL)") está em **rascunho**. `conversa.transferida` só grava audit log — **nenhuma notificação WhatsApp à equipe no handoff** (grep em `src/`: só `atendimento.service.ts:142`). | snapshot v2 + workflows + código | 🔴 P0 |
| 3.3 | **Agenda sem dados estruturados.** 20.890 compromissos: **0** com `profissional_id`, **0** com `servico_id`, **0** com `valor_centavos`, 20.886 no formato antigo "Serviço · Cliente · Profissional". Catálogo db/071 **vazio** (0 serviços, 0 profissionais). Correção (`corrigir-agenda.mjs`) validada no QA, simulada no Neon, **aguardando autorização para gravar**. | Neon (contagens exatas); `Tasks.md` AGENDA-CLEAN-DADOS | 🔴 P0 |
| 3.4 | **Campos personalizados: zero definições.** `custom_field_defs` vazia no tenant. Os campos pedidos no master (`servico_interesse`, `avec_appointment_id`, `status_agendamento` etc.) não existem. | API `/v1/crm/custom-fields` → `[]`; Neon | 🟠 P1 |
| 3.5 | Ferramentas de agenda existem no catálogo (`ver_agendamentos`, `solicitar_agendamento`, `remarcar_agendamento`, `verificar_pagamento_sinal`) mas **removidas da Ritinha v2** de propósito (BUG-039: agenda sem profissional bloqueava todos os slots). | `agents/catalogo.ts:225-290`; notas da v2 | 🟠 P1 (depende de 3.3) |
| 3.6 | MCP connector (db/072) implantado e em uso (sessão ChatGPT hoje), mas aprovações sensíveis **aguardam humano** — sem prazo de expiração tratado na operação (expiram 17/11 13:09 UTC). | Neon `nyro_actions` | 🟠 P1 |

---

## 4. Parcialmente implementado

| # | Achado | Detalhe | Prioridade |
|---|---|---|---|
| 4.1 | **Integração Avec = pipeline de importação, não integração viva.** Scripts Playwright (login headless) baixam relatórios e importam pelas rotas oficiais. Somente leitura, sob demanda, sem job agendado, sem webhook, sem capacidade de escrita (criar/reagendar/cancelar). Última extração: 14/11. **Não há como consultar disponibilidade real do Avec hoje.** | `scripts/operar/avec/LEIAME.md` e scripts | 🔴 P0 (para o requisito "Avec como fonte oficial") |
| 4.2 | **Rascunho vivo da Ritinha (6.880 chars) diverge da v2 publicada (4.833 chars).** O rascunho (sessão ChatGPT) melhora estrutura, remove a chave PIX ("não validada"), adiciona regras do master. Runtime usa a **v2**, que **contém a chave PIX** e instruções de tag+transferência. | GET /agents/:id vs /versoes/:vid | 🟠 P1 — decidir: aprovar, revisar ou descartar |
| 4.3 | **Follow-up**: existe motor (`AgentFollowupRule`, estratégias), mas **0 follow-ups enviados em 30d** (dashboard). Fluxo v1 tem 1 follow-up de 24h; v14 (3 follow-ups contextuais) em rascunho. | dashboard agents; grafos | 🟠 P1 |
| 4.4 | **SLA 2 min**: latência da IA é 2,4–7 s (16/11), mas só 4 conversas IA existem. Sem monitoramento/alerta de SLA. p95 de 7d = 118 s (resíduo da era Ollama local, 11/11). | Neon `agent_runs` | 🟠 P1 |
| 4.5 | **Evolution**: `status=connecting`, `health=unknown` — igual à auditoria anterior; canal não operacional (Stevo é o canal ativo). | /v1/integrations | 🟡 P2 |
| 4.6 | **Lembretes de agenda**: varredura existe (29 enviados), mas **3.057 compromissos futuros sem lembrete** — a maioria sem contato/confirmação confiável (dado legado). | Neon | 🟡 P2 (depende de 3.3) |

---

## 5. Bugs reproduzidos / confirmados com evidência

| # | Bug | Estado verificado | Evidência |
|---|---|---|---|
| 5.1 | `Anthropic 401 invalid x-api-key` | **Resolvido** — 3 erros em 13/11 (janela do incidente de env vars do Render, BUG/INCIDENTE documentado). Runs de 16/11 respondem com sucesso. | `agent_runs` (dashboard + Neon) |
| 5.2 | `message_delivery_config_required` | **Reproduzido em produção**: 2 runs do "Novo Lead 🚀" falharam em 13/11 21:54 e 22:40 UTC no nó `a1` (boas-vindas) e estão na **DLQ sem reprocessamento** (`resolvido_em` nulo). Causa no código: `messages.service.ts:147` — em produção exige `integration.externalBusinessId`; 13/11 foi o dia do incidente de env/instância. **2 leads reais não receberam boas-vindas.** | Neon `workflow_dlq` |
| 5.3 | `agentDelivery.findUnique()` e `agentExtraction.createMany()` | Erros de 11/11 (era Ollama/local, paths do Mac). Sem recorrência desde 16/11. Provável correção já deployada; **monitorar**. | dashboard errosRecentes |
| 5.4 | `Transaction API error: Unable to start a transaction` | Não encontrado nos logs recentes de erro (30d). Relacionado ao BUG-027 (corrigido 09/11). | dashboard |
| 5.5 | BUG-040 (passo de automação descartado com lease ocupado) | Corrigido na árvore; **3 runs de teste do v14 em produção ficaram `cancelado`** (16/11 01:10). Deploy de hoje (`3ca7fde`) menciona "webhook idempotente" — precisa re-teste do v14 para confirmar a correção em produção. | Neon + `Bugs.md` |
| 5.6 | Conflito de gatilhos: **"Novo Lead 🚀" (sem filtro de origem) + "MetaAds Tagging" disparam juntos** para lead Meta Ads → **duas oportunidades criadas na mesma etapa** (`4ac212e3`) + boas-vindas + tags. | grafos em produção | 🟠 P1 |
| 5.7 | Destinatários divergentes de notificação interna: fluxo ativo avisa `+5518981948549`; fluxos importados do GHL avisam `5518935000971`. | grafos | 🟡 P2 |

---

## 6. Ausente (não existe)

| # | Item | Impacto |
|---|---|---|
| 6.1 | **Escrita no Avec** (criar/reagendar/cancelar/confirmar via integração). Não há cliente de API do Avec; o acesso é scraping de relatórios read-only. Sem evidência de API pública do Avec no repo. | Requisito inegociável do master depende de viabilidade técnica a validar (Fase AVEC) |
| 6.2 | **Sincronização contínua Avec→KHUB** (AVEC-5): sem job; última importação 14/11 — agenda do KHUB já está 2 dias defasada e ficará mais | Agenda paralela divergente |
| 6.3 | **Notificação à equipe no handoff da IA** (WhatsApp para Sara/Vitória quando a Ritinha transfere) | SLA e problema #2 |
| 6.4 | **Monitoramento de SLA 2 min** (métrica + alerta + responsável) | Requisito do master |
| 6.5 | **Campos personalizados e máquina de estados de agendamento** (`solicitado → … → confirmado`) | Requisito do master |
| 6.6 | **Endpoint de versão do backend** (`/v1/versao` 404) — dificulta conferir deploy vs código | Observabilidade |
| 6.7 | **"digitando…" / marcar como lida** na Stevo (API de gestão não expõe — BUG-033 pendência) | UX |
| 6.8 | Rollback documentado de agente/fluxos (existe versionamento de ambos, mas sem runbook) | Go-live |

---

## 7. Dependências externas

| Dependência | Estado | Risco |
|---|---|---|
| Stevo API (WhatsApp não-oficial) | Conectada e entregando | Plano/estabilidade de terceiro; 502s viram 502 agora (BUG-042, deploy hoje) |
| Anthropic | Funcionando (claude-sonnet-5-5; `ANTHROPIC_MODEL_FORCE=claude-haiku-5-5` documentado no DEPLOY.md — **verificar divergência de modelo efetivo**) | Custo; 401 se a chave quebrar de novo |
| Avec | Acesso por credencial web (salão id 62338), scraping read-only | Quebra por mudança de layout; sem contrato de API |
| Render plano **free** | Em produção | **Dorme por inatividade → SLA de 2 min impossível garantir; Redis free não persiste fila** (DEPLOY.md já recomenda plano pago antes do go-live do WhatsApp) |
| Neon | Saudável | — |
| Vercel proxy | Funcionando | api.kromads.com.br sem DNS |

---

## 8. Riscos operacionais

1. 🔴 **217 arquivos modificados/não commitados** na branch `hardening/fase-0` (125 arquivos, +3.397/−827) — incluem BUG-036/040/041/042/044/045/046 e o MCP. O deploy de hoje veio de "snapshot curado" para outro repo; a árvore local **não está commitada em lugar nenhum**. Perda da máquina = perda do trabalho.
2. 🔴 **Plano free do Render**: instância dorme; SLA de 2 min e filas (lembretes, follow-ups) param. Bloqueante para go-live sério.
3. 🟠 **Trabalho paralelo de outra IA (ChatGPT) em curso hoje**: rascunho da Ritinha + 2 aprovações pendentes. Toda mudança nossa deve ser coordenada para não publicar duas versões concorrentes.
4. 🟠 **Prompt publicado contém chave PIX** (`34.333.0646/0001-59`) e o rascunho novo a remove como "não validada" — decisão de negócio necessária (validar origem ou não exibir).
5. 🟠 **DLQ com 2 leads reais** sem boas-vindas desde 13/11 — reprocessar manualmente (ação humana, não automática).
6. 🟡 Divergência de horário: instruções dizem "09:00–18:30"; `config.horario` diz seg–sex 08–18, sáb 08–12. Fontes contraditórias de verdade.
7. 🟡 `docker-compose.qa.yml` com senha literal (já marcado para não commitar); `.env*` fora do git (ok).

---

## 9. Mapa de correção proposto (ordem executiva)

1. **(P0) Ativação da Ritinha na linha de frente** — decidir com o dono o modelo: (a) Ritinha padrão no WhatsApp com `modo=automatico`, ou (b) nó "Ativar IA" no fluxo de entrada. Recomendo **(a) com regras de silêncio** (humano ativo, opt-out, transferida) + ajuste do "Novo Lead 🚀" para não falar junto (BUG-033 pendência conhecida).
2. **(P0) Notificação de handoff** — publicar a "Notificação Interna 🔔 (importado do GHL)" (tag-based) **ou** adicionar notificação nativa no `transferirParaHumano`. Validar destinatário único com a Rita.
3. **(P0) Autorização e execução do `corrigir-agenda.mjs --gravar`** (simulação já OK: 20.888 linhas) — pré-requisito para qualquer agenda inteligente.
4. **(P0) Fase AVEC** — investigar capacidades reais do Avec (API oficial? módulo de integração? exportação agendada?) antes de prometer agendamento automático. Sem escrita no Avec, o contrato correto é o da v2: **IA coleta, equipe confirma no Avec** — e o KHUB não pode confirmar horário por conta própria.
5. **(P1) Resolver conflito Novo Lead × MetaAds Tagging** (filtro de origem ou fusão).
6. **(P1) Decidir o rascunho pendente do ChatGPT** (revisar diff, aprovar/editar/rejeitar) e as 2 aprovações MCP.
7. **(P1) Campos personalizados + estados de agendamento** (db/053 existe; criar definições).
8. **(P1) SLA**: métrica por conversa (tempo até 1ª resposta útil) + alerta; upgrade do plano Render.
9. **(P2) Limpeza**: reprocessar DLQ (2 leads), arquivar rascunhos quebrados ("ADD TAG - ATIVAR IA" com 1 nó vazio), DNS `api.kromads.com.br`, Evolution.

---

*Próxima etapa: Fase AVEC (viabilidade técnica real) + proposta de ativação da Ritinha para aprovação do usuário. Ver `STATUS_EXECUCAO.md`.*

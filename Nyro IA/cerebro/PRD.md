# PRD — KHUB

> Fonte da verdade do produto. Transcrição fiel do documento **"KHUB — Documento de Produto e Arquitetura", Versão 1.0, Julho de 2026, Confidencial**. Nada aqui foi resumido. Onde o documento original não define algo necessário à construção, há uma marca `> ⚠️ LACUNA:`.

- **Produto:** KHUB — o primeiro CRM vertical totalmente configurado por Inteligência Artificial.
- **Powered by:** Nyro IA.
- **Versão do documento base:** 1.0 · Julho de 2026 · Confidencial.
- **Fase atual:** F0 — Fundação.

Documentos irmãos: [[Arquitetura]] · [[Banco]] · [[APIs]] · [[RegrasNegocio]] · [[Tasks]] · [[Sprint]] · [[Bugs]]

---

## 1. Sumário Executivo

O KHUB é um CRM de vendas vertical, multi-tenant, cuja principal diferenciação é ser **totalmente configurado por Inteligência Artificial**. No momento da criação da conta, o usuário escolhe o modelo de negócio dele (clínica médica, escritório de advocacia, escritório de contabilidade, agência, entre outros) e entra em um CRM **já pronto**: pipelines montados, automações ativas, campos personalizados, dashboards e integrações configuradas para aquele nicho.

No centro de tudo está a **Nyro IA**, o assistente de crescimento mais completo do mercado: uma IA que domina vendas, marketing, copy, tecnologia, crescimento, contabilidade e jurídico, alimentada por um **RAG especializado por nicho e subespecialidade** (ex.: advogado bancário, advogado previdenciário, médico neurologista, áreas contábeis). A Nyro não é um chatbot acoplado: ela é a camada de inteligência que configura, opera e otimiza o CRM inteiro.

Completam o produto um **motor de automações visual** no estilo n8n / GoHighLevel (workflows funcionais em um workspace drag-and-drop) e **integrações nativas** com Meta, Google, LinkedIn, Stripe, WhatsApp e demais canais — todas conectadas à Nyro IA.

Este documento descreve o produto de ponta a ponta: visão, funcionalidades, front-end, back-end, banco de dados, APIs, segurança e o método de construção baseado em um cérebro de documentação no Obsidian lido pelo Claude Code.

### Posicionamento em uma frase
> "O KHUB é o CRM que já nasce pronto para o seu negócio — configurado, automatizado e operado por uma IA que entende do seu mercado."

---

## 2. O Problema e a Oportunidade

### 2.1 O problema
- **CRMs genéricos exigem semanas de configuração.** Ferramentas como HubSpot, Pipedrive e GoHighLevel entregam uma tela em branco: o dono do negócio precisa montar pipelines, automações, campos e integrações sozinho ou pagar uma agência para isso.
- **Empresários de nicho não falam a língua de CRM.** Um médico, um advogado ou um contador pensa em pacientes, processos e obrigações — não em 'deals', 'stages' e 'triggers'.
- **IA embarcada em CRM ainda é superficial.** A maioria dos concorrentes usa IA apenas para resumir notas ou escrever e-mails. Nenhum entrega uma IA que **configura e opera** o sistema com conhecimento profundo do nicho.
- **Automação é cara e fragmentada.** Hoje o empresário junta CRM + n8n/Make + ferramenta de IA + gateway de pagamento + BI, pagando 4 a 6 assinaturas e mantendo integrações frágeis.

### 2.2 A oportunidade
- Mercado de CRM vertical em expansão, com disposição a pagar premium por solução pronta.
- Agências (como a própria MedScale) podem revender templates e operar carteiras de clientes dentro do KHUB — canal de distribuição natural via white-label/parceiros.
- O custo de inferência de LLMs caiu a ponto de viabilizar uma IA operadora (não apenas assistente) com margem saudável em SaaS.

### 2.3 Para quem

| Perfil | Dor principal | O que o KHUB entrega |
|---|---|---|
| Clínicas médicas e estéticas | Agenda cheia de furos, follow-up manual, sem visão de funil | CRM médico pronto: pipeline de pacientes, confirmação automática, Nyro treinada em saúde |
| Escritórios de advocacia | Captação desorganizada, prazos e processos fora do funil | CRM jurídico com pipelines por área (bancário, previdenciário, trabalhista...) |
| Escritórios de contabilidade | Onboarding de clientes lento, obrigações recorrentes manuais | CRM contábil com automações de obrigações, cobrança e relacionamento |
| Agências de marketing | Gerir vários clientes em ferramentas separadas | Workspace multi-conta, templates revendáveis, dashboards por cliente |

---

## 3. Visão Geral da Solução

O KHUB é composto por **cinco camadas de produto** que funcionam como um organismo único:

| Camada | Descrição |
|---|---|
| **1. CRM Core** | Contatos, empresas, pipelines Kanban, tarefas, agenda, inbox omnichannel (WhatsApp, Instagram, e-mail), propostas e dashboards. |
| **2. Templates Verticais** | Blueprints completos por nicho aplicados na criação da conta: pipelines, automações, campos, tags, mensagens e relatórios prontos. |
| **3. Nyro IA** | Camada de inteligência: configura o CRM, conversa com leads, gera copy e campanhas, analisa métricas e recomenda ações. RAG por nicho. |
| **4. Motor de Automações** | Workflow builder visual (estilo n8n/GHL): gatilhos, condições, ações, esperas, webhooks e nós de IA, com logs e fallback. |
| **5. Integrações** | Meta (Ads + Instagram/Messenger), Google (Ads, Calendar, Gmail), LinkedIn, Stripe, WhatsApp (Cloud API / Evolution), webhooks genéricos. |

### 3.1 Jornada do usuário (onboarding em 5 minutos)
- **Passo 1 — Cadastro:** cria a conta com e-mail ou Google.
- **Passo 2 — Escolha do template:** seleciona o nicho (Médico, Advocacia, Contábil, Agência...) e a subespecialidade (ex.: neurologia; advogado previdenciário).
- **Passo 3 — Entrevista da Nyro:** a IA faz 5 a 8 perguntas (nome da empresa, ticket médio, canais de captação, equipe) e ajusta o blueprint em tempo real.
- **Passo 4 — Provisionamento automático:** o back-end instancia pipelines, automações, campos, mensagens e dashboards do template escolhido, já personalizados com os dados da entrevista.
- **Passo 5 — Conexões:** wizard de integração (WhatsApp, Meta, Google, Stripe) com OAuth guiado pela Nyro.

Resultado: em minutos o usuário abre um CRM que parece ter sido implantado por uma consultoria especializada no nicho dele — porque foi, só que pela IA.

> ⚠️ LACUNA: O PRD não define o comportamento se o usuário abandonar o onboarding no meio (estado parcial de provisionamento). Ver melhoria proposta #2 (entrevista deve produzir *diff JSON* aprovado, nunca aplicar direto).

---

## 4. Templates Verticais (CRM pronto por nicho)

Cada template é um **blueprint versionado (JSON declarativo)** que descreve tudo que será provisionado na conta: pipelines e etapas, campos personalizados, tags, automações, mensagens, calendários, dashboards e o pacote de conhecimento (RAG) da Nyro para aquele nicho.

### 4.1 Exemplos de blueprint

| Template | Pipelines prontos | Automações incluídas |
|---|---|---|
| **Clínica Médica** | Captação de pacientes; Agendamento; Pós-consulta / Recorrência; Orçamentos de procedimentos | Confirmação de consulta (WhatsApp), resgate de no-show, follow-up de orçamento, pesquisa de satisfação, reativação de pacientes inativos |
| **Advocacia** | Captação de casos; Análise de viabilidade; Proposta / Contrato; Processos em andamento | Qualificação automática do caso pela Nyro, envio de proposta, lembretes de documentos, atualização de status ao cliente |
| **Contabilidade** | Prospecção; Onboarding de cliente; Obrigações mensais; Upsell (BPO, consultoria) | Checklist de onboarding, cobrança recorrente via Stripe/Pix, lembretes de obrigações, NPS trimestral |
| **Agência** | Prospecção; Fechamento; Onboarding de cliente; Entregas recorrentes | Sequência de follow-up comercial, kickoff automatizado, relatório mensal gerado pela Nyro |

### 4.2 Estrutura técnica do blueprint

```
template/
  manifest.json     # id, versao, nicho, subespecialidades
  pipelines.json    # funis, etapas, probabilidades, SLAs
  fields.json       # campos custom por entidade
  automations.json  # workflows (mesmo schema do motor)
  messages.json     # templates de WhatsApp/e-mail
  dashboards.json   # widgets e KPIs do nicho
  nyro/             # persona, regras e ponteiro para a base RAG
```

- Templates são **versionados**: contas antigas podem migrar para novas versões com diff e aprovação do usuário.
- Agências parceiras poderão **criar e publicar templates próprios** (marketplace futuro), usando o mesmo schema.

> ⚠️ LACUNA: O PRD não especifica o JSON Schema formal de cada arquivo do blueprint (campos obrigatórios, tipos, enums). Definição fica para F2 — Templates. Ver [[Tasks]] backlog F2.

---

## 5. Nyro IA — O Cérebro do Sistema

A Nyro IA é o diferencial competitivo do KHUB. Ela atua em **quatro papéis simultâneos**:

| Papel | O que faz |
|---|---|
| **Arquiteta** | Configura e reconfigura o CRM: cria pipelines, campos, automações e dashboards a partir de linguagem natural ('crie um funil para o plano anual'). |
| **Operadora (SDR/Atendente)** | Conversa com leads no WhatsApp/Instagram: qualifica, agenda, responde dúvidas do nicho usando o RAG, faz follow-up e escala para humano. |
| **Estrategista de Growth** | Analisa métricas do CRM e das integrações de ads; sugere e cria campanhas, públicos, criativos e copies; aponta gargalos do funil. |
| **Consultora do Nicho** | Responde como especialista da área (medicina, jurídico, contábil) com base no RAG da subespecialidade, sempre com guardrails de compliance. |

### 5.1 Arquitetura do agente
- **Orquestrador multi-agente:** um agente roteador classifica a intenção e delega para sub-agentes (Configuração, Conversas, Growth, Consultoria), cada um com prompt de sistema, ferramentas e RAG próprios.
- **Function calling / tools:** a Nyro só altera o sistema através de ferramentas tipadas (`create_pipeline`, `update_automation`, `send_message`, `create_campaign`...). Nenhuma escrita direta no banco — tudo passa pela API com validação e auditoria.
- **Memória em três níveis:** (1) memória da conversa; (2) memória da conta — fatos do negócio, preferências, decisões; (3) conhecimento do nicho via RAG.
- **Human-in-the-loop:** ações sensíveis (disparo em massa, alteração de automação ativa, criação de campanha paga) exigem confirmação do usuário no chat.
- **Guardrails:** filtros de compliance por nicho (ex.: CFM para saúde, OAB para jurídico), limites de gasto, blocklist de promessas e claims proibidos.

### 5.2 Onde a Nyro aparece no produto
- Chat lateral persistente em todas as telas (command bar com atalho).
- Dentro do inbox: sugestão de resposta, resumo da conversa, detecção de intenção.
- Dentro do workflow builder: 'descreva a automação' e a Nyro monta o fluxo.
- Dentro dos dashboards: insights automáticos semanais e alertas de anomalia.

> ✅ **LACUNA FECHADA (Sprint F — ADR-0014):** o conjunto fechado de tools está em `apps/api/src/nyro/tools.ts`, com schema Zod por tool e um nível de sensibilidade (`leitura`/`escrita`/`sensivel`). São **14 tools**: 5 de leitura (RAG, funil, contatos, perfil, automações), 6 de escrita interna (criar/atualizar contato, tarefa, nota, oportunidade, memória) e 3 **sensíveis** que exigem aprovação humana (enviar mensagem, mover etapa, ligar/desligar automação). Tool fora do catálogo não existe — o executor recusa. Os 4 sub-agentes (`agentes.ts`) enxergam só as tools do papel deles.

---

## 6. RAG por Nicho e Subespecialidade

Cada template carrega uma **base de conhecimento vetorizada** própria, com herança em três níveis:
**Global** (vendas, marketing, copy, growth — comum a todos) → **Nicho** (medicina, jurídico, contábil) → **Subespecialidade** (neurologia; advogado bancário; advogado previdenciário; departamento fiscal, pessoal e societário no contábil).

### 6.1 Pipeline de ingestão
- **Fontes:** playbooks internos da agência, materiais públicos do nicho, FAQs, scripts de vendas validados, documentos que o próprio cliente sobe (contratos, tabelas de preços, protocolos).
- **Processamento:** chunking semântico → embeddings → armazenamento no **pgvector** (Postgres) com metadados de nível, nicho, subespecialidade e tenant.
- **Recuperação híbrida:** busca vetorial + BM25 + re-ranking, filtrada por tenant e nível de herança — o RAG do cliente A jamais responde para o cliente B.
- **Atualização contínua:** conversas bem avaliadas e decisões do usuário alimentam a base da conta (feedback loop com curadoria).

### 6.2 Isolamento e segurança do conhecimento
- Documentos do tenant ficam em **namespace exclusivo** (`tenant_id` em toda query).
- Bases de nicho são **read-only** para as contas; apenas o time KHUB versiona e publica.
- Toda resposta da Nyro **cita internamente as fontes usadas** (rastreabilidade para auditoria).

> ⚠️ LACUNA: O PRD não define o modelo de embeddings, dimensão do vetor, tamanho de chunk, nem o re-ranker específico. Deriva-se para F3. Registrar como ADR quando decidido.

---

## 7. Motor de Automações (Workflow Builder)

Workspace visual de automação no estilo **n8n + GoHighLevel**: canvas drag-and-drop com nós conectáveis, execução assíncrona confiável e observabilidade completa.

### 7.1 Tipos de nó

| Categoria | Exemplos de nós |
|---|---|
| **Gatilhos** | Novo lead, mudança de etapa, tag adicionada, mensagem recebida, formulário enviado, webhook recebido, agendamento criado, pagamento no Stripe, data/recorrência |
| **Condições** | If/else, switch por campo, filtro por tag/origem, split A/B, verificação de horário comercial |
| **Ações** | Enviar WhatsApp/e-mail/SMS, mover etapa, criar tarefa, atualizar campo, notificar equipe, criar cobrança Stripe, chamar webhook/HTTP |
| **IA (Nyro)** | Qualificar lead, gerar resposta, classificar intenção, resumir conversa, decidir próximo passo, gerar copy personalizada |
| **Controle** | Esperar (tempo/evento), objetivo atingido (goal), encerrar, loop limitado |

> ✅ **LACUNA FECHADA (Sprint E — ADR-0012, emendado pelo ADR-0013):** os nós estão congelados em `apps/api/src/automations/catalogo.ts` (fonte única: API e canvas leem dali). Hoje são **21**:
> **Gatilhos (6):** contato criado · tag adicionada · oportunidade criada · mudou de etapa · mensagem recebida · **webhook recebido**.
> **Controle (5):** esperar · **esperar resposta** (ramos Respondeu/Não respondeu) · condição If/Else (AND/OR/NONE) · ir para · **encerrar**.
> **Ações (10):** enviar SMS · adicionar tag · remover tag · atualizar contato · criar oportunidade · mover etapa · criar tarefa · **adicionar nota** · **acionar outro fluxo** · enviar webhook.
> **Configurações do fluxo** (fora do canvas): reentrada, parar no reply, janela de envio + timezone.
> **Fora do catálogo por não existirem no produto:** Appointments (`/agenda` é stub), Payments (Sprint C), Google Ads (Sprint B), Courses/Affiliate/IVR/Communities/Certificates/Ecommerce/Custom Objects. Nó de IA entra no Sprint F, atrás de `ANTHROPIC_API_KEY`. **Nó novo exige atualizar o catálogo E este PRD no mesmo PR.**

### 7.2 Engine de execução
- **Execução orientada a eventos:** gatilhos publicam eventos em fila (**Redis + BullMQ**); workers processam cada passo de forma **idempotente**.
- **Estado persistido por execução:** cada 'run' guarda snapshot do contexto, permitindo retomar esperas de dias/semanas sem perder dados.
- **Fallback e retries:** política de retry exponencial por nó, caminho alternativo em caso de falha (ex.: WhatsApp caiu → envia e-mail), dead-letter queue com alerta.
- **Logs e monitoramento:** timeline visual de cada execução (nó a nó), métricas de conversão por automação, alertas de erro para o usuário e para o suporte.
- **Versionamento de workflow:** publicar/rascunho, rollback de versão, teste com contato fake.

---

## 8. Integrações Nativas

| Integração | Escopo | Uso pela Nyro |
|---|---|---|
| **Meta (Facebook/Instagram)** | Lead Ads (webhook de leads), Conversions API, Instagram DM e Messenger, métricas de campanhas via Marketing API | Cria/pausa campanhas, analisa CPL/ROAS, responde DMs, envia eventos de conversão do funil |
| **Google** | Google Ads (métricas e conversões offline), Google Calendar (agenda), Gmail (envio/threads), Sheets (export) | Analisa campanhas, agenda reuniões/consultas, sincroniza disponibilidade |
| **LinkedIn** | Lead Gen Forms, perfil da empresa, publicação de conteúdo | Captura leads B2B, sugere conteúdo para autoridade |
| **Stripe** | Checkout, assinaturas, faturas, webhooks de pagamento; também é o billing do próprio KHUB | Cria cobranças a partir do funil, dispara automações por pagamento aprovado/falho |
| **WhatsApp** | WhatsApp Cloud API (oficial) e Evolution API (número próprio) — inbox unificado | Atendimento e follow-up conversacional, confirmações, campanhas de reativação |
| **Webhooks / API pública** | Entrada e saída genéricas, chaves de API por tenant, docs OpenAPI | Conecta qualquer sistema externo (ERP, prontuário, sistema jurídico) |

- Todas as credenciais OAuth ficam **criptografadas por tenant (KMS)**, com refresh automático de tokens e tela de saúde das conexões.
- Arquitetura de **conectores plugável**: cada integração é um módulo isolado com contrato padrão (auth, sync, webhooks, actions), facilitando adicionar novos canais.

---

## 9. Arquitetura Técnica — Visão Geral

Ver documento dedicado: [[Arquitetura]].

Arquitetura de **monólito modular** no início (velocidade de entrega) com fronteiras claras que permitem extrair serviços depois (IA e automações são os primeiros candidatos).

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

## 10. Front-end

Ver detalhamento em [[Arquitetura]] §Front-end.

### 10.1 Princípios de UI/UX
- **Identidade KHUB:** base clara, **roxo `#7B2FBE`** como cor de ação, visual premium e limpo coerente com a marca (trevo de diamantes). Assets oficiais no repositório: `logo.png` (1058×1058) e `Identidade visual.png` (1340×1320).
- **Mobile-first:** dono de clínica e advogado operam pelo celular; inbox e Kanban 100% responsivos.
- **A Nyro sempre a um atalho de distância:** painel lateral + command bar (`Cmd/Ctrl+K`).
- **Zero tela em branco:** todo módulo abre com dados do template e estados vazios com CTA da Nyro.

### 10.2 Mapa de telas

| Módulo | Telas principais |
|---|---|
| Onboarding | Cadastro → escolha de template → entrevista Nyro → wizard de integrações → tour |
| Dashboard | KPIs do nicho, insights da Nyro, alertas, atalhos |
| Pipelines | Kanban drag-and-drop, visão lista/tabela, filtros salvos, card do deal com timeline |
| Inbox Omnichannel | Conversas unificadas (WhatsApp/IG/e-mail), sugestões da Nyro, transferência, notas internas |
| Contatos/Empresas | Perfil 360, histórico, campos custom do template, deduplicação |
| Automações | Canvas de workflow (React Flow), biblioteca de nós, logs de execução, versões |
| Agenda | Calendário (Google sync), links de agendamento públicos, confirmações |
| Marketing | Campanhas Meta/Google conectadas, métricas, criação assistida pela Nyro |
| Financeiro | Cobranças Stripe, assinaturas, inadimplência, relatórios |
| Nyro Chat | Chat full-page + painel lateral, histórico, ações executadas, aprovações pendentes |
| Configurações | Equipe e permissões, integrações, billing, white-label (fase 2) |

### 10.3 Arquitetura front
- Next.js App Router com **rotas por tenant** (`app.orvyn.com`; subdomínio próprio no white-label).
- Design system próprio sobre Tailwind + shadcn/ui, tokens de marca centralizados.
- Tempo real via WebSocket (inbox, Kanban, execução de automação ao vivo).
- React Flow para o canvas de automações; Recharts para dashboards.

---

## 11. Back-end

Ver detalhamento em [[Arquitetura]] §Back-end e [[Banco]].

### 11.1 Módulos (NestJS)

| Módulo | Responsabilidade |
|---|---|
| `auth` | Login, OAuth Google, sessões JWT + refresh, 2FA, convites de equipe |
| `tenants` | Contas, planos, provisionamento de template, versionamento de blueprint |
| `crm` | Contatos, empresas, deals, pipelines, tarefas, notas, campos custom, tags |
| `inbox` | Canais, conversas, mensagens, atribuição, SLAs de resposta |
| `automations` | CRUD de workflows, engine de execução, scheduler, logs |
| `nyro` | Orquestrador de agentes, tools, memória de conta, guardrails, filas de aprovação |
| `rag` | Ingestão, chunking, embeddings, busca híbrida, namespaces por tenant/nicho |
| `integrations` | Conectores Meta/Google/LinkedIn/Stripe/WhatsApp, OAuth vault, webhooks in/out |
| `billing` | Assinaturas do KHUB no Stripe, medição de uso de IA (créditos), limites por plano |
| `analytics` | Eventos de produto, KPIs por nicho, materialized views para dashboards |
| `audit` | Log imutável de toda ação (humana ou da Nyro): quem, o que, quando, com que dado |

### 11.2 Padrões obrigatórios
- Toda ação da Nyro passa pelas mesmas APIs e permissões de um usuário — com identidade própria (`actor: 'nyro'`) no audit log.
- Idempotência em webhooks e workers (chave de deduplicação por evento).
- Rate limiting por tenant e por integração; circuit breaker nos conectores.
- Feature flags por plano/tenant para lançamentos graduais.

---

## 12. Banco de Dados e Modelo Multi-tenant

Ver documento dedicado: [[Banco]].

**Estratégia:** banco único compartilhado com **Row-Level Security (RLS)** do Postgres — toda tabela de negócio carrega `tenant_id` e as policies garantem isolamento no nível do banco, não apenas da aplicação. Tenants enterprise poderão migrar para schema dedicado no futuro.

---

## 13. APIs e Contratos

Ver documento dedicado: [[APIs]].

REST versionada (`/v1`) + WebSocket para tempo real. Documentação OpenAPI pública para a API de parceiros.

---

## 14. Segurança e LGPD

Ver detalhamento em [[RegrasNegocio]] §Segurança e LGPD.

- Dados sensíveis (saúde e jurídico) tratados como **dados pessoais sensíveis**: criptografia em trânsito (TLS 1.3) e em repouso, chaves gerenciadas (KMS), mascaramento em logs.
- **RLS no banco + testes automatizados de isolamento entre tenants a cada release.**
- Base legal e consentimento registrados por contato; ferramentas de exportação e exclusão (direitos do titular) nativas.
- Guardrails da Nyro por nicho: sem diagnóstico médico, sem promessa de resultado jurídico, compliance de publicidade (CFM/OAB) embutido no prompt e em validadores pós-resposta.
- Retenção configurável de conversas e gravações; anonimização após encerramento de conta.
- Pentest e revisão de dependências antes do GA; SSO/SAML no plano enterprise.

---

## 15. Método de Desenvolvimento — Cérebro Obsidian + Claude Code

O KHUB será construído com um método de **documentação viva como fonte única de verdade**. Todo o contexto do projeto mora em um vault do Obsidian (o 'cérebro'), na mesma pasta já conectada à Nyro IA. O Claude Code lê essa documentação antes de gerar qualquer código — o código nunca diverge da especificação.

### 15.1 Estrutura do vault (original do PRD)

```
Nyro IA/
  PRD.md            # visao, personas, requisitos, escopo por fase
  Arquitetura.md    # diagramas, decisoes (ADRs), stack, fronteiras de modulo
  Banco.md          # schema, RLS, indices, migracoes planejadas
  APIs.md           # contratos, payloads, erros, webhooks
  Tasks.md          # backlog priorizado com criterios de aceite
  Bugs.md           # reproducao, severidade, status
  RegrasNegocio.md  # regras por nicho, limites de plano, guardrails da Nyro
  Sprint.md         # sprint atual: objetivo, tasks, definicao de pronto
  Projeto/          # codigo-fonte
```

> **Nota de implementação (decisão desta sessão — ADR-0001 em [[Arquitetura]]):** O vault Obsidian real já existe em `Nyro IA/`. Os 8 arquivos do cérebro foram criados na subpasta `Nyro IA/cerebro/` para agrupamento (nome canônico `/cerebro/` do master prompt) mantendo-os **dentro** do vault, o que preserva o dogfooding do RAG previsto na §15.2. O código-fonte fica no monorepo em `apps/` na raiz do repositório, não em `Projeto/`.

### 15.2 Regras do método
- **Doc-first:** nenhuma feature entra no código sem estar no `PRD.md` e no `Tasks.md` com critério de aceite.
- **CLAUDE.md na raiz do repositório** aponta para o vault e define convenções: 'antes de codar, leia PRD, Arquitetura, Banco, APIs e RegrasNegocio; ao terminar, atualize Tasks e Sprint'.
- **ADRs em Arquitetura.md:** toda decisão técnica relevante é registrada com contexto, opções e consequências — o Claude Code consulta antes de propor mudanças estruturais.
- **Sprints curtas (1 semana):** `Sprint.md` define objetivo único; `Bugs.md` alimenta a triagem; nada de escopo paralelo.
- **Sincronia com a Nyro:** como o vault está na mesma pasta da Nyro IA, a própria IA do produto poderá consultar a documentação (dogfooding do RAG).

---

## 16. Roadmap de Construção (MVP ao Scale)

| Fase | Duração | Entregas | Critério de sucesso |
|---|---|---|---|
| **F0 — Fundação** | 2-3 sem | Monorepo, auth, multi-tenant + RLS, design system, CI/CD, vault Obsidian completo | Conta criada e isolada; deploy automatizado |
| **F1 — CRM Core** | 4-6 sem | Contatos, pipelines Kanban, tarefas, inbox WhatsApp (Evolution), campos custom | Um cliente real da agência operando o dia a dia |
| **F2 — Templates + Provisionamento** | 3-4 sem | Schema de blueprint, 3 templates (Médico, Advocacia, Contábil), onboarding com entrevista | Conta nova sai 100% configurada em < 5 min |
| **F3 — Nyro IA v1** | 4-6 sem | Chat + tools de configuração, RAG global + 3 nichos, SDR no WhatsApp com aprovação humana | >60% das conversas qualificadas sem humano |
| **F4 — Automações** | 4-5 sem | Workflow builder visual, engine BullMQ, logs, 15 nós essenciais, automações dos templates ligadas ao motor | Automações dos 3 templates rodando no motor |
| **F5 — Integrações + Billing** | 4-5 sem | Meta Lead Ads + Ads API, Google Calendar/Ads, Stripe (cliente e billing KHUB), WhatsApp Cloud API | Lead do anúncio ao fechamento sem sair do KHUB |
| **F6 — Beta fechado** | 4 sem | 10-20 contas (base da agência), telemetria, hardening, LGPD, pricing final | NPS > 50; churn de beta < 10% |
| **F7 — Lançamento + Scale** | contínuo | Nyro Growth (campanhas), LinkedIn, white-label para agências, marketplace de templates | MRR e CAC/LTV dentro das metas |

**Estimativa total até o beta:** ~6 meses com squad enxuto (1-2 devs full stack com Claude Code, 1 designer/produto, apoio da operação da agência para validação com clientes reais).

---

## 17. Modelo de Negócio e Métricas

| Plano | Proposta | Composição sugerida |
|---|---|---|
| **Starter** | Profissional solo do nicho | 1 usuário, 1 pipeline extra, Nyro com créditos mensais, WhatsApp 1 número |
| **Growth** | Clínicas/escritórios com equipe | 5 usuários, automações ilimitadas, integrações de ads, créditos ampliados |
| **Scale / Agency** | Agências e operações maiores | Multi-conta, white-label, API, templates próprios, SSO |

- Uso de IA medido em **créditos** (mensagens da Nyro, gerações, análises) — protege margem e cria upsell natural.
- **Métricas norte:** ativação (conta provisionada + 1ª integração + 1ª conversa em 24h), % de conversas resolvidas pela Nyro, retenção M3, MRR, CAC/LTV, margem de IA por conta.

> ⚠️ LACUNA: O PRD não define preços em R$, quantidade de créditos por plano, nem a taxa de conversão crédito↔token. Ver melhoria proposta #1 (medir `ai_usage_events` desde F0).

---

## 18. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Escopo gigante para um MVP | Atraso, produto raso em tudo | Roadmap faseado; F1-F3 focados em 3 nichos e 1 canal (WhatsApp); 'não' como padrão para features fora do PRD |
| Custo de inferência da IA | Margem comprimida | Créditos por plano, cache de respostas, modelos menores para tarefas simples, roteamento por complexidade |
| Alucinação em nichos regulados | Risco jurídico/reputacional | RAG com fontes curadas, guardrails por nicho, validadores pós-resposta, aprovação humana em ações sensíveis |
| Dependência de APIs de terceiros (Meta/WhatsApp) | Quebra de funcionalidades | Conectores isolados com circuit breaker, dupla via WhatsApp (Cloud API + Evolution), monitoramento de deprecations |
| Vazamento entre tenants | Catastrófico (dados sensíveis) | RLS no banco, testes de isolamento automatizados, namespaces de RAG por tenant, auditoria |
| Concorrência (GHL, HubSpot + IA) | Comoditização | Foco em profundidade vertical (RAG + compliance por nicho) e na Nyro como operadora, não só assistente |

---

## 19. Próximos Passos (do PRD original)

1. Validar este documento e congelar o escopo do MVP (F0-F3).
2. Criar o vault Obsidian com os 8 arquivos e transcrever este PDF para `PRD.md`, `Arquitetura.md`, `Banco.md` e `APIs.md`. ✅ (esta sessão)
3. Definir os 3 blueprints iniciais em JSON (Médico, Advocacia, Contábil) usando os playbooks reais da agência.
4. Montar o monorepo (Next.js + NestJS + Prisma + Postgres/pgvector + Redis) com `CLAUDE.md` apontando para o vault.
5. Rodar a F1 com um cliente piloto real da base MedScale para validar o CRM Core antes de ligar a Nyro.

---

## Anexo A — Melhorias propostas ao PRD (a incorporar após aprovação)

Estas melhorias vêm do master prompt de bootstrap, não do PDF original. Registradas aqui para não se perderem; só entram no escopo após aprovação explícita.

1. **Créditos de IA desde F0** — criar `ai_usage_events` no schema inicial (medição de tokens por tenant desde a 1ª chamada da Nyro). Sem isso, a margem real é descoberta tarde.
2. **Entrevista de onboarding da Nyro (F2) produz *diff JSON* proposto**, exibido ao usuário para aprovação — nunca aplica direto no blueprint (maior risco de alucinação).
3. **Roteamento por complexidade de modelo desde F3** — modelo pequeno para classificação/extração; modelo grande para raciocínio/configuração.
4. **Congelar o motor de automações em 15 nós em F4.** Nó novo só entra com pedido de cliente pagante.
5. **Faltas do PRD a definir:** política de retenção e custo de armazenamento de mídia do WhatsApp (áudio/imagem escalam rápido); modelo de **permissões granulares** (o PRD só cita `role`).

> ⚠️ LACUNA (permissões): o PRD cita apenas `role` em `users`. O modelo de permissões granulares (RBAC/ABAC, escopos por módulo) não está definido. Decisão adiada; registrar ADR quando abordado (candidato a F0/F1).

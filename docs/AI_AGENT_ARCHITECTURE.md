# KHUB Agent Intelligence Platform: arquitetura

> Documento técnico interno. Status de implementação: `docs/AI_AGENT_IMPLEMENTATION_STATUS.md`.
> Decisão registrada como ADR-0038 em `Nyro IA/cerebro/Arquitetura.md`.

## 1. Engenharia reversa: o que já existia e foi reaproveitado

| Área | Estado encontrado | Uso no Agent Intelligence |
|---|---|---|
| Front | Next.js 14 App Router, TS strict, Tailwind, design system KHUB (ADR-0036/0037), proxy autenticado `/api/v1/*` | Telas em `apps/web/app/(app)/agentes/**`, componentes em `apps/web/components/agents/**`, cliente `apps/web/lib/agents.ts` |
| Back | NestJS 10 monólito modular, REST `/v1`, erros RFC 7807 + correlation-id, `ValidationPipe` global | Módulo `apps/api/src/agents/**` (já existia como Agent Manager ADR-0030; foi expandido, não duplicado) |
| Banco | Postgres 16 + pgvector, Prisma 5 (sem Prisma Migrate), migrações SQL em `db/` com ledger `schema_migrations` | `db/034_agent_intelligence.sql` + teste `db/034_agent_intelligence_isolation_test.sql` |
| Multi-tenant | Tenant = Subaccount (agência → contas cliente). RLS FORCE em toda tabela de negócio, `withTenant()` faz `set_config('app.current_tenant_id')`, role `khub_app` sem BYPASSRLS, gatilho `khub_check_tenant_reference` contra referência cruzada | Todas as 16 tabelas novas com RLS + gatilho; tenant sempre do JWT |
| Auth/permissões | JWT, papéis owner/admin/manager/member/viewer/api, `PermissionsGuard` por controller | Escrita em `agents/*` = `organization.manage` (owner/admin); leitura = `contacts.read` |
| CRM | Contatos (tags, `campos_custom`), negócios/etapas, tarefas, notas, agenda, workflows | Action Engine usa os SERVIÇOS existentes (CrmService, TasksService, NotesService, AgendaService, WorkflowsService) |
| WhatsApp | Evolution (CANAL_MVP), Stevo legado e Stevo API por tenant, webhook → outbox → worker, `MessagesService.send` idempotente com trava de dev | Entrega dos blocos pela MESMA `MessagesService.send` (provedor preservado; troca de provedor continua sendo por tenant na camada existente) |
| Filas | Redis + BullMQ, worker separado (`dist/worker.js`), outbox com reconcile a cada 5s | Filas novas: `agent-delivery`, `agent-evaluations`, `agent-maintenance` (além de `agent-replies`) |
| IA | `AnthropicProvider` (fetch na Messages API, circuit breaker, preço por modelo, fallback de recusa), catálogo de modelos 5.5 | Estendido com structured outputs (`output_config.format`), timeout por chamada e `ANTHROPIC_BASE_URL` |
| RAG | Chunking estrutural, Voyage, busca híbrida RRF no banco, cache, invariantes (tenant da sessão, chunk é dado, filtro no WHERE) | Fontes por agente, extração de PDF/DOCX/CSV/URL, busca filtrada por documento dentro do WHERE |

## 2. Subsistemas

```
WhatsApp (Evolution/Stevo) → webhook → outbox → worker
   └─ message.created (contato) → fila agent-replies (4 s de rajada)
        └─ AgentRuntimeService (atendimento real)
             1. identifica contato/conversa; nova mensagem INTERROMPE blocos e follow-ups pendentes
             2. versão publicada do agente (VersioningService) + orçamento + limites
             3. memória (MemoryService) + perfil (ProfileService) + fontes do agente (KnowledgeService)
             └─ IntelligenceCoreService.processar()
                  5–8  análise estruturada (intenção, problema, objeções, sentimento, urgência, extrações)
                       structured outputs; fallback determinístico (engines/analysis.ts)
                  ·    perfil: política de fatos (engines/profile-policy.ts) + sincronização com CRM
                  ·    regras SE/ENTÃO (engines/rules-engine.ts) → instruções no prompt / ações (Action Engine)
                  9    conhecimento: busca do agente + confiança + conflito (knowledge.service.ts)
                  10–13 geração com ferramentas tipadas (AgentToolsService = Action Engine)
                  14   guardrail de nicho (nyro/guardrails.ts) + naturalidade (engines/response-validator.ts)
                  15   fragmentação (engines/message-chunker.ts)
             16 DeliveryService.enfileirar → fila agent-delivery (ordem, atraso, idempotência, retry)
             17 run com trace estruturado, uso de IA, eventos de aprendizado
             18 follow-up (FollowupService) + memória operacional + resumo progressivo
```

| Subsistema | Código | Responsabilidade |
|---|---|---|
| Agent Manager | `agents.service.ts`, `agents.controller.ts` | CRUD, ciclo de vida, duplicar, excluir (arquivado + nome), intenções e perfis de personalidade do tenant |
| Configuration Engine | `config/agent-config.ts` | Schema Zod da `agents.config` (identidade, personalidade, comportamento, regras, comunicação, inteligência, conhecimento, memória, CRM, permissões); leitura tolerante por seção |
| Intelligence Core | `intelligence/intelligence-core.service.ts`, `intelligence/prompt.ts` | Ciclo de decisão; independente de canal e de modo (atendimento, simulador, avaliação) |
| Knowledge Engine | `knowledge/*`, `rag/retrieval.service.ts#searchAgente` | Extração, ingestão, fontes por agente, busca filtrada, confiança, conflito |
| Conversation Engine | `engines/message-chunker.ts`, `engines/response-validator.ts`, `delivery/*` | Fragmentação semântica com fallback determinístico, naturalidade, fila de entrega |
| Context / Memory | `intelligence/memory.service.ts` | Curto (resumo progressivo), longo (fatos/eventos), operacional (próximo passo, tarefas, compromissos), retenção |
| Customer Intelligence | `intelligence/profile.service.ts`, `engines/profile-policy.ts` | Perfil por contato, fatos com origem/confiança/status, histórico de extrações, sync com CRM, LGPD |
| Action Engine | `agent-tools.service.ts`, `catalogo.ts` | 19 ferramentas tipadas, permissões, aprovação humana, timeout, log por execução, auditoria |
| Follow-up Intelligence | `followup/followup.service.ts`, `engines/followup-policy.ts` | 8 estratégias, escolha por contexto, janela/fuso/dias, parada, geração contextual, intervenção humana |
| Learning & Evaluation | `learning/*`, `evaluation/*`, `engines/evaluation-scoring.ts` | Eventos, padrões, propostas, avaliação de regressão com juiz, aplicação controlada |
| Analytics | `analytics/agent-analytics.service.ts` | Dashboard do tenant, painel do agente, por versão (alarme "piorou"), logs |
| Simulator | `simulator/simulator.service.ts` | Mesmo core em modo simulação, personas, histórico anterior, cliente automático, trace |
| Versioning | `versioning/versioning.service.ts` | Snapshot imutável, publicação com gate de regressão, diff, rollback |

## 3. Decisões e por quê

1. **Configuração em JSONB validado por Zod**, não 40 colunas: a estrutura evolui sem migração; colunas ficam para o que é filtrado/indexado. Leitura tolerante: seção inválida cai no padrão sem derrubar o atendimento.
2. **Rascunho × versão publicada.** A linha `agents` é o rascunho; publicar congela um snapshot e o runtime usa o snapshot. Agente legado (sem versão) continua usando a linha viva: compatibilidade com dados existentes.
3. **Análise por structured outputs**, não `tool_choice` forçado (Opus/Sonnet 5.5 recusam com 400; skill `claude-api`). Fallback determinístico sempre disponível.
4. **Fragmentação em duas camadas**: o modelo separa ideias por parágrafo (semântica) e o motor garante limites (determinístico). Função pura, testada com o exemplo da especificação.
5. **Fila de entrega com verdade no Postgres.** O BullMQ só carrega o id do bloco (jobId determinístico). Cada bloco agenda o próximo depois de gravado: ordem garantida sem worker dormindo. Aceite incerto nunca é reenviado.
6. **Ações por regra usam a ferramenta equivalente**: uma regra nunca tem mais poder que a ferramenta (mesma allowlist, validação, aprovação e auditoria).
7. **Aprendizado não reescreve o agente sozinho.** Patch de proposta só pode tocar `comportamento`, regras novas e gatilhos de consulta; aplicação exige avaliação de regressão + aprovação humana. Base de conhecimento recebe só resposta escrita por humano.
8. **Busca lexical do agente com OR ranqueado** (`agent_tsquery_or`): pergunta em linguagem natural raramente tem todos os termos no documento. As funções originais do RAG não mudaram.
9. **Sem tabela de agregados de analytics**: consultas indexadas sobre as tabelas operacionais respondem em ms no volume atual e não divergem da operação; rollup diário entra sem mudar o contrato.
10. **Upload de arquivo em JSON base64** com limite de 22 MB só na rota de conhecimento: o proxy autenticado do Next repassa texto; multipart exigiria mudar o proxy compartilhado.

## 4. Segurança

- Tenant nunca vem do LLM nem do browser: JWT → `withTenant()` → RLS FORCE. 16 tabelas novas com policy e gatilho de referência cruzada. Teste: `db/034_agent_intelligence_isolation_test.sql`.
- Prompt injection: regras fixas antes de qualquer conteúdo configurável; mensagens, trechos da base e dados do CRM entram marcados como dados (`<documento>`, `<perfil_do_contato>`…); nenhum conteúdo recuperado vira instrução.
- Ferramentas: Zod estrito (argumento desconhecido = recusa), alcance de UM contato (o da conversa), ids de tarefa/oportunidade verificados como do contato, workflows e etapas por allowlist, aprovação humana configurável, timeout, log e `audit_logs` com `actor_type='nyro'`.
- Custo e loops: orçamento por conversa e por dia, limite de respostas por conversa, no máximo 5 voltas de ferramenta, tentativas com backoff só para erro retentável, circuit breaker do provedor.
- URL de conhecimento: proteção SSRF (resolve DNS e recusa rede interna em cada redirecionamento).
- LGPD: retenção de memória configurável com expiração automática; exclusão da inteligência derivada por contato; evidências de aprendizado minimizadas (e-mail, telefone, CPF mascarados); excluir o contato apaga tudo por cascata.
- Nada simulado em produção: sem chave de IA o agente transfere com o motivo; sem chave de embedding a base indexa lexical e avisa; fora de produção o envio externo fica travado (`bloqueado_dev`).

## 5. API (prefixo `/v1/agents`)

Gestão: `GET catalogo`, `GET dashboard`, `GET /`, `POST /`, `GET :id`, `PATCH :id`, `POST :id/status`, `POST :id/duplicar`, `DELETE :id`, `GET arquivados`, `GET|POST intencoes`, `DELETE intencoes/:id`, `POST personalidades`, `POST fragmentar-previa`.
Conhecimento: `GET|POST :id/conhecimento`, `PATCH|DELETE :id/conhecimento/:fonte`, `POST :id/conhecimento/:fonte/reprocessar`, `GET :id/conhecimento/:fonte/conteudo`, `GET :id/conhecimento-disponivel`, `POST :id/conhecimento-vincular`, `POST :id/conhecimento-testar`.
Memória/perfil: `GET|POST :id/memorias`, `PATCH|DELETE memorias/:id`, `GET perfis/:contato`, `POST perfis/:contato/fatos/:campo`, `POST perfis/:contato/conversao`, `DELETE perfis/:contato`.
Ações: `GET :id/ferramentas`, `GET aprovacoes`, `POST ferramentas/:exec/aprovar|rejeitar`, `GET :id/entregas`.
Follow-up: `GET :id/followups/regras`, `PATCH :id/followups/regras/:estrategia`, `GET :id/followups`, `POST :id/followups/iniciar`, `POST followups/:id/cancelar|reagendar`.
Qualidade: `GET :id/aprendizado`, `GET :id/aprendizado/eventos`, `POST :id/aprendizado/analisar`, `POST :id/feedback`, `GET :id/propostas`, `POST propostas/:id/aprovar|rejeitar`, `GET|POST :id/cenarios`, `PATCH|DELETE :id/cenarios/:id`, `GET|POST :id/avaliacoes`, `GET avaliacoes/:id`.
Versões: `GET :id/versoes`, `GET :id/versoes-diff`, `GET :id/versoes/:v`, `POST :id/publicar`, `POST :id/versoes/:v/restaurar`.
Simulador: `GET simulador/personas`, `GET|POST :id/simulacoes`, `GET|DELETE simulacoes/:id`, `POST simulacoes/:id/turno|cliente|cenario`.
Operação: `GET :id/analytics`, `GET :id/logs`.

## 6. Como validar

```bash
# unitário + integração (API)
cd apps/api && npx jest && npx tsc --noEmit
# isolamento multi-tenant (Postgres QA)
docker exec -i orvyn-qa-pg psql -U postgres -d orvyn_qa -v ON_ERROR_STOP=1 < db/034_agent_intelligence_isolation_test.sql
# E2E real (API :4020 + worker com ANTHROPIC_BASE_URL do stub)
node scripts/qa/agent-llm-stub.mjs &
QA_API=http://localhost:4020/v1 node scripts/qa/agent-e2e.mjs   # evidência: docs/ai-agent-e2e-results.json
```

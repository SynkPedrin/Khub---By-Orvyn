# KHUB Agent Intelligence — status de implementação

> Checkpoint de trabalho (atualizado a cada etapa). Arquitetura: `docs/AI_AGENT_ARCHITECTURE.md`.

## Estado em 2026-11-08

### Backend (apps/api/src/agents) — CONCLUÍDO e validado
- Migração `db/034_agent_intelligence.sql` (16 tabelas + colunas em `agents`, `agent_runs`, `rag_documents`; RLS FORCE; gatilhos `tenant_reference`; `agent_rag_search_hybrid/lexical` com filtro por documento dentro do WHERE; `agent_tsquery_or`). Aditiva, idempotente, rollback no cabeçalho.
- Teste de isolamento `db/034_agent_intelligence_isolation_test.sql` — PASS no Postgres QA (16 tabelas, escrita/referência cruzada, busca).
- `db/002_isolation_test.sql` — PASS (sem regressão).
- Jest API: todas as suítes passando (agentes: engines, core, runtime, Action Engine, fila, extração, versões, aprendizado).
- `tsc --noEmit` e `nest build` verdes.
- E2E real (`scripts/qa/agent-e2e.mjs` + stub `scripts/qa/agent-llm-stub.mjs`): **51/51 PASS** — evidência `docs/ai-agent-e2e-results.json`.

### Frontend (apps/web/app/(app)/agentes, components/agents, lib/agents.ts)
- Em andamento.

### Dependências externas (não são "concluído")
- `ANTHROPIC_API_KEY` real: sem ela, análise cai na heurística e o agente transfere para humano com motivo explícito.
- `VOYAGE_API_KEY`: sem ela, conhecimento indexa só lexical (reindexar depois com "Reprocessar").
- WhatsApp real (Evolution/Stevo + `STEVO_TEST_NUMBER` fora de produção).

### Pendências conhecidas
- Banco de DEV (5432) não tem a migração 034: NÃO reiniciar a API/worker de dev com o `dist` novo antes de aplicar a 034 lá (decisão do usuário).

### Próxima tarefa exata
- Implementar `apps/web/lib/agents.ts` (contratos novos) e as telas em `app/(app)/agentes/**`.

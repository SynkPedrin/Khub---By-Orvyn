# BRIEF MESTRE — Finalização do Orvyn (Claude Code)

> Contrato de operação + plano faseado. **Uma sprint por sessão.** A Seção 7 é a primeira mensagem de cada sessão. Referenciado pelo `CLAUDE.md` da raiz.

---

## 0. MISSÃO

Finalizar **100% do código** do Orvyn. Objetivo terminal:

> **Levar o produto ao estado em que a única coisa que falta para qualquer funcionalidade rodar em produção é plugar credenciais/APIs externas — nunca escrever código.**

Todo módulo, conector e fluxo **implementado e testado**. Onde a credencial não existe, o código **degrada com elegância** (nunca quebra), sinalizando qual variável destrava o modo real. Ver **Seção 2**.

---

## 1. CONTRATO DE OPERAÇÃO (inegociável)

1. **Doc-first.** Ler nesta ordem: [[PRD]], [[Arquitetura]], [[Banco]], [[APIs]], [[RegrasNegocio]], [[Tasks]], [[Bugs]], [[Sprint]]. Depois inspecionar o código real (`apps/web`, `apps/api`, `packages/*`). **Não presumir — verificar.**
2. **Gap analysis antes de codar.** Diff PRD/Tasks × código → escrever `Sprint.md` (objetivo único + tasks + critérios de aceite). Só então implementar.
3. **ADRs.** Decisão estrutural (tabela, serviço, contrato) → ADR em `Arquitetura.md`: contexto, opções, escolha, consequências.
4. **Nunca quebre o que funciona.** Testes verdes são contrato: **estender**, nunca deletar/afrouxar. Auth, RLS e CRM Core operam — não refatorar sem ADR.
5. **Atualizar o cérebro ao terminar** (Tasks/Sprint/Bugs). Código nunca diverge da doc.
6. **Uma sprint por sessão.** Ao fim: **parar e reportar** (feito, testes, gated, o que plugar). Não iniciar a próxima sem confirmação.
7. **Segredos nunca no código.** Env + `.env.example`. Ver Seção 2.

---

## 2. PRINCÍPIO DE GATING POR CREDENCIAL — *o mecanismo que faz "só faltar a API"*

Aplicar a **toda** integração de terceiro (STEVO/WhatsApp, Meta, Google, TikTok, Stripe, Voyage, Anthropic, SMTP/Gmail, OAuth social):

- **Regra 1 — Código completo, chamada externa isolada.** Módulo inteiro implementado (rotas, serviço, DTOs, persistência, UI). Só a chamada externa depende da credencial, atrás de **um** ponto de checagem.
- **Regra 2 — Config centralizada e tipada.** `ConfigService` com `isConfigured(provider)` e `missingVars(provider)`, env validado (zod) no boot. **Nenhum módulo lê `process.env` solto.**
- **Regra 3 — Degradação, nunca crash.**
  - API responde **`501`** (ou 409) com corpo padrão `{ status: "config_required", provider, missing: ["STEVO_API_URL"] }`.
  - Havendo fallback funcional (RAG → BM25 sem Voyage), ele roda e loga `warn`. Nunca feature "morta e silenciosa".
  - UI renderiza **"Conectar/Configurar {provider}"** — nunca botão que dá 500.
- **Regra 4 — Modo sandbox/mock demonstrável.** O dado percorre o sistema end-to-end sem credencial real; só a entrega externa fica pendente.
- **Regra 5 — Fonte única de verdade.** Manter `docs/ENV.md` + `.env.example`: variável, o que destrava, módulo consumidor, `[GATED]` ou `[ATIVO]`.

> **Teste-canário do gating:** subir a app com `.env` **sem credenciais de terceiros**. Nada crasha no boot; toda rota externa retorna `config_required`; a UI mostra cards de "conectar". Se passa, a missão está estruturalmente garantida.

---

## 3. INVARIANTES TÉCNICAS

- **Multi-tenant + RLS.** Toda tabela de negócio com `tenant_id`; **toda tabela nova exige teste de isolamento cross-tenant** (inclui namespaces de RAG).
- **A Nyro age só pelas mesmas APIs/permissões de um usuário**, com `actor: "nyro"` no audit. Nenhuma escrita direta da IA no banco.
- **Idempotência** em webhooks/workers (dedupe por evento); **retry** exponencial + dead-letter.
- **TS estrito** (sem `any` novo), DTOs validados, erros **RFC 7807 + correlation-id**.
- **Contrato de conector plugável:** novos conectores (Google, TikTok, Stripe) implementam a **mesma interface** do Meta (`auth`, `sync`, `webhooks`, `actions`).

---

## 4. DEFINITION OF DONE (task e sprint)

- [ ] Código seguindo o contrato de conector/módulo existente.
- [ ] Suíte existente **100% verde**; novos testes cobrem feliz, erro e `config_required`.
- [ ] Teste de isolamento RLS para toda tabela nova.
- [ ] Degradação por credencial validada (canário da Seção 2).
- [ ] `docs/ENV.md` + `.env.example` atualizados.
- [ ] `Tasks.md`, `Sprint.md`, `Bugs.md` atualizados; ADR se houve decisão estrutural.
- [ ] Nenhum segredo no diff. `typecheck` + `lint` limpos.

---

## 5. PLANO FASEADO

- **Sprint 0 — Desbloqueio e quick wins:** aceite de convite (`/signup?invite=`), WhatsApp entrega real (gated), BUG-004 (Cmd+K busca CRM), AuditInterceptor (toda mutação), sino de notificações real.
- **Sprint D1 — Fechar o CRM (F2):** perfil 360, editar/excluir contato, criar/editar negócio pela UI, empresas/tarefas/notas, paginação por cursor, **Meta lead → contato** (page_id ↔ tenant).
- **Sprint D2 — Realtime:** WebSocket (inbox, Kanban, automação ao vivo), auth do socket por tenant, reconexão.
- **Sprint E — Automações:** engine BullMQ, estado por run, retries/fallback/DLQ, logs nó-a-nó, **15 nós**, automações dos 3 templates, versionamento.
- **Sprint F — Nyro IA (gated `ANTHROPIC_API_KEY`):** orquestrador multi-agente, tools tipadas via API, memória 3 níveis, human-in-the-loop, guardrails CFM/OAB, `ai_usage_events`, chat SSE.
- **Sprint B — Google Ads + TikTok Ads:** mesmo contrato do Meta; OAuth vault por tenant, refresh, saúde da conexão.
- **Sprint C — Stripe/Billing:** checkout, assinaturas, faturas, webhooks idempotentes, créditos de IA por plano, cobrança a partir do funil.
- **Sprint G — Analytics + Hardening do RAG:** `/v1/analytics/kpis` (materialized views), contextualizer, reranker cross-encoder, guardrails, ingestão via BullMQ, insight nível-ad.
- **Sprint H — Plataforma/Produção:** CI/CD, `packages/ui`, rate limit por tenant, Sentry+OTel, rotação de segredos p/ vault, PITR, pentest.

---

## 6. O QUE **NÃO** FAZER

Não refatorar auth/RLS/CRM Core que funcionam (só com ADR) · não afrouxar/deletar testes · não construir fora do PRD · não hardcodar credencial · não deixar chamada externa sem gating · **não iniciar a próxima sprint sem reportar e receber confirmação**.

---

## 7. PRIMEIRA MENSAGEM DE CADA SESSÃO

```
Você é o engenheiro full-stack do Orvyn. Leia o Brief-Finalizacao.md e, na ordem,
o PRD.md, Arquitetura.md, Banco.md, APIs.md, RegrasNegocio.md, Tasks.md, Bugs.md e Sprint.md.
Depois inspecione apps/web, apps/api e packages/*.

NÃO escreva código ainda. Primeiro me entregue:
1) Gap analysis: o que já existe no código vs. o previsto para a Sprint {X}.
2) O Sprint.md proposto: objetivo único, tasks e critérios de aceite.
3) Riscos e qualquer decisão estrutural (ADR) que a sprint exige.

Aguarde meu OK. Só então implemente, seguindo o Contrato de Operação (Seção 1),
o Princípio de Gating por Credencial (Seção 2), as Invariantes (Seção 3) e a
Definition of Done (Seção 4). Ao terminar, atualize o cérebro e PARE para reporte.
```

## 8. TEMPLATE DE KICKOFF POR SPRINT

```
Sprint alvo: {Sprint 0 | D1 | D2 | E | F | B | C | G | H}
Objetivo único desta sessão: {…}
Fora de escopo hoje: {…}
Credenciais que EU já tenho para esta sprint: {STEVO_API_KEY, …}
Credenciais que ainda NÃO tenho (devem ficar gated): {STEVO_API_URL, …}
Definition of Done adicional específica: {…}
```

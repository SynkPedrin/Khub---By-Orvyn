# Bugs — Orvyn

> Reprodução, severidade, status. Alimenta a triagem da sprint ([[Sprint]]). Toda correção: causa raiz + verificar se existe em outros pontos + teste de regressão.

Severidade: `S0` catastrófico (ex.: vazamento entre tenants) · `S1` crítico · `S2` maior · `S3` menor.
Status: `aberto` · `em correção` · `corrigido` · `não reproduz`.

---

## Abertos

### BUG-001 — `retrieval.service.ts`: `tenant_id` interpolado em string no `SET LOCAL` (risco de SQL injection)
- Severidade: S1 (S0 se `tenantId` puder vir de fonte não confiável)
- Status: **corrigido** (R1.4). O `RetrievalService` implementado usa `PrismaService.withTenant` (UUID validado + `set_config(...,$1,...)` parametrizado); o padrão vulnerável do arquivo de referência não foi para o código. Regressão coberta por `retrieval.service.spec.ts` (tenant sempre da sessão).
- Ambiente: código de referência fornecido (ainda não wired)
- Reprodução: `tx.$executeRawUnsafe(\`SET LOCAL app.current_tenant_id = '${ctx.tenantId}'\`)` — interpolação direta. Idem `SET LOCAL hnsw.ef_search` (constante, ok) e `EmbeddingsService.toSqlVector`.
- Esperado: `tenantId` validado como UUID **antes** de qualquer uso; preferir `set_config('app.current_tenant_id', $1, true)` parametrizado em vez de interpolar. Vetor: garantir que só contém números/`,`/`.`/`-`/`e`.
- Causa raiz: uso de `$executeRawUnsafe`/`$queryRawUnsafe` com template string.
- Existe em outros pontos?: `logQuery` usa `$executeRawUnsafe` mas com parâmetros posicionais (`$1..$7`) — ok. O ponto crítico é o `SET LOCAL` e o literal de vetor.
- Correção + teste de regressão: validar UUID (zod/regex) na borda; teste unitário com `tenantId` malicioso deve lançar antes de tocar o banco.
- **Padrão correto já implementado** em `apps/api/src/prisma/prisma.service.ts` (`withTenant`): valida UUID por regex e usa `set_config('app.current_tenant_id', $1, true)` **parametrizado**. Ao integrar o `retrieval.service.ts` fornecido em R1.4, substituir o `SET LOCAL ... '${tenantId}'` por este helper.

### BUG-007 — `rag_search_hybrid` nunca resolvia via API (42883: function does not exist)
- Severidade: **S1** (a busca do RAG estava quebrada em produção-real, embora "verde" nos testes)
- Status: **corrigido** (Sprint G)
- Reprodução: `POST /v1/rag/search` → 500 `Raw query failed. Code: 42883 — function rag_search_hybrid(vector, text, text, unknown, text[], bigint, bigint, bigint) does not exist`.
- **Causa raiz:** o driver do Prisma envia números JS como **bigint (int8)** e `null` como **unknown**; a função é `(vector, text, text, text, text[], int, int, int)`. O Postgres **não faz downcast** na resolução de função → nenhuma assinatura casa.
- **Por que passou despercebido:** os unit tests mockam o Prisma (nunca tocam o Postgres) e o SQL foi validado direto no `psql` (onde os literais já vêm com o tipo certo). O bug só aparece na junção dos dois.
- Correção: casts explícitos no `$queryRawUnsafe` (`$1::vector, $4::text, $6::int…`) em `retrieval.service.ts`.
- Regressão: teste `BUG-007: SQL leva casts explícitos` em `retrieval.service.spec.ts`.
- **Lição:** unit test com Prisma mockado não prova integração — vale um teste de integração real do retrieval (pendente).

### BUG-008 — Voyage: chave sem método de pagamento → 3 RPM / 10K TPM
- Severidade: S2 (operacional)
- Status: aberto — **ação do operador**
- Sintoma: buscas seguidas retornam `Voyage 429: "You have not yet added your payment method… reduced rate limits of 3 RPM and 10K TPM"`.
- Impacto: backfill (1 request) passou; a busca ao vivo estoura se houver >3 queries novas/min. O cache (TTL 1h) e o fallback BM25 amortecem, mas produção exige billing na Voyage.

### BUG-003 — Inbox: botão de enviar sob o FAB da Nyro (z-index) e Enter não envia
- Severidade: S2 (usabilidade)
- Status: aberto — corrigir na FASE 3 (Inbox real)
- Origem: QA do usuário. O `NyroDock` (FAB, `fixed bottom-5 right-5 z-40`) cobre o botão de enviar do `/inbox`. Além disso o envio não está implementado (Enter/click não disparam) — é fachada até `POST /v1/messages`.
- Correção: (a) quick-fix de layout — subir o input de envio / reposicionar o FAB ou reduzir z-index quando no inbox; (b) implementar envio real (FASE 3). Sugestão da Nyro é estática (mesmo texto p/ toda conversa) — ligar na IA (FASE 5).

### BUG-004 — Busca global (Cmd+K) não pesquisa contatos/negócios; "Nada encontrado" para termos reais
- Severidade: S2
- Status: aberto — FASE 2 (endpoint de busca) 
- Origem: QA. O `CommandBar` só busca navegação + conhecimento (via `/api/cerebro`); não consulta CRM. Digitar "Marina" (contato real) → "Nada encontrado".
- Correção: endpoint `GET /v1/crm/search?q=` (contatos/negócios/conversas) + ligar no CommandBar. O mesmo campo de digitação instável está relacionado ao BUG-005.

### BUG-005 — Dev server derruba com `Cannot find module './352.js'`
- Severidade: S2 (ambiente/DX, não produção)
- Status: mitigado / processo
- Origem: QA (e reproduzido nesta sessão). **Causa raiz:** rodar `next build` (produção) enquanto o `next dev` está ativo — ambos usam o mesmo `.next/`, corrompendo os chunks do dev. Não é a digitação em si.
- Correção/mitigação: não rodar `build` com o `dev` ligado; ao acontecer, `rm -rf apps/web/.next` e reiniciar o dev. Para produção usar `next start` (não afetado). Regra p/ CI/scripts: nunca buildar contra o dir de dev.

### BUG-006 — Vários controles são fachada (sem ação)
- Severidade: S3 (esperado — fora de fase)
- Status: conhecido, documentado em [[Estado-do-Sistema]]
- Origem: QA. Sem ação: "Novo negócio" (sem modal), clique no card do deal, clique na linha de contato (perfil 360), "Usar"/telefone/"..." no inbox, sino de notificações, "Meu perfil"/"Configurações", "Ativar"/"Priorizar leads" (Insights). São escopo de **FASE 2** (CRM completo/perfil 360/criar-editar negócio), **F3/F5** (Nyro/notificações). Não são regressões — são telas ainda não construídas.

### BUG-002 — `nyro_guardrail_hits` sem RLS no schema fornecido
- Severidade: S2
- Status: mitigado nesta sessão
- Reprodução: `001_rag_schema.sql` habilita RLS em documents/chunks/queries/feedback, mas **não** em `nyro_guardrail_hits` (que tem `tenant_id`).
- Correção: RLS + policy adicionadas em `db/001a_rls_harden.sql`. Manter alinhado se o schema base mudar.

---

## Template de registro

```
### BUG-000 — Título curto
- Severidade: S0|S1|S2|S3
- Status: aberto
- Ambiente: local|staging|prod
- Reprodução: passos numerados
- Esperado / Obtido:
- Causa raiz:
- Existe em outros pontos?:
- Correção + teste de regressão:
```

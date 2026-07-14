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

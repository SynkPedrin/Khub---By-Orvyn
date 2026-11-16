# ALTERAÇÕES IMPLEMENTADAS — Operação Ritinha

> Nenhuma alteração de código, configuração ou dado de produção até aqui.

## 2026-11-16 (Fase Zero — somente leitura)

- Branch criada: `feat/ritinha-avec-go-live` (de `hardening/fase-0`).
- Scripts novos (read-only, no repo, não executam escrita):
  - `apps/api/scripts/operar/auditar-ritinha-api.mjs` — auditoria da produção pela API oficial (GETs).
  - `apps/api/scripts/operar/auditar-neon.mjs` + `auditar-neon.sql` — contagens read-only no Neon.
- Documentação: `docs/ritinha/*` (esta pasta).

**Produção: 0 escritas, 0 disparos, 0 aprovações solicitadas ou consumidas.**

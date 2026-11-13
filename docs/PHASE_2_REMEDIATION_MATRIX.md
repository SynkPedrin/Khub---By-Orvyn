# KHUB Revenue OS — Phase 2 remediation matrix

## Mensageria

| Suite | Testes | Classificação | Root cause | Fix |
|---|---:|---|---|---|
| `crm/messaging/messages.service.spec.ts` | 5 | `OUTDATED_TEST_DOUBLE` | O double não refletia `integration.findFirst`, métodos de idempotência, atualização de contato e cancelamento de automações dentro de `withTenant`. | Atualizado o double com filtros tenant-scoped e operações Prisma usadas em produção. |
| `crm/messaging/messages.service.spec.ts` | 1 | `OUTDATED_EXPECTATION` | Erro genérico do provider não prova não-entrega; o código classifica como `unknown` para evitar duplicidade comercial. | Expectativa ajustada para `unknown` + `provider_acceptance_unknown`. |
| `crm/messaging/messages.service.spec.ts` | 7 | `PASS_AFTER_FIX` | Inbound, associação de contato, deduplicação por `provider_message_id`, eventos e isolamento tenant. | Nenhuma alteração de produção. |

## Automações

| Suite | Testes | Classificação | Root cause | Fix |
|---|---:|---|---|---|
| `automations/runs.service.spec.ts` | 15 | `OUTDATED_TEST_DOUBLE` | O double não tinha `startedAt`/`scheduledAt`, embora o worker real persista e use esses campos. | Datas determinísticas adicionadas ao fixture. |
| `automations/janela.spec.ts` | 9 | `OUTDATED_TEST_DOUBLE` | Fixtures sobrescritos não implementavam `updateMany`/`findUnique`, necessários ao claim e ao enfileiramento tenant-scoped. | Métodos adicionados aos doubles; produção não foi relaxada. |

## Ainda pendente

- Meta Lead Ads: classificar a expectativa de idempotência e validar mapping/tenant.
- Convites: corrigir fixtures de identidade/senha e confirmar regras de aceitação entre tenants.
- Rodar a suíte completa da API após essas duas áreas.
- Implementar a migração das telas novas de demo para fontes reais ou estados vazios honestos.

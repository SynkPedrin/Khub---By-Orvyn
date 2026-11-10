# Base de Conhecimento da Nyro (corpus do RAG)

> Corpus inicial que alimenta o RAG por herança **global → nicho → subespecialidade → tenant** ([[RAG/RAG]] §1). Cada arquivo aqui vira um `rag_document` na ingestão (script em `apps/api/scripts/seed-rag.mjs`).

## ⚠️ Regra de curadoria (nicho regulado)
Este corpus é **ponto de partida curável**, não verdade jurídica/médica final. Referências legais citadas são **fatos públicos verificáveis** (número/ano da lei + link oficial). **Nada de texto de lei transcrito de memória, nem interpretação como aconselhamento.** Onde há incerteza, está marcado `⚠️ CONFIRMAR NA FONTE`. A operação (jurídico/contábil/médico) valida e expande — é o feedback loop do RAG ([[RAG/RAG]] §6.1) e o golden set ([[Tasks]] R3.1).

A Nyro **nunca** dá diagnóstico médico nem promete resultado jurídico ([[RegrasNegocio]] §3). Guardrails CFM/OAB em duas camadas (prompt + validador pós-resposta).

## Mapa do corpus

| Escopo | Pasta | Conteúdo |
|---|---|---|
| `global` | `global/` | Vendas/SDR, copy, growth, boas práticas de CRM — comum a todos os nichos |
| `nicho` = medico | `medico/` | Áreas/subespecialidades, compliance CFM, operação de clínica |
| `nicho` = juridico | `juridico/` | Áreas do direito, marcos legais + links oficiais, compliance OAB |
| `nicho` = contabil | `contabil/` | Regimes, obrigações e prazos, compliance CFC |

## Como isso vira RAG de verdade
1. Suba a infra (Postgres+pgvector) e defina `VOYAGE_API_KEY` (ver `db/README.md` e `apps/api/.env.example`).
2. `node apps/api/scripts/seed-rag.mjs --dry-run` → mostra o plano de ingestão (funciona sem DB).
3. `node apps/api/scripts/seed-rag.mjs` → ingere cada arquivo via `POST /v1/rag/documents` (chunk → embed → pgvector).

## Fontes oficiais (links)
- Leis federais: [planalto.gov.br](https://www.planalto.gov.br/ccivil_03/)
- Medicina: [Conselho Federal de Medicina (CFM)](https://portal.cfm.org.br/)
- Advocacia: [OAB / CFOAB](https://www.oab.org.br/)
- Contabilidade: [Conselho Federal de Contabilidade (CFC)](https://cfc.org.br/) · [Receita Federal](https://www.gov.br/receitafederal/) · [eSocial](https://www.gov.br/esocial/) · [SPED](http://sped.rfb.gov.br/) · [Simples Nacional](https://www8.receita.fazenda.gov.br/SimplesNacional/)

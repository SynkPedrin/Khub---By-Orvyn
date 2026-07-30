# RAG.md — Especificação Mestre do RAG da Nyro IA (Orvyn)

> Fonte única de verdade do subsistema de conhecimento. O Claude Code deve ler este arquivo **antes** de escrever qualquer linha de código do módulo `rag`. Versão 1.0 — Julho/2026.
> Documento fornecido pelo product owner e integrado ao cérebro. Ver [[PRD]] §6 · [[Arquitetura]] · [[Banco]] · [[RegrasNegocio]] · [[Tasks]].

---

## 1. Objetivo

Dar à Nyro IA conhecimento **confiável, rastreável e isolado por tenant**, em quatro níveis de herança:

```
GLOBAL (vendas, copy, growth, CRM)
  └── NICHO (medicina, jurídico, contábil, agência)
        └── SUBESPECIALIDADE (neurologia, advogado previdenciário, fiscal...)
              └── TENANT (documentos do cliente: tabela de preços, protocolos, contratos)
```

**Regra de ouro:** o RAG do cliente A jamais responde para o cliente B. Isolamento é garantido no banco (RLS), não apenas na aplicação.

## 2. Decisões de arquitetura (ADRs do RAG)

| #      | Decisão                                                                                                                                           | Alternativas descartadas        | Porquê                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADR-01 | **pgvector no mesmo Postgres** do CRM                                                                                                             | Pinecone, Qdrant, Weaviate      | Um banco só = RLS nativo, join com `tenants`, sem custo/latência extra, sem replicar a regra de isolamento em dois sistemas. Migrar depois é barato (embedding é reprodutível). |
| ADR-02 | **Busca híbrida** (vetorial + BM25/tsvector) fundida por **RRF**                                                                                  | Só vetorial                     | Jargão de nicho (CID, CNAE, "art. 1.729", "DCTFWeb", nome de procedimento) é literal: vetorial sozinho erra. Híbrido é o maior ganho de recall por real investido.              |
| ADR-03 | **Contextual Retrieval**: cada chunk recebe 1-2 frases de contexto geradas por Claude Haiku antes de ser embeddado                                | Chunk cru                       | Reduz falha de recuperação em ~35-50% em bases longas. Custo controlado com prompt caching (documento inteiro em cache).                                                        |
| ADR-04 | **Rerank obrigatório** (top-30 → top-8) com cross-encoder (Voyage `rerank-2.5`; fallback Cohere multilingual; fallback 2: Claude Haiku como juiz) | Sem rerank                      | A precisão no topo do contexto define a qualidade da resposta. Sem rerank o LLM afoga em ruído.                                                                                 |
| ADR-05 | **Embeddings `voyage-3-large` (1024 dims, multilíngue)** atrás de camada de abstração                                                             | OpenAI `text-embedding-3-large` | Bom custo/qualidade em PT-BR. `embedding_model` na tabela permite trocar com job de re-embed.                                                                                   |
| ADR-06 | **Herança por escopo com boost**, não por base separada                                                                                           | Uma tabela/índice por nicho     | Uma query só, filtro `escopo IN (...)`, com peso maior para tenant > sub > nicho > global.                                                                                      |
| ADR-07 | **Citação obrigatória** (`chunk_id`) em toda resposta da Nyro                                                                                     | Resposta livre                  | Rastreabilidade para auditoria, compliance CFM/OAB e feedback loop.                                                                                                             |
| ADR-08 | Ingestão **assíncrona (BullMQ)**, idempotente por `content_hash`                                                                                  | Ingestão síncrona no request    | PDF de 300 páginas não pode bloquear a API. Reprocesso não duplica chunk.                                                                                                       |

> Nota de integração: estes são ADRs do subsistema RAG (numeração própria ADR-01..08). Os ADRs do produto vivem em [[Arquitetura]] (ADR-0001..). O ADR-0004 do produto referencia este documento.

## 3. Componentes

```
[Upload / Playbooks / Crawler]
        │
        ▼
  POST /v1/rag/documents ──► S3/R2 ──► fila BullMQ (rag.ingest)
                                          │
             ┌────────────────────────────┴────────────────────────────┐
             │ 1. parse (pdf/docx/md/html/csv)                          │
             │ 2. clean + normalize + dedupe                            │
             │ 3. chunk estrutural-semântico (600 tok, 15% overlap)     │
             │ 4. contextualize (Claude Haiku + prompt cache)           │
             │ 5. embed em lote (input_type=document)                   │
             │ 6. upsert em rag_chunks (tsvector gerado no banco)       │
             └────────────────────────────┬────────────────────────────┘
                                          ▼
                             PostgreSQL + pgvector (HNSW + GIN)
                                          ▲
  Nyro (tool: search_knowledge) ──► RetrievalService
        │                              1. rewrite/multi-query (opcional)
        │                              2. vetorial top-50 (filtro NO WHERE)
        │                              3. BM25 top-50 (pt_unaccent)
        │                              4. RRF (k=60) + boost de escopo
        │                              5. rerank → top-8
        │                              6. cache Redis (TTL 1h)
        ▼
  Contexto citável → prompt do agente → resposta com [#chunk_id]
```

## 4. Modelo de dados

Verdade executável: `db/001_rag_schema.sql` (+ `000_foundation.sql`, `001a_rls_harden.sql`). Resumo:
- `rag_documents` — 1 linha por documento versionado (`escopo`, `nicho`, `subespecialidade`, `tenant_id`, `content_hash`, `versao`, `status`).
- `rag_chunks` — 1 linha por trecho (`embedding vector(1024)`, `tsv tsvector` gerado, `conteudo`, `contexto`, `metadados jsonb`).
- `rag_queries` — log de toda busca (query, filtros, latência, chunks) → alimenta eval e feedback loop.
- `rag_feedback` — 👍/👎 por resposta, ligado aos `chunk_ids` usados.
- `nyro_guardrail_hits` — toda vez que o validador bloqueou algo.

## 5. Parâmetros de referência (via env, tunáveis)

| Parâmetro | Default | Nota |
|---|---|---|
| `RAG_CHUNK_TOKENS` | 600 | 400-800. Menor p/ FAQ, maior p/ playbook. |
| `RAG_CHUNK_OVERLAP` | 0.15 | 15% |
| `RAG_TOPK_VECTOR` | 50 | antes da fusão |
| `RAG_TOPK_BM25` | 50 | antes da fusão |
| `RAG_RRF_K` | 60 | constante clássica |
| `RAG_TOPN_RERANK` | 8 | o que entra no prompt |
| `RAG_MIN_SCORE` | 0.35 | abaixo disso → declara lacuna |
| Boost de escopo | tenant 1.35 / sub 1.20 / nicho 1.10 / global 1.00 | multiplicador pós-RRF |

## 6. Regra anti-alucinação (não negociável)

Se, após o rerank, **nenhum chunk** passar de `RAG_MIN_SCORE`, a Nyro **não** responde com conhecimento paramétrico em tema de nicho, preço, prazo ou protocolo. Declara a lacuna e escala para humano. Ver `RAG-Guardrails.md` (a produzir em R2).

## 7. Custos (ordem de grandeza — dimensiona os créditos do plano)

- **Ingestão:** a contextualização domina (1 chamada Haiku por chunk, com o doc em cache). Base de nicho de ~500 páginas → ~1.500 chunks → poucos dólares → pago **uma vez** e amortizado entre todos os tenants do nicho.
- **Consulta:** 1 embed de query + 1 rerank + 4-6k tokens de contexto. É o custo recorrente → medir em créditos por tenant (módulo `billing`).
- Cache semântico corta 20-40% das consultas (FAQ de nicho se repete muito).

## 8. Fases (espelhadas em [[Tasks]] §RAG)

- **R0** — schema + RLS + teste de isolamento no CI (sem IA ainda). ← foco atual
- **R1** — ingestão MD/PDF + chunking + embeddings + busca híbrida + tool `search_knowledge`.
- **R2** — Contextual Retrieval + rerank + cache + citações + guardrails.
- **R3** — golden set + harness de avaliação no CI.
- **R4** — feedback loop com curadoria + upload self-service pelo tenant.

---

## 9. Documentos irmãos do pacote (a produzir)

O pacote referencia docs ainda **não fornecidos** — serão escritos ao entrar em cada fase:
- `RAG-Ingestao.md` (R1) · `RAG-Retrieval.md` (R1) · `RAG-Guardrails.md` (R2) · `RAG-Avaliacao.md` (R3).

> ⚠️ LACUNA: conteúdo desses 4 docs não foi fornecido. Não inventar; produzir com o product owner ao iniciar R1/R2/R3.

## 10. Dependências externas (config manual — necessárias a partir de R1/R2)
- **Voyage AI** (`voyage-3-large` embeddings, `rerank-2.5`) — API key.
- **Cohere** (rerank multilingual, fallback) — API key.
- **Anthropic** (Claude Haiku — contextualização ADR-03; verificar model id atual via skill `claude-api` ao implementar R2).
- **Redis** (cache + BullMQ) e **S3/R2** (binários de documentos).

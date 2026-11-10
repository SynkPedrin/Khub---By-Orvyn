# Camada Global do RAG — inteligência C-Level da Nyro

> Playbooks estratégicos atômicos (um framework por arquivo) no nível **`global`** da hierarquia `global → nicho → subespecialidade`. Origem: skills `cmo-architect` (marketing) e `coo-orchestrator` (operação) do C-Level Squad. Alimentam os papéis **Estrategista de Growth** e **Consultora de Operação** da Nyro ([[PRD]] §5).

## Estrutura
- `marketing/` — 6 frameworks (STP, Funil de Demanda, Go-to-Market, Arquitetura de Marca, Atribuição de Marketing, Pirâmide de Conteúdo).
- `operacao/` — 6 frameworks (OKR, Dashboards Operacionais, Design Organizacional, Mapeamento de Processos, Matriz de Alocação, Prontidão para Escalar).
- Cada arquivo tem **frontmatter** (`dominio`, `framework`, `scope_fit_min_plano`, `intencoes`, `comando_relacionado`, `persona_owner`) → vira `metadados` na ingestão.

## Ingestão (escopo global — fora do request path, invariante 2)
Bases compartilhadas são escritas por **script como `khub_service`**, nunca pela API (`khub_app`):
```bash
node apps/api/scripts/seed-global-rag.mjs | docker exec -i orvyn-postgres psql -U postgres -d orvyn -v ON_ERROR_STOP=1
```
O seeder parseia o frontmatter, faz chunk por seção `##`, e insere em `rag_documents`/`rag_chunks` com `escopo='global'`, `embedding=NULL`. **Busca por BM25 já funciona** (tsvector pt); o backfill dos vetores entra com `VOYAGE_API_KEY` (busca semântica, R2/R4.4).

## Recuperação (como a Nyro usa)
- Filtro: `escopo=global` + `metadados->>'dominio'` + `scope_fit_min_plano <= plano_da_conta` (não entrega estratégia de escala para conta Starter).
- Gate por intenção: recuperar só em turnos estratégicos/consultivos (`growth`, `consultoria_executiva`, `operacao`), não em SDR/agendamento — economiza token.
- Superfície no produto: **`/marketing`** (Central de Marketing) lista os frameworks; o chat da Nyro (F3) os recupera via `search_knowledge`.

> Estado: **12 docs / 73 chunks ingeridos** (escopo global) e buscáveis por BM25. Verificado: "como me posicionar" → STP; "lançar novo serviço" → Go-to-Market.

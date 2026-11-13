# KHUB Revenue OS — Revisão de Segurança

> Semana 1. Achados **verificados no código**, não presumidos. Cada item traz
> onde foi checado.

---

## Resumo

O sistema já chega a esta revisão acima da média para o estágio. A arquitetura
de isolamento e a de segurança da IA foram desenhadas corretamente desde o
início e não precisaram ser refeitas.

| Severidade | Abertos |
|---|---|
| Crítica | 0 |
| Alta | 1 |
| Média | 4 |
| Baixa | 3 |

Um risco **Alto** foi fechado nesta semana (vendor lock-in de IA).

---

## 1. Exposição de segredos — ✅ OK

| Verificação | Resultado |
|---|---|
| `.env*` no `.gitignore` | ✅ `.env`, `.env.*.local`, `.env*` |
| `.env` rastreado pelo git | ✅ nenhum — só `.env.example` |
| Segredo no histórico do git | ✅ nenhum `.env` real já foi commitado |
| `.env.example` com valor real | ✅ só placeholders (`CHANGE_ME`, `troque-por-...`) |
| Segredo em `NEXT_PUBLIC_*` | ✅ só `NEXT_PUBLIC_API_URL` e `NEXT_PUBLIC_KHUB_DEMO` |
| Frontend chamando LLM direto | ✅ nenhuma chamada a `api.anthropic.com`/`api.openai.com` |

Chave de IA nunca chega ao navegador: o frontend fala com `/api/*`, que faz
proxy server-side com cookie httpOnly.

---

## 2. Isolamento multi-tenant — ✅ OK

| Verificação | Resultado |
|---|---|
| RLS habilitada | ✅ 17 migrations com `ENABLE ROW LEVEL SECURITY` |
| `FORCE ROW LEVEL SECURITY` | ✅ presente — a role da app não escapa da policy |
| `BYPASSRLS` na role da aplicação | ✅ ausente |
| `SET LOCAL app.current_tenant_id` por transação | ✅ `PrismaService.withTenant` |
| Suite de teste de vazamento | ✅ `db/002_isolation_test.sql` |
| Tabelas novas (023) nascem com RLS | ✅ as 4 tabelas de campanha |
| `tenant_id` vindo do JWT, não de parâmetro | ✅ |
| `tenant_id` vindo de saída de modelo | ✅ nunca — vem da sessão |

---

## 3. Segurança da camada de IA — ✅ OK

| Controle | Onde |
|---|---|
| Tool set **fechado** (allowlist) | `nyro/tools.ts` — nome alucinado é recusado |
| Schema Zod por tool | `nyro/tools.ts` |
| Níveis de sensibilidade + aprovação humana | `Sensibilidade`, `NyroAction` |
| A IA não escreve no banco | toda tool → serviço do CRM, com RLS e auditoria |
| Anti prompt-injection | contexto entra em `<dados aviso="...">` |
| Guardrail pós-resposta | `nyro/guardrails.ts` + specs |
| Auditoria com `actor: 'nyro'` | `audit_logs` |
| Custo por execução | `ai_usage_events` (+ coluna `provedor`, nova) |
| Circuit breaker no provedor | `common/circuit-breaker.ts` |
| SQL gerado por modelo sendo executado | ✅ **não existe** |

---

## 4. Injeção de SQL — ✅ OK (com ressalva documentada)

`$queryRawUnsafe` é usado em 4 pontos, todos verificados:

| Local | Avaliação |
|---|---|
| `auth/jwt-auth.guard.ts:37` | placeholders parametrizados |
| `rag/ingestion.processor.ts:62,66` | `$1::uuid` parametrizado |
| `rag/retrieval.service.ts:121,140` | função SQL com `$1..$8` parametrizados |

O único valor interpolado como literal é o vetor de embedding, que passa por
`EmbeddingsService.toSqlVector()` — que **valida que todo componente é número
finito** antes de serializar (barreira registrada como BUG-001). Um valor não
numérico lança antes de chegar ao SQL.

---

## 5. Achados abertos

### 🔴 Alto

**S-1 · `permissions.guard.ts` não está commitado.**

O `PermissionsGuard` está registrado globalmente em `app.module.ts:36` como
`APP_GUARD`, mas o arquivo aparece como **não rastreado** no git.

- **Impacto:** um `git clone` limpo não compila (import de arquivo inexistente),
  e o RBAC não existe em nenhum ambiente que não seja a máquina do desenvolvedor.
- **Ação:** commitar o arquivo. É a correção mais barata e mais urgente desta lista.
- **Verificado em:** `git status --short apps/api/src/auth/permissions.guard.ts` → `??`

### 🟡 Médio

**S-2 · Sem `helmet` (cabeçalhos de segurança HTTP).**

`main.ts` configura CORS com allowlist e `credentials: true`, mas não define
`Content-Security-Policy`, `X-Frame-Options`, `Strict-Transport-Security` nem
`X-Content-Type-Options`.

- **Impacto:** superfície maior para clickjacking e XSS.
- **Ação:** `app.use(helmet())` com CSP ajustada ao frontend.
- **Verificado em:** `apps/api/src/main.ts`

**S-3 · Migrations sem registro de aplicação.**

São aplicadas por `psql` direto. Não há tabela de histórico dizendo o que já
rodou em cada ambiente.

- **Impacto:** divergência silenciosa entre ambientes; reaplicação acidental.
- **Ação:** tabela `schema_migrations` simples, ou adotar `prisma migrate`.

**S-4 · `apps/web` sem nenhum teste.**

29 suites, todas no backend.

- **Impacto:** regressão de autorização ou de vazamento de dado no frontend
  passa sem rede de proteção.
- **Ação:** testes de componente para o shell, os estados de dado e a fronteira
  do modo demo.

**S-5 · Modo demo depende de disciplina de ambiente.**

`NEXT_PUBLIC_KHUB_DEMO=1` em produção faria toda tela exibir dado fabricado.

- **Mitigação já existente:** a flag nunca liga sozinha, e com ela ativa **toda
  tela mostra o selo "Dados de demonstração"** — não é possível confundir sem
  ignorar um aviso visível.
- **Ação:** falhar o build de produção se a variável estiver ligada.

### 🟢 Baixo

**S-6 · `.DS_Store` versionado** em várias pastas. Ruído; sem impacto.

**S-7 · `tsconfig.tsbuildinfo` (152 KB) versionado** em `apps/web`.

**S-8 · Backups fora do repositório** (`_to_delete/`, `_backup-completo-antes-do-reset/`,
`_front-antes-de-reverter/`) na pasta-mãe. Podem conter `.env` antigos.
**Não foram tocados nesta execução** — remoção é decisão do operador. Vale
conferir se há credencial neles antes de compartilhar a pasta.

---

## 6. Fechado nesta semana

**✅ S-0 · Vendor lock-in de IA (era Alto).**

`AiService` e `NyroService` injetavam `AnthropicProvider` diretamente.
Indisponibilidade, mudança de preço ou de política do fornecedor atingiria o
produto inteiro sem caminho de escape.

**Correção:** interface `AIProvider` + registry + token de injeção. O domínio
agora depende do contrato. Segundo adaptador (OpenAI/Ollama) implementado para
provar que a abstração não é decorativa.

*Ressalva:* `NyroService` ainda usa `AnthropicProvider` direto — migração
pendente para a Semana 2. A abstração existe e é usada por `AiService` e pelo
motor de automações.

---

## 7. Itens não avaliados nesta passagem

Declarados abertamente para não darem falsa sensação de cobertura:

- Upload de arquivo (não há módulo de upload ainda).
- SSRF em webhooks de saída (o nó `webhook` do executor não foi auditado quanto
  a destino interno/metadata endpoint).
- CSRF (a API usa Bearer/JWT, mas os proxies do Next usam cookie — merece
  análise dedicada).
- Redirects inseguros.
- Rate limit por tenant sob carga real (o guard existe; os limites não foram
  testados com volume).
- Retenção e expurgo de dado pessoal (LGPD).

# ORVYN Revenue OS — Guia de Migração

> Como sair do ORVYN OS e chegar ao ORVYN Revenue OS sem perder dado, usuário
> ou funcionalidade.

---

## 1. Princípio

**PRESERVAR → REUTILIZAR → REFATORAR → EXPANDIR → e só então CRIAR.**

Nenhuma tabela foi derrubada. Nenhuma coluna foi renomeada. Nenhuma rota que
funcionava deixou de funcionar. Nenhum módulo testado foi removido.

---

## 2. Banco de dados

### O que foi feito

Uma única migration nova: **`db/023_revenue_os.sql`**, estritamente aditiva.

| Mudança | Tipo |
|---|---|
| `contacts`: `score`, `score_version`, `score_at`, `score_fatores`, `cargo`, `origem`, `localizacao`, `site`, `linkedin`, `owner_id`, `proxima_acao_at`, `proxima_acao_tipo` | colunas nullable |
| `contacts`: CHECK de faixa do score (0–100, NULL permitido) | constraint |
| `contacts`: índices por score e por próxima ação | índice |
| `campaigns`, `campaign_steps`, `campaign_metrics`, `campaign_enrollments` | tabelas novas |
| `ai_usage_events.provedor` | coluna nullable |
| `tenants.is_demo` | coluna com default |

### Aplicar

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/023_revenue_os.sql
```

A ordem de deploy é indiferente: nada nesta migration é exigido pelo código
anterior, e nada no código novo quebra sem ela (as telas novas dependem do modo
demo até haver dados reais).

### Rollback

A migration é aditiva, então o rollback é opcional. Se necessário:

```sql
BEGIN;
DROP TABLE IF EXISTS campaign_enrollments, campaign_metrics, campaign_steps, campaigns;
ALTER TABLE contacts DROP COLUMN IF EXISTS score, DROP COLUMN IF EXISTS score_version,
  DROP COLUMN IF EXISTS score_at, DROP COLUMN IF EXISTS score_fatores,
  DROP COLUMN IF EXISTS cargo, DROP COLUMN IF EXISTS origem,
  DROP COLUMN IF EXISTS localizacao, DROP COLUMN IF EXISTS site,
  DROP COLUMN IF EXISTS linkedin, DROP COLUMN IF EXISTS owner_id,
  DROP COLUMN IF EXISTS proxima_acao_at, DROP COLUMN IF EXISTS proxima_acao_tipo;
ALTER TABLE ai_usage_events DROP COLUMN IF EXISTS provedor;
ALTER TABLE tenants DROP COLUMN IF EXISTS is_demo;
COMMIT;
```

**Aviso:** o rollback apaga as campanhas criadas. Só execute se elas não
existirem ou não importarem.

### `schema.prisma`

Ainda **não** foi atualizado com as entidades novas. Isso é deliberado: as
campanhas ainda não têm serviço de backend, e adicionar models Prisma sem
consumidor cria código morto. Entra junto com o `CampaignsService` (Semana 2).

---

## 3. Rotas

### Mapa

| ORVYN OS | ORVYN Revenue OS | Estado |
|---|---|---|
| `/` | `/` | refatorado — Dashboard de Receita |
| `/contatos` | `/leads` | **ambas ativas** |
| `/contatos/[id]` | `/leads/[id]` | **ambas ativas** |
| `/pipeline` | `/pipeline` | refatorado |
| `/inbox` | `/conversas` | **ambas ativas** |
| `/automacoes` | `/automacoes` | reveste (herdou o design system) |
| — | `/campanhas` | **criado** |
| `/agenda` | `/agenda` | refatorado |
| `/analytics` | `/analytics` | expandido |
| `/nyro` | `/ia` | **ambas ativas** |
| `/configuracoes` | `/configuracoes` | reveste |
| `/empresas`, `/tarefas`, `/financeiro`, `/marketing`, `/conhecimento` | mantidas | preservadas |

### Por que NÃO há redirect

`/contatos`, `/inbox` e `/nyro` são telas que funcionam de verdade, ligadas à
API e ao banco. As novas (`/leads`, `/conversas`, `/ia`) ainda dependem do modo
demo para exibir conteúdo.

Redirecionar agora trocaria **funcionalidade real por vitrine** — o oposto do
que a migração deve fazer. As antigas seguem acessíveis por URL direta e já
herdaram a nova identidade visual.

Os redirects entram quando as telas novas tiverem paridade de dados reais. O
lugar para adicioná-los está marcado em `apps/web/next.config.mjs`.

---

## 4. Frontend

### Design system

`apps/web/app/globals.css` foi reescrito. Backup do arquivo anterior não é
necessário: ele está no histórico do git (`main @ 51edbf0`).

**Nomes de classe foram preservados** — `.card`, `.btn`, `.btn-primary`,
`.input`, `.glass`, `.crystal-edge`, `.scrollbar-thin`, `.prose-orvyn` e as
demais continuam existindo, redefinidas para a estética nova. As ~200 chamadas
existentes não foram tocadas e herdaram a identidade.

Classes decorativas do sistema antigo (`.crystal-*`, `.liquid-chrome`,
`.brand-mesh`, `.studio-bg`, `.frost`, `.fluid`) foram **neutralizadas**, não
removidas: remover quebraria as telas que ainda as referenciam.

### Componentes aposentados (ainda presentes)

`DynamicIsland`, `TopCenterLogo` — substituídos pela topbar única. Os arquivos
continuam no repositório e podem ser removidos quando nenhuma tela os importar.
Removê-los agora não traz benefício e arrisca quebrar import esquecido.

---

## 5. Camada de IA

### Antes

```ts
constructor(private readonly llm: AnthropicProvider) {}   // vendor lock-in
```

### Depois

```ts
constructor(@Inject(AI_PROVIDER) private readonly llm: AIProvider) {}
```

`AnthropicProvider` **continua exportado** pelo `AiModule` — `NyroService` ainda
o injeta diretamente e não foi tocado. Migrá-lo é trabalho de Semana 2, e fazer
as duas coisas na mesma passagem misturaria "extrair abstração" com "reescrever
o loop do agente".

### Trocar de provedor

```bash
AI_PROVIDER=anthropic   # padrão
AI_PROVIDER=openai      # OpenAI ou Ollama (via OPENAI_BASE_URL)
```

Nome desconhecido cai no padrão com aviso no log — derrubar a aplicação inteira
por um typo em variável de ambiente seria pior.

---

## 6. Compatibilidade verificada

| Item | Estado |
|---|---|
| Dados existentes | preservados — migration aditiva |
| Usuários e sessões | intocados — auth não foi alterado |
| Integrações ativas (Meta Ads, Stevo) | intocadas |
| URLs em uso | todas continuam respondendo |
| Variáveis de ambiente | nenhuma removida; novas são opcionais |
| Deploy (Vercel + Docker) | `next.config.mjs` e `Dockerfile` não alterados |
| Working tree do usuário | preservado — nenhuma alteração não commitada foi descartada |

---

## 7. Passo a passo para subir

```bash
# 1. dependências (nenhuma nova foi adicionada)
pnpm install

# 2. migration
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/023_revenue_os.sql

# 3. conferir isolamento de tenant
pnpm --filter @orvyn/api db:isolation-test

# 4. gates
pnpm typecheck && pnpm lint && pnpm build

# 5. subir
pnpm dev
```

Para ver a interface com densidade realista antes de haver dados:

```bash
echo "NEXT_PUBLIC_ORVYN_DEMO=1" >> apps/web/.env.local
```

O selo "Dados de demonstração" aparece em toda tela enquanto a flag estiver
ligada. **Não deixe essa variável em produção.**

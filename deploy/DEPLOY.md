# Deploy do KHUB (Neon + Render + Vercel)

Ordem: **1. Neon** (banco) → **2. Render** (API + fila) → **3. Vercel** (web). O código vem do GitHub `SynkPedrin/Khub---By-Orvyn` (branch `main`).

## 1. Neon: banco novo e vazio

1. No painel do Neon, abra o projeto do KHUB e copie a *connection string* do dono do banco (com `?sslmode=require`).
2. Na raiz do repositório, no Mac (o Docker precisa estar aberto se não houver `psql`):

   ```sh
   NEON_ADMIN_URL='postgresql://<dono>:<senha>@<host>/<banco>?sslmode=require' \
   KHUB_APP_PASSWORD='<senha forte>' \
   KHUB_SERVICE_PASSWORD='<outra senha forte>' \
   ./deploy/neon-init.sh
   ```

3. O script recusa rodar se o banco já tiver o schema, aplica `db/*.sql` em ordem, define as senhas, roda o teste de isolamento entre clientes e imprime a `DATABASE_URL` com o usuário `khub_app`.

> Se o Neon recusar `CREATE ROLE ... BYPASSRLS` (papel `khub_service`, usado só por funções internas de serviço), rode o passo no SQL Editor do Neon como dono do projeto. A API **nunca** usa esse papel.

## 1b. Copiar os seus dados do dev para a produção

Logo depois do passo 1, com o Docker aberto e o banco de dev (`orvyn-postgres`) no ar:

```sh
NEON_ADMIN_URL='<a mesma do passo 1>' \
SUBCONTAS='<nomes exatos das subcontas, separados por vírgula>' \
KHUB_SERVICE_PASSWORD='<a mesma do passo 1>' \
./deploy/copiar-dados-producao.sh
```

Copia as subcontas listadas em `SUBCONTAS` com tudo (contatos, conversas, mensagens, funis, negócios, agenda, automações, agentes de IA e conhecimento, integrações), a sua agência, o seu usuário master e os membros (login e senha iguais aos do dev) e a base de conhecimento global. Não copia fila de eventos, execuções em andamento nem sessões, para a produção não disparar nada antigo. Ao final, revalida todas as chaves estrangeiras. Testado de ponta a ponta num Postgres limpo: 9.462 linhas, contagens iguais às do dev.

> As integrações vêm cifradas: no Render, `INTEGRATIONS_ENCRYPTION_KEY` precisa ser **o mesmo valor do `apps/api/.env` do dev**. Leve também, do mesmo arquivo, as variáveis `STEVO_*` (WhatsApp) e `META_*`, se usadas.

## 2. Render: API + fila (plano gratuito)

1. No Render, **New → Blueprint** e escolha o repositório `SynkPedrin/Khub---By-Orvyn`. O `render.yaml` cria `khub-api` (Docker) e `khub-queue` (Redis).
2. Preencha as variáveis pedidas:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a URL impressa no passo 1 (usuário `khub_app`) |
   | `WEB_URL` | `https://app.kromads.com.br` |
   | `CORS_ORIGINS` | `https://app.kromads.com.br,https://orvyn-os.vercel.app` |
   | `INTEGRATIONS_ENCRYPTION_KEY` | 32 bytes aleatórios em base64 (`openssl rand -base64 32`) |
   | `SMTP_FROM` | remetente real, ex.: `KHUB <no-reply@seu-dominio>` (sem ela o padrão ainda é `no-reply@orvyn.app`) |
   | `KHUB_PROXY_SECRET` | o valor que está em `deploy/.env.render` (arquivo local, fora do git). O mesmo valor já está na Vercel; é o que separa o limite de taxa por visitante nas páginas públicas (formulários e agendamento) |
   | `ANTHROPIC_API_KEY` | a chave que está em `deploy/.env.render` (crédito promocional de US$ 100) |
   | `AI_PROVIDER` | `anthropic` |
   | `ANTHROPIC_MODEL_FORCE` | `claude-haiku-5-5` (toda chamada de IA usa o modelo mais barato: US$ 0,10 / 0,50 por milhão de tokens) |
   | `ANTHROPIC_EFFORT_MAX` | `low` (raciocínio curto; é cobrado como saída) |
   | `DISPAROS_APROVACAO_ACIMA`, `DISPAROS_LIMITE_DIARIO_WHATSAPP`, `DISPAROS_LIMITE_DIARIO_EMAIL` | opcionais (padrões 50, 300 e 2000) |

   O `JWT_SECRET` é gerado pelo próprio Render. As integrações (`ANTHROPIC_API_KEY`, `STEVO_*`/`EVOLUTION_*`, `META_*`, `STRIPE_*`, `SMTP_URL` ou `RESEND_API_KEY`, `S3_*`) são opcionais: sem a chave, o módulo responde `config_required` e a tela mostra "Conectar".

3. **Manual Deploy → Deploy latest commit** (o deploy automático está desligado de propósito).
4. Em **Settings → Custom Domains** do `khub-api`, adicione `api.kromads.com.br`. O Render mostra o destino do CNAME (algo como `khub-api.onrender.com`); crie esse CNAME no Registro.br (seção DNS abaixo). O serviço está pronto quando `GET https://<khub-api>.onrender.com/v1/ready` responde `{"status":"ready"}`.

> Gasto de IA: no Console da Anthropic (console.anthropic.com → Limits / Spend limits), defina um limite mensal do workspace (ex.: US$ 15/mês). Ao atingir o limite, a API recusa e os agentes passam a conversa para a equipe, sem deixar o cliente sem resposta.

> Plano gratuito: a instância dorme por inatividade (jobs e follow-ups param enquanto dorme) e o Redis gratuito não persiste a fila. Serve para validação online, não para atendimento 24 horas.

## 3. Vercel: web

1. Projeto Vercel `orvyn-os` (raiz `apps/web`). Variáveis de produção:

   | Variável | Valor |
   |---|---|
   | `KHUB_API_URL` | `https://api.kromads.com.br` (já configurada) |
   | `NEXT_PUBLIC_API_URL` | `https://api.kromads.com.br` (já configurada) |
   | `WEB_URL` | `https://app.kromads.com.br` (já configurada) |
   | `KHUB_PROXY_SECRET` | já configurada (mesmo valor do Render) |

2. Publicar: `vercel deploy --prod` a partir da cópia curada (sem `docs/` e sem o vault interno). O domínio `app.kromads.com.br` já está ligado ao projeto `orvyn-os`.

## DNS no Registro.br (kromads.com.br)

| Tipo | Nome | Valor |
|---|---|---|
| CNAME | `app` | `61c4280fc990366f.vercel-dns-017.com` |
| CNAME | `api` | o destino que o Render mostrar para `api.kromads.com.br` |

A Vercel emite o certificado HTTPS sozinha assim que o CNAME propagar.

## 4. Virada do WhatsApp (a produção assume)

1. Com a API no ar (`/v1/ready` = `ready`), desligue de vez o worker e a API do Mac.
2. Aponte o webhook da conta Stevo para a produção:

   ```sh
   cd apps/api && pnpm build && node --env-file=.env scripts/operar/stevo.mjs webhook --url https://api.kromads.com.br/v1/webhooks/stevo-api
   ```

   O comando grava o segredo novo no `.env` do dev: copie o `STEVO_WEBHOOK_SECRET` para o Render e faça um **Manual Deploy**.
3. Mande uma mensagem de teste para o número de cada cliente e confira na tela de conversas da produção.

Nunca deixe o worker do Mac e o da produção ligados ao mesmo tempo: os dois responderiam o mesmo cliente.

## Conferência rápida depois do deploy

- `/` abre a LP do KHUB; `/login` abre o login.
- `GET <api>/v1/ready` → `ready`.
- `/conhecimento` logado mostra só a base de conhecimento de produto (nunca PRD ou Bugs).

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

   O `JWT_SECRET` é gerado pelo próprio Render. As integrações (`ANTHROPIC_API_KEY`, `STEVO_*`/`EVOLUTION_*`, `META_*`, `STRIPE_*`, `SMTP_URL` ou `RESEND_API_KEY`, `S3_*`) são opcionais: sem a chave, o módulo responde `config_required` e a tela mostra "Conectar".

3. **Manual Deploy → Deploy latest commit** (o deploy automático está desligado de propósito).
4. Em **Settings → Custom Domains** do `khub-api`, adicione `api.kromads.com.br`. O Render mostra o destino do CNAME (algo como `khub-api.onrender.com`); crie esse CNAME no Registro.br (seção DNS abaixo). O serviço está pronto quando `GET https://<khub-api>.onrender.com/v1/ready` responde `{"status":"ready"}`.

> Plano gratuito: a instância dorme por inatividade (jobs e follow-ups param enquanto dorme) e o Redis gratuito não persiste a fila. Serve para validação online, não para atendimento 24 horas.

## 3. Vercel: web

1. Projeto Vercel `orvyn-os` (raiz `apps/web`). Variáveis de produção:

   | Variável | Valor |
   |---|---|
   | `KHUB_API_URL` | `https://api.kromads.com.br` (já configurada) |
   | `NEXT_PUBLIC_API_URL` | `https://api.kromads.com.br` (já configurada) |
   | `WEB_URL` | `https://app.kromads.com.br` (já configurada) |

2. Publicar: `vercel deploy --prod` a partir da cópia curada (sem `docs/` e sem o vault interno). O domínio `app.kromads.com.br` já está ligado ao projeto `orvyn-os`.

## DNS no Registro.br (kromads.com.br)

| Tipo | Nome | Valor |
|---|---|---|
| CNAME | `app` | `61c4280fc990366f.vercel-dns-017.com` |
| CNAME | `api` | o destino que o Render mostrar para `api.kromads.com.br` |

A Vercel emite o certificado HTTPS sozinha assim que o CNAME propagar.

## Conferência rápida depois do deploy

- `/` abre a LP do KHUB; `/login` abre o login.
- `GET <api>/v1/ready` → `ready`.
- `/conhecimento` logado mostra só a base de conhecimento de produto (nunca PRD ou Bugs).

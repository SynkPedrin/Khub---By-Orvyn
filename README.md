# KHUB by Orvyn

CRM com interface Next.js, API NestJS, PostgreSQL/pgvector e filas BullMQ/Redis.

## Desenvolvimento

Requer Node 20+, pnpm 9.12.3, PostgreSQL com pgvector e Redis.

```sh
pnpm install --frozen-lockfile
pnpm --filter @khub/api exec prisma generate
pnpm --filter @khub/api exec jest --runInBand
pnpm --filter @khub/web test
pnpm build
```

Configure as credenciais fora do Git. A API exige `DATABASE_URL`, `REDIS_URL` e `JWT_SECRET` (32+ caracteres em produção). A conexão da aplicação deve usar `khub_app`, sem SUPERUSER/BYPASSRLS. A conexão administrativa é somente para migrações; nunca deve ser usada pela API. O frontend usa `KHUB_API_URL` no servidor e `NEXT_PUBLIC_API_URL` para conexões em tempo real, conforme a configuração do cliente.

Aplique os arquivos SQL de `db/` em ordem com o runner `apps/api/scripts/db-migrate.mjs` e `ADMIN_DATABASE_URL` definido explicitamente. Arquivos de isolamento são testes, não migrações. Rode o servidor e o worker separadamente em operação contínua.

## Publicação gratuita

`render.yaml` descreve uma API e uma fila gratuitas. O frontend fica na Vercel e o PostgreSQL no Neon. `deploy/start-free.mjs` supervisiona API e worker na mesma instância gratuita, encerrando ambos se um falhar. O endpoint `/v1/ready` verifica banco e fila.

O plano gratuito do Render suspende a instância por inatividade; durante esse período os jobs e follow-ups não executam. O Redis gratuito não oferece persistência: um reinício pode perder filas. Essa configuração permite validação online, mas não atende uma promessa de atendimento contínuo 24 horas ou garantia de execução de todas as automações. Não foi configurado mecanismo para contornar a suspensão gratuita.

IA, WhatsApp, pagamentos, e-mail e publicidade dependem de suas credenciais. Hospedagem gratuita não inclui automaticamente acesso gratuito a modelos de IA. Ollama local não fica disponível na nuvem por apontar para localhost. Sem provedor configurado, as funções devem indicar indisponibilidade ou encaminhar ao atendimento humano.

Documentação: [Render Free](https://render.com/docs/free), [Blueprint](https://render.com/docs/blueprint-spec), [Neon roles](https://neon.com/docs/manage/roles).

## Escopo da publicação

Este repositório contém o código da aplicação, migrações, testes e a biblioteca pública de conhecimento. Credenciais, históricos de clientes, exportações operacionais, arquivos de sessão de QA e documentos internos não fazem parte da publicação.

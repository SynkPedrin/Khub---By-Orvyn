# syntax=docker/dockerfile:1
# API NestJS — build no monorepo pnpm+turbo. Contexto = RAIZ do repo:
#   docker build -f apps/api/Dockerfile -t khub-api .
# Achado real (build "passava", container não subia): Alpine puro não tem
# nenhum libssl. Sem isto, o `prisma generate` do stage de build nem detecta
# a versão de OpenSSL (warning "defaulting to openssl-1.1.x") e gera o
# engine binary errado; em runtime o erro só aparece na hora da 1ª query:
# "Error loading shared library libssl.so.1.1: No such file or directory".
# Instalar aqui (no `base`, herdado por build E runtime) resolve as duas
# pontas de uma vez: detecção correta no generate + lib presente no runtime.
FROM node:20.20.2-alpine AS base
RUN apk add --no-cache openssl postgresql-client
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# ---- deps: instala o workspace (camada cacheável por manifesto) ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

# ---- build: prisma client + nest build ----
FROM deps AS build
COPY . .
RUN pnpm --filter @khub/api exec prisma generate
RUN pnpm --filter @khub/api build

# ---- runtime: só o necessário para rodar a API ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
# pnpm é não-hoisted por padrão: as dependências de @khub/api só existem de
# verdade em node_modules/.pnpm/* na raiz, com SYMLINKS relativos a partir de
# apps/api/node_modules/* (ex.: reflect-metadata -> ../../../node_modules/.pnpm/...).
# Sem copiar este segundo diretório, o require() da própria dist/main.js
# falha em runtime (achado real: build "passava" mas o container não subia).
COPY --from=build /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/db ./db
COPY --from=build /repo/deploy ./deploy
COPY --from=build /repo/apps/api/scripts/db-migrate.mjs ./apps/api/scripts/db-migrate.mjs
# Roda sem privilégio de root em produção — a imagem base `node:*-alpine` já
# traz o usuário `node` (uid 1000) pronto, só falta trocar pra ele.
RUN chown -R node:node /repo
USER node
WORKDIR /repo/apps/api
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD wget -qO- http://localhost:${PORT:-3333}/v1/ready >/dev/null 2>&1 || exit 1
CMD ["node", "dist/main.js"]

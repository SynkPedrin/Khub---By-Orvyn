# syntax=docker/dockerfile:1
# API NestJS — build no monorepo pnpm+turbo. Contexto = RAIZ do repo:
#   docker build -f apps/api/Dockerfile -t orvyn-api .
FROM node:20.20.2-alpine AS base
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
RUN pnpm --filter @orvyn/api exec prisma generate
RUN pnpm --filter @orvyn/api build

# ---- runtime: só o necessário para rodar a API ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/db ./db
WORKDIR /repo/apps/api
EXPOSE 3333
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s \
  CMD wget -qO- http://localhost:3333/v1/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/main.js"]

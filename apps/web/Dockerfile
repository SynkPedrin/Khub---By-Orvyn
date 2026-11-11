# syntax=docker/dockerfile:1
# Web Next.js (standalone) — build no monorepo pnpm+turbo. Contexto = RAIZ do repo:
#   docker build -f apps/web/Dockerfile -t khub-web .
FROM node:20.20.2-alpine AS base
ENV PNPM_HOME=/pnpm PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /repo

# ---- deps ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/types/package.json packages/types/package.json
RUN pnpm install --frozen-lockfile

# ---- build: gera o server standalone ----
FROM deps AS build
COPY . .
RUN pnpm --filter @khub/web build

# ---- runtime: server.js standalone + estáticos + vault do cérebro ----
FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo/apps/web
# O standalone traz seu próprio node_modules mínimo; incluímos estáticos e public.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
# Só a base de conhecimento de PRODUTO vai para a imagem (lib/cerebro.ts lê do
# filesystem). PRD, Bugs, Arquitetura e revisões de segurança são internos e
# nunca entram em produção (BUG-030).
COPY --from=build "/repo/Nyro IA/cerebro/RAG/conhecimento" "/repo/Nyro IA/cerebro/RAG/conhecimento"
EXPOSE 3210
ENV PORT=3210
CMD ["node", "apps/web/server.js"]

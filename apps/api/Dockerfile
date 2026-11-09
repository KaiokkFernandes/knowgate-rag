# syntax=docker/dockerfile:1
# Build from the repository root:  docker build -f apps/api/Dockerfile -t knowgate-api .
#
# Stages:
#   build    installs the workspace, compiles shared + db + api, then `pnpm deploy` copies the
#            api with production dependencies only (workspace packages included).
#   migrate  one-off image that applies Prisma migrations (`prisma migrate deploy`).
#   runtime  final API image: compiled code and production dependencies, non-root user.

# Debian slim (glibc) rather than Alpine: Prisma's schema engine and the argon2 native module
# ship glibc builds first, and it matches the pgvector image (Debian trixie).
ARG NODE_IMAGE=node:26-trixie-slim

FROM ${NODE_IMAGE} AS base
# Node 25+ no longer bundles corepack: install the exact pnpm version from package.json.
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
WORKDIR /repo

FROM base AS build
# Lockfile first: `pnpm fetch` downloads every package into the store and this layer stays
# cached until the lockfile changes, even when source files change.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm-store
# "@knowgate/api..." = the api and every workspace package it depends on, in dependency order.
RUN pnpm --filter "@knowgate/api..." build
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @knowgate/api deploy --prod --store-dir /pnpm-store /out/api
# The db package with its devDependencies: the Prisma CLI is needed to run migrations.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm --filter @knowgate/db deploy --store-dir /pnpm-store /out/db \
 && cp -r packages/db/prisma packages/db/prisma.config.ts /out/db/

FROM ${NODE_IMAGE} AS migrate
WORKDIR /app
COPY --from=build --chown=node:node /out/db ./
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
# Never run as root: a compromise of the process does not get root inside the container.
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3001) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "dist/main"]

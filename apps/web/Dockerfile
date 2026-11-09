# syntax=docker/dockerfile:1
# Web image (Next.js standalone output). Build from the repository root:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=http://localhost:3001 .

ARG NODE_IMAGE=node:26-trixie-slim

FROM ${NODE_IMAGE} AS base
RUN npm install --global pnpm@12.18.0 && npm cache clean --force
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

# --- build: install from the lockfile and run `next build` ---
FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store pnpm fetch --store-dir /pnpm-store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm-store \
    pnpm install --frozen-lockfile --offline --store-dir /pnpm-store
# NEXT_PUBLIC_* variables are inlined into the browser bundle at build time, so the API URL is a
# build argument, not a runtime variable. It is public by definition: never pass secrets here.
ARG NEXT_PUBLIC_API_URL=http://localhost:3001
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter "@knowgate/web..." build \
 # The standalone server does not copy static assets; they are added next to server.js.
 && mkdir -p apps/web/public \
 && cp -r apps/web/public apps/web/.next/standalone/apps/web/public \
 && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

# --- runtime: only the traced files (server.js + the node_modules it needs) ---
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    # Listen on all interfaces inside the container (the default would be the container hostname).
    HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/web/server.js"]

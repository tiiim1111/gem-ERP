# GEM-ENI web — production image (on-premise Docker host or any Docker platform).
# Build from the REPO ROOT: docker build -f apps/web/Dockerfile .
#
# IMPORTANT — API_PROXY_TARGET is a BUILD argument, not a runtime variable.
# Next.js bakes rewrite destinations into .next/routes-manifest.json during
# `next build`, so changing it afterwards has no effect. The default points at
# the compose service name (http://api:3001), which is stable for every
# deployment, so you normally never need to override it.

# ---------- Build stage ----------
FROM node:22-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

ARG API_PROXY_TARGET=http://api:3001
ENV API_PROXY_TARGET=${API_PROXY_TARGET}
# Empty = relative mode: the browser calls /api/v1 on its own origin and this
# server proxies it. Keeps cookies first-party under ANY hostname or LAN IP.
ENV NEXT_PUBLIC_API_URL=""
ENV NEXT_TELEMETRY_DISABLED=1

# Install with the full workspace graph (cache-friendly layering).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @gemerp/web...

# Sources
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY apps/web apps/web
COPY tsconfig.base.json ./

RUN pnpm --filter @gemerp/shared build \
  && pnpm --filter @gemerp/web build

# ---------- Runtime stage ----------
FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

COPY --from=build /repo /repo
EXPOSE 3000

CMD ["pnpm", "--filter", "@gemerp/web", "start"]

# GEM ERP worker — BullMQ job runner (maintenance, notifications, report exports).
# Build from the REPO ROOT: docker build -f apps/worker/Dockerfile .
# (Railway: Root Directory = repo root, Dockerfile path = apps/worker/Dockerfile.)

# ---------- Build stage ----------
FROM node:22-slim AS build
# openssl: Prisma engine-target detection needs it at generate time.
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /repo

# Install with the full workspace graph (cache-friendly layering).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/reports/package.json packages/reports/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @gemerp/worker... --filter @gemerp/database...

# Sources
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY packages/reports packages/reports
COPY apps/worker apps/worker
COPY tsconfig.base.json ./

# Prisma client + builds
RUN pnpm --filter @gemerp/database generate \
  && pnpm --filter @gemerp/shared build \
  && pnpm --filter @gemerp/reports build \
  && pnpm --filter @gemerp/worker build

# ---------- Runtime stage ----------
FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo

COPY --from=build /repo /repo

# Env comes from the platform (DATABASE_URL, REDIS_URL, S3_* when enabled).
# Migrations are the API service's job; the worker just runs.
CMD ["node", "apps/worker/dist/main.js"]

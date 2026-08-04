# GEM ERP API — production image (Railway or any Docker host).
# Build from the REPO ROOT: docker build -f apps/api/Dockerfile .
# (Railway: set Root Directory to the repo root and Dockerfile path to apps/api/Dockerfile.)

# ---------- Build stage ----------
FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo

# Install with the full workspace graph (cache-friendly layering).
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @gemerp/api... --filter @gemerp/database...

# Sources
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY packages/database packages/database
COPY apps/api apps/api
COPY tsconfig.base.json ./

# Prisma client + builds
RUN pnpm --filter @gemerp/database generate \
  && pnpm --filter @gemerp/shared build \
  && pnpm --filter @gemerp/api build

# ---------- Runtime stage ----------
FROM node:22-slim
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /repo

# Workspace with production node_modules + built output + prisma schema/migrations.
COPY --from=build /repo /repo

# Apply pending migrations, then boot. Seeding is a manual one-time step:
#   pnpm --filter @gemerp/database seed
CMD ["sh", "-c", "pnpm --filter @gemerp/database migrate:deploy && node apps/api/dist/main.js"]

import { PrismaClient } from "@prisma/client";

// Re-export every generated type (models, enums, Prisma namespace, PrismaClient)
// so consumers import from "@gemerp/database" only.
export * from "@prisma/client";

/**
 * Lazily-instantiated PrismaClient singleton.
 *
 * - Nothing is created at import time; the client is constructed on first use.
 * - Outside production the instance is cached on `globalThis` so hot reloads
 *   (Next.js dev server, tsx watch) reuse one client instead of exhausting the
 *   Postgres connection pool.
 * - In production a module-scoped instance is used.
 */
const globalForPrisma = globalThis as unknown as {
  __gemerpPrisma?: PrismaClient;
};

let productionClient: PrismaClient | undefined;

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    log:
      process.env.NODE_ENV === "production"
        ? ["warn", "error"]
        : ["warn", "error"],
  });
}

export function getPrismaClient(): PrismaClient {
  if (process.env.NODE_ENV === "production") {
    if (!productionClient) {
      productionClient = createPrismaClient();
    }
    return productionClient;
  }
  if (!globalForPrisma.__gemerpPrisma) {
    globalForPrisma.__gemerpPrisma = createPrismaClient();
  }
  return globalForPrisma.__gemerpPrisma;
}

/**
 * Lazy proxy over the singleton: `prisma.user.findMany(...)` works everywhere,
 * but no client (and no database connection) exists until the first property
 * access.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, _receiver) {
    const client = getPrismaClient();
    const value = Reflect.get(client, prop) as unknown;
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(client);
    }
    return value;
  },
  has(_target, prop) {
    return prop in getPrismaClient();
  },
});

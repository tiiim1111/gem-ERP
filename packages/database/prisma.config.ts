import { defineConfig } from "prisma/config";
import { loadEnvFiles } from "./src/load-env";

// Prisma CLI commands (migrate/generate/studio/db seed) run with
// packages/database as cwd; pull DATABASE_URL from the repo-root .env.
loadEnvFiles(process.cwd());

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/seed.ts",
  },
});
